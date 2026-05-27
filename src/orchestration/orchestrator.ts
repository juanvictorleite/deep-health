import type { CommandRunner, PhaseStatus } from "@core/types/common";
import type { ProjectConfig } from "@core/types/config";
import type { ScanResultJson } from "@core/types/scan";
import type { UpdateResultJson } from "@core/types/update";
import type { AdvisorResult, ResidualVerification } from "@core/types/report";
import type {
  EngineWarning,
  ScannerEngineContext,
} from "@modules/scanner/types";
import { validateGateA } from "@core/gates/validator";
import { GateValidationError } from "@core/errors";
import { logger } from "@infra/utils/logger";
import { detectGitBranch } from "@infra/utils/git-branch";
import type { RendererType } from "@app/progress-reporter";
import { buildEcosystemFixTaskList, buildEcosystemFixSubtasks } from "@app/progress-reporter";
import { badge } from "@infra/utils/ui";
// Ecosystem registry — plugins are registered via modules/ecosystem/index.ts side-effects
import { EcosystemRegistry, defaultRegistry } from "@modules/ecosystem/index";
// Scanner registry — engines are bootstrapped lazily via bootstrapDefaultEngines()
import {
  defaultScannerRegistry,
  ScannerEngineRegistry,
  aggregateScanResults,
  OSV_ENGINE_ID,
  bootstrapDefaultEngines,
  executeScannerSweep,
  listr2ScannerSweepRenderer,
} from "@modules/scanner/index";
import { isErr } from "@core/types/result";
import type { AggregatedScanResult } from "@modules/scanner/index";
import { CLI_NAME, KILL_SWITCH_VAR } from "@infra/brand";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  runEcosystemFix,
  resolveEcosystemFixContext,
  resolveAdvisors,
  executeOsvStagingPhase,
  runPluginUpdater,
  executeBreakingInstall,
  maybeRunOsvVerification,
  finalizeEcosystemOutcome,
} from "./run-ecosystem-fix";
import { ecosystemEntryKey } from "@core/types/config";
import type { EcosystemPlugin } from "@modules/ecosystem/types";
import type { EcosystemConfig } from "@core/types/config";
import type { EcosystemFixStepFns } from "@app/progress-reporter";

export interface OrchestratorOptions {
  configPath: string;
  cwd: string;
  dryRun: boolean;
  verbose: boolean;
  /**
   * Subset of phases to execute.
   * Plugin IDs (e.g. 'npm', 'composer') are accepted alongside 'scan' and 'report'.
   */
  phases?: string[];
  /**
   * Per-ecosystem authorization for breaking changes.
   * Ex: { npm: true, composer: false }
   */
  authorizeBreaking?: Record<string, boolean>;
  /**
   * Override the ecosystem registry (useful for testing).
   * Defaults to defaultRegistry (which has npm + composer registered).
   */
  registry?: EcosystemRegistry;
  /**
   * Override the scanner engine registry (useful for testing).
   * Defaults to defaultScannerRegistry (OSV + SonarQube registered).
   */
  scannerRegistry?: ScannerEngineRegistry;
  /**
   * Listr2 renderer type to use for the scan progress display.
   * Defaults to 'default'.
   */
  rendererType?: RendererType;
}

export interface OrchestratorResult {
  scan: ScanResultJson | null;
  /** Update results keyed by plugin id (e.g. 'npm', 'composer') */
  updates: Record<string, UpdateResultJson>;
  overallStatus: PhaseStatus;
  /**
   * True when there are pending vulnerabilities (breaking or manual) after the pipeline run.
   * Does NOT imply a crash or gate failure — consumers should check this separately from overallStatus.
   */
  hasPendingVulns: boolean;
  /**
   * Non-fatal engine warnings accumulated during the pipeline run.
   * Populated when a secondary scanner (e.g. SonarQube with on_failure=warn)
   * fails but the pipeline continues.
   */
  warnings: EngineWarning[];
  /**
   * Aggregated scan result from all engines.
   * Consumers needing per-engine raw results can use this field.
   * The `primary` subfield is always the OSV result (Gate A source of truth).
   */
  aggregated?: AggregatedScanResult;
  /**
   * Advisor results keyed by ecosystem id.
   * Advisors are informational only — they never block the pipeline.
   */
  advisorResults: Record<string, AdvisorResult[]>;
  /**
   * Residual OSV verification outcome (typed union).
   */
  residualVerification?: ResidualVerification;
}

function shouldRunPhase(phase: string, options: OrchestratorOptions): boolean {
  if (!options.phases) return true;
  return options.phases.includes(phase);
}

/**
 * Resolve the on_failure policy for a secondary engine.
 *
 * Uses a generic lookup into config.scanners by engine id.
 * Each engine config block that exposes an `on_failure` field is consulted.
 * - 'sonarqube': reads config.scanners.sonarqube.on_failure (defaults to 'warn').
 * - Any engine id whose config block has an `on_failure` field: uses that value.
 * - Any engine id with no config or no `on_failure` field: defaults to 'fail' (safe hardening).
 *
 * Rationale for the 'fail' default for unknowns: an unrecognised engine has no
 * config key, so silently swallowing its failure could mask integration bugs or
 * misconfiguration. Failing loudly is the safe choice.
 */
function resolveOnFailure(
  engineId: string,
  config: ProjectConfig,
): "warn" | "fail" {
  const scanners = config.scanners;
  if (!scanners) {
    logger.debug(
      `Engine "${engineId}": no scanners config found — defaulting on_failure to "fail".`,
    );
    return "fail";
  }

  // Generic lookup: find the engine config block by id and read on_failure if present
  for (const [key, engineConfig] of Object.entries(scanners)) {
    if (
      key === engineId &&
      engineConfig &&
      typeof engineConfig === "object" &&
      "on_failure" in engineConfig
    ) {
      const onFailure = (engineConfig as { on_failure?: "warn" | "fail" })
        .on_failure;
      return onFailure ?? "fail";
    }
  }

  // Unknown secondary engine or engine config has no on_failure — fail by default (safe hardening)
  logger.warn(
    `Engine "${engineId}" is not a recognised secondary engine or has no on_failure config. ` +
      `Defaulting on_failure to "fail" for safety. ` +
      `Add explicit config for this engine to override.`,
  );
  return "fail";
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Captures pre-run snapshots of package.json and package-lock.json.
 *
 * These snapshots are used for dirty-tree detection after revert — if on-disk
 * state differs after revert, external changes during the run may have been
 * lost (warn only, never fail).
 */
async function capturePreRunSnapshots(cwd: string): Promise<Map<string, string>> {
  const preRunSnapshots = new Map<string, string>();
  for (const filename of ['package.json', 'package-lock.json']) {
    try {
      const content = await readFile(join(cwd, filename), 'utf-8');
      preRunSnapshots.set(filename, content as string);
    } catch {
      logger.tagged('pre-run', 'pre-run', `Could not read ${filename} — skipping pre-run snapshot`, 'debug');
    }
  }
  return preRunSnapshots;
}

interface ScanPhaseParams {
  ctx: ScannerEngineContext;
  engineRegistry: ScannerEngineRegistry;
  config: ProjectConfig;
  options: OrchestratorOptions;
  primaryEngineId: string;
}

interface ScanPhaseResult {
  scanResult: ScanResultJson;
  aggregated: AggregatedScanResult;
  engineEntries: Array<{ engineId: string; result: ScanResultJson }>;
  warnings: EngineWarning[];
}

/**
 * Executes the scan phase: runs all scan-phase engines via the scanner sweep,
 * validates Gate A, logs the summary, and returns the aggregated results.
 *
 * Throws GateValidationError if Gate A validation fails.
 * Re-throws the primary engine's original cause on PrimaryEngineFailure,
 * preserving partial warnings from secondary engines that ran before it.
 *
 * Note: CC may be up to 15 for this helper due to the number of error-path
 * branches required to faithfully preserve the orchestrator's observable
 * error-handling behaviour.
 */
async function executeScanPhase(
  params: ScanPhaseParams,
  partialResult: OrchestratorResult,
): Promise<ScanPhaseResult> {
  const { ctx, engineRegistry, config, options, primaryEngineId } = params;

  const sweepResult = await executeScannerSweep(
    engineRegistry.getByPhase('scan'),
    ctx,
    {
      primaryEngineId,
      resolveOnFailure: (id) => resolveOnFailure(id, config),
    },
    listr2ScannerSweepRenderer(options.rendererType ?? 'default'),
  );

  if (isErr(sweepResult)) {
    const sweepErr = sweepResult.error;
    if (sweepErr.kind === 'primary') {
      partialResult.warnings = sweepErr.failure.partialWarnings;
      throw sweepErr.failure.cause instanceof Error
        ? sweepErr.failure.cause
        : new Error(String(sweepErr.failure.cause));
    }
    throw sweepErr.error;
  }

  const engineEntries = sweepResult.value.engineEntries;
  const warnings = sweepResult.value.warnings;
  const aggregated = aggregateScanResults(engineEntries, warnings, primaryEngineId);
  const scanResult = aggregated.primary;

  const gateA = validateGateA(scanResult);
  if (!gateA.valid) {
    throw new GateValidationError(
      `Gate A validation failed: ${gateA.errors.join(", ")}`,
      "A",
      gateA.errors,
    );
  }

  const ecosystemSummaryParts = Object.entries(scanResult.ecosystems).map(
    ([id, e]) =>
      `${e.vulnerabilities_total} ${id} vulns (${e.auto_safe} auto-safe, ${e.breaking} breaking)`,
  );
  logger.info(
    `Scan complete: ${ecosystemSummaryParts.join(", ") || "no vulnerabilities found"}`,
  );

  return { scanResult, aggregated, engineEntries, warnings };
}

/**
 * Processes the outcome of a single ecosystem fix run.
 *
 * Records advisor results (always), update results, residual verification,
 * and error status. Returns true if the outer loop should break (error path).
 */
function processEcosystemOutcome(
  outcome: Awaited<ReturnType<typeof runEcosystemFix>>,
  ecoEntry: EcosystemConfig,
  plugin: EcosystemPlugin,
  result: OrchestratorResult,
): boolean {
  const entryKey = ecosystemEntryKey(ecoEntry);

  if (outcome.advisorResults) {
    result.advisorResults[entryKey] = outcome.advisorResults;
  }

  if (outcome.status === "skipped") return false;

  result.updates[ecosystemEntryKey(ecoEntry)] = outcome.updateResult;

  if (outcome.status === "success" && outcome.residualVerification) {
    const rv = outcome.residualVerification;
    if (rv.status !== 'skipped' && rv.summary[plugin.id] !== undefined && entryKey !== plugin.id) {
      const rekeyed = { ...rv.summary, [entryKey]: rv.summary[plugin.id] };
      delete rekeyed[plugin.id];
      result.residualVerification = { ...rv, summary: rekeyed };
    } else {
      result.residualVerification = rv;
    }
  }

  if (outcome.status === "error") {
    result.overallStatus = "error";
    return true;
  }

  return false;
}

interface PostFixSweepParams {
  engineRegistry: ScannerEngineRegistry;
  ctx: ScannerEngineContext;
  config: ProjectConfig;
  options: OrchestratorOptions;
  engineEntries: Array<{ engineId: string; result: ScanResultJson }>;
  result: OrchestratorResult;
  primaryEngineId: string;
}

/**
 * Executes the post-fix sweep for engines that declared phase='post-fix'
 * (e.g. SonarQube). These engines analyse the final state of the code after
 * all fixers have run. Skipped when the pipeline has already errored.
 *
 * Merges post-fix engine entries and warnings into result.aggregated in place.
 */
async function executePostFixSweep(params: PostFixSweepParams): Promise<void> {
  const { engineRegistry, ctx, config, options, engineEntries, result, primaryEngineId } = params;

  const postFixEngines = engineRegistry.getByPhase('post-fix');
  if (postFixEngines.length === 0 || result.overallStatus === 'error') return;

  logger.phase('Post-Fix Scan');
  const postFixSweepResult = await executeScannerSweep(
    postFixEngines,
    ctx,
    {
      primaryEngineId: '__post-fix-no-primary__',
      resolveOnFailure: (id) => resolveOnFailure(id, config),
    },
    listr2ScannerSweepRenderer(options.rendererType ?? 'default'),
  );

  if (isErr(postFixSweepResult)) {
    const postFixErr = postFixSweepResult.error;
    if (postFixErr.kind === 'primary') {
      result.warnings.push(...postFixErr.failure.partialWarnings);
    } else {
      throw postFixErr.error;
    }
  } else {
    engineEntries.push(...postFixSweepResult.value.engineEntries);
    result.warnings.push(...postFixSweepResult.value.warnings);
    result.aggregated = aggregateScanResults(engineEntries, result.warnings, primaryEngineId);
  }
}

interface EngineSetup {
  ecosystemRegistry: EcosystemRegistry;
  engineRegistry: ScannerEngineRegistry;
  primaryEngineId: string;
}

/**
 * Resolves and validates the engine registry setup for a pipeline run.
 *
 * - Selects the ecosystem and scanner registries (injected or default).
 * - Bootstraps default engines when using the default scanner registry.
 * - Validates that the configured primary engine is registered.
 *
 * Throws when the primary engine is missing so the caller gets a clear error
 * before any I/O occurs.
 */
function setupEngineRegistry(
  options: OrchestratorOptions,
  config: ProjectConfig,
): EngineSetup {
  const ecosystemRegistry = options.registry ?? defaultRegistry;
  const engineRegistry = options.scannerRegistry ?? defaultScannerRegistry;

  if (!options.scannerRegistry) {
    bootstrapDefaultEngines(engineRegistry);
  }

  const primaryEngineId = config.scanners?.primary ?? OSV_ENGINE_ID;
  if (!engineRegistry.has(primaryEngineId)) {
    throw new Error(
      `Primary scanner engine "${primaryEngineId}" is not registered. ` +
      `Register an engine with id "${primaryEngineId}" before running the orchestrator. ` +
      `Available engines: [${engineRegistry.getAll().map((e) => e.id).join(', ')}]`,
    );
  }

  return { ecosystemRegistry, engineRegistry, primaryEngineId };
}

/**
 * Builds the scanner engine context, detecting the git branch once before
 * running any scans. Never throws — branch detection returns null on failure.
 */
async function buildScanContext(
  runner: CommandRunner,
  config: ProjectConfig,
  options: OrchestratorOptions,
  ecosystemRegistry: EcosystemRegistry,
): Promise<ScannerEngineContext> {
  const branch = await detectGitBranch(options.cwd, runner);
  if (branch) {
    logger.info(`Detected git branch: ${branch}`);
  }
  return {
    runner,
    config,
    cwd: options.cwd,
    ecosystemRegistry,
    branch,
  };
}

/**
 * Evaluates whether any ecosystem has pending breaking or manual vulnerabilities.
 *
 * Extracted from runOrchestrator to remove the `.some(e => e.breaking > 0 || ...)`
 * inline lambda that lizard counts as a CC decision point.
 */
function hasPendingVulnerabilities(scanResult: ScanResultJson): boolean {
  return Object.values(scanResult.ecosystems).some(
    (e) => e.breaking > 0 || e.manual > 0,
  );
}

interface EcosystemLoopParams {
  config: ProjectConfig;
  options: OrchestratorOptions;
  ecosystemRegistry: EcosystemRegistry;
  runner: CommandRunner;
  scanResult: ScanResultJson;
  preRunSnapshots: Map<string, string>;
  result: OrchestratorResult;
  rendererType: RendererType;
}

/**
 * Builds the list of active ecosystem entries to process (respects phases filter).
 * Returns { plugin, ecoEntry, ecosystemCwd, authorizeBreaking } for each active entry.
 */
function buildActiveEcosystemEntries(
  config: ProjectConfig,
  options: OrchestratorOptions,
  ecosystemRegistry: EcosystemRegistry,
): Array<{
  plugin: EcosystemPlugin;
  ecoEntry: EcosystemConfig;
  ecosystemCwd: string;
  authorizeBreaking: boolean;
}> {
  const entries: Array<{
    plugin: EcosystemPlugin;
    ecoEntry: EcosystemConfig;
    ecosystemCwd: string;
    authorizeBreaking: boolean;
  }> = [];

  for (const ecoEntry of config.ecosystems) {
    const plugin = ecosystemRegistry.getAll().find((p) => p.id === ecoEntry.id);
    if (!plugin) continue;

    const entryKey = ecosystemEntryKey(ecoEntry);

    if (options.phases && !shouldRunPhase(ecoEntry.id, options) && !shouldRunPhase(entryKey, options)) {
      logger.info(`Phase: Skipping ${plugin.name} (${entryKey}) — not in phases list`);
      continue;
    }

    const ecosystemCwd = ecoEntry.path ? resolve(options.cwd, ecoEntry.path) : options.cwd;
    const authorizeBreaking =
      (options.authorizeBreaking?.[ecoEntry.id] ?? false) ||
      (options.authorizeBreaking?.[entryKey] ?? false);

    entries.push({ plugin, ecoEntry, ecosystemCwd, authorizeBreaking });
  }

  return entries;
}

/**
 * Iterates over config.ecosystems entries and runs runEcosystemFix for each.
 *
 * In default (non-verbose) mode, wraps all entries in a listr2 task list so
 * each ecosystem shows as a spinner with rolling output. In verbose mode, runs
 * the loop directly preserving current behavior exactly.
 *
 * Processes entries independently (not unique plugins) to support monorepo
 * configurations where the same plugin id appears at multiple paths.
 * Stops early and sets result.overallStatus = 'error' on the first error.
 */
async function runEcosystemLoop(params: EcosystemLoopParams): Promise<void> {
  const { config, options, ecosystemRegistry, runner, scanResult, preRunSnapshots, result, rendererType } = params;

  const activeEntries = buildActiveEcosystemEntries(config, options, ecosystemRegistry);

  if (rendererType === 'verbose') {
    for (const { plugin, ecoEntry, ecosystemCwd, authorizeBreaking } of activeEntries) {
      const outcome = await runEcosystemFix({
        plugin,
        ecoEntry,
        hostRunner: runner,
        config,
        scanResult,
        cwd: ecosystemCwd,
        dryRun: options.dryRun,
        authorizeBreaking,
        preRunSnapshots,
        projectRoot: options.cwd,
        verbose: true,
      });

      const shouldBreak = processEcosystemOutcome(outcome, ecoEntry, plugin, result);
      if (shouldBreak) break;
    }
    return;
  }

  // Default mode: wrap each ecosystem in a listr2 task with spinner + rolling output.
  // shouldBreak is shared state across tasks; subsequent tasks check it via skip().
  let shouldBreak = false;

  const steps: EcosystemFixStepFns = {
    resolveContext: (p) => resolveEcosystemFixContext(p as Parameters<typeof resolveEcosystemFixContext>[0]),
    resolveAdvisors,
    executeOsvStagingPhase,
    runPluginUpdater,
    executeBreakingInstall,
    maybeRunOsvVerification,
    finalizeOutcome: finalizeEcosystemOutcome,
  };

  const taskEntries = activeEntries.map(({ plugin, ecoEntry, ecosystemCwd, authorizeBreaking }) => ({
    title: `${badge(plugin.id)} ${plugin.name}`,
    buildSubtasks: () => {
      if (shouldBreak) return [];
      return buildEcosystemFixSubtasks({
        plugin,
        ecoEntry,
        hostRunner: runner,
        config,
        scanResult,
        cwd: ecosystemCwd,
        dryRun: options.dryRun,
        authorizeBreaking,
        preRunSnapshots,
        projectRoot: options.cwd,
        verbose: false,
        steps,
        onOutcome: (outcome) => {
          const broke = processEcosystemOutcome(outcome as Awaited<ReturnType<typeof runEcosystemFix>>, ecoEntry, plugin, result);
          if (broke) shouldBreak = true;
        },
      });
    },
  }));

  const taskList = buildEcosystemFixTaskList(taskEntries, rendererType);
  await taskList.run();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runOrchestrator(
  runner: CommandRunner,
  config: ProjectConfig,
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const result: OrchestratorResult = {
    scan: null,
    updates: {},
    overallStatus: "success",
    hasPendingVulns: false,
    warnings: [],
    advisorResults: {},
  };

  const preRunSnapshots = await capturePreRunSnapshots(options.cwd);

  // Scan — hard precondition for all update steps
  if (!shouldRunPhase("scan", options)) {
    logger.warn('Skipping scan phase — phases option does not include "scan"');
    result.overallStatus = "skipped";
    return result;
  }

  logger.phase('Vulnerability Scan');

  const { ecosystemRegistry, engineRegistry, primaryEngineId } = setupEngineRegistry(options, config);
  const ctx = await buildScanContext(runner, config, options, ecosystemRegistry);

  // Run scan-phase engines via the Scanner Sweep module; collect results + warnings.
  // Only engines with phase='scan' (or no phase, which defaults to 'scan') run here.
  // Post-fix engines (e.g. SonarQube) run after ecosystem fixers complete.
  const { scanResult, aggregated, engineEntries, warnings } = await executeScanPhase(
    { ctx, engineRegistry, config, options, primaryEngineId },
    result,
  );
  result.aggregated = aggregated;
  result.scan = scanResult;
  result.warnings = warnings;

  // Kill-switch: skip all automated fixes when KILL_SWITCH_VAR is set
  if (process.env[KILL_SWITCH_VAR]) {
    logger.warn(
      `[${CLI_NAME}] ${KILL_SWITCH_VAR} is set — skipping all automated fixes. ` +
      'Scan results are available but no files have been modified. ' +
      `Unset ${KILL_SWITCH_VAR} to re-enable automated remediation.`,
    );
    result.hasPendingVulns = hasPendingVulnerabilities(scanResult);
    return result;
  }

  // Iterate over config.ecosystems entries (not unique plugins from registry).
  // This ensures monorepo entries with the same plugin id at different paths
  // are each processed independently.
  await runEcosystemLoop({
    config, options, ecosystemRegistry, runner, scanResult, preRunSnapshots, result,
    rendererType: options.rendererType ?? 'default',
  });

  // Post-fix sweep: run engines that declared phase='post-fix' (e.g. SonarQube).
  await executePostFixSweep({
    engineRegistry, ctx, config, options, engineEntries, result, primaryEngineId,
  });

  result.hasPendingVulns = hasPendingVulnerabilities(scanResult);
  return result;
}
