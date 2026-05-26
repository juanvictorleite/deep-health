/**
 * runEcosystemFix — per-plugin fix flow extracted from the orchestrator loop.
 *
 * Responsible for:
 *   has-updates gate → advisor execution → effective runner resolution →
 *   OSV staging-fix → updater → breaking-install → OSV residual verification →
 *   ecosystem gate.
 *
 * Advisors run in both the skip path and the fix path:
 *   - Skip path (!hasUpdates): advisors run via hostRunner (no container spin-up
 *     needed — there is nothing to fix). Results are returned in the skipped outcome.
 *   - Fix path (hasUpdates): advisors run via effectiveRunner (the container runner
 *     when Docker is configured), ensuring they execute with the same Node/Python
 *     version as the fix phase and avoiding result divergence.
 *
 * Advisors are informational only — never throws, never blocks the pipeline.
 *
 * NOT responsible for:
 *   - phase filtering (`shouldRunPhase`) — caller decides which plugins to run
 *   - aggregating results into the OrchestratorResult shape
 *
 * Throws `GateValidationError` if the ecosystem gate fails. Otherwise returns
 * a tagged outcome and lets the orchestrator decide whether to continue, break,
 * or record state on the rolling result object.
 */

import type { CommandRunner } from '@core/types/common';
import type { ProjectConfig, FixerStrategyId, EcosystemConfig, ValidationCommandConfig } from '@core/types/config';
import { ecosystemEntryKey } from '@core/types/config';
import type { ScanResultJson, EcosystemScanResult } from '@core/types/scan';
import type { OsvJsonOutput } from '@modules/scanner/osv-engine';
import type { UpdateResultJson } from '@core/types/update';
import type { ResidualVerification, AdvisorResult } from '@core/types/report';
import type { EcosystemPlugin } from '@modules/ecosystem/types';
import { GateValidationError } from '@core/errors';
import { validateEcosystemGate } from '@core/gates/validator';
import { logger, setProgressSink, makeProgressSink } from '@infra/utils/logger';
import { resolveEcosystemRuntime, resolveOsvRuntime } from '@infra/ecosystem-runtime';
import { runAdvisors } from '@modules/advisor/index';
import { applyOsvFixViaStaging } from './osv-fix-applier';
import { logDryRunPreview } from '@modules/ecosystem/utils/dry-run-preview';
import { join } from 'node:path';

export interface RunEcosystemFixParams {
  plugin: EcosystemPlugin;
  /**
   * The ecosystem config entry being processed (from config.ecosystems[]).
   * Passed directly from the orchestrator so runEcosystemFix doesn't have to
   * search for it; also carries the entry.path for monorepo subdirectory support.
   * When absent, falls back to `config.ecosystems.find(e => e.id === plugin.id)`.
   */
  ecoEntry?: EcosystemConfig;
  /** Host command runner — passed through to `resolveEcosystemRuntime`. */
  hostRunner: CommandRunner;
  config: ProjectConfig;
  scanResult: ScanResultJson;
  cwd: string;
  dryRun: boolean;
  authorizeBreaking: boolean;
  /**
   * Optional pre-run snapshots from the orchestrator (taken before any mutations).
   * Forwarded to the updater for dirty-tree detection after revert.
   */
  preRunSnapshots: Map<string, string> | undefined;
  /**
   * Optional project root directory. When provided, Docker image builds resolve
   * Dockerfile and build context paths relative to projectRoot instead of cwd.
   * cwd (ecosystemCwd) is still used for container mounts so package-manager
   * commands run in the correct subdirectory. Defaults to cwd when absent.
   */
  projectRoot?: string;
}

export type RunEcosystemFixOutcome =
  | { status: 'skipped'; reason: 'no-updates'; advisorResults?: AdvisorResult[] }
  | { status: 'success'; updateResult: UpdateResultJson; residualVerification?: ResidualVerification; advisorResults?: AdvisorResult[] }
  | { status: 'error'; updateResult: UpdateResultJson; advisorResults?: AdvisorResult[] };

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Derives the lockfile override path for OSV staging-apply.
 *
 * Priority order:
 *   1. config.scan.paths (explicit config) — takes precedence.
 *   2. ecoEntry.path (monorepo subdirectory path) — fallback.
 *   3. Returns undefined → caller falls back to plugin.osvFixSpec.fixLockfile default.
 *
 * Note: lizard counts ?? and || as decision points so this helper is intentionally
 * kept focused on the path-resolution logic only to stay within CC ≤ 10.
 */
function resolveFixLockfilePath(
  config: ProjectConfig,
  ecoEntry: EcosystemConfig,
  plugin: EcosystemPlugin,
): string | undefined {
  const scanPaths = config.scan?.paths;
  if (scanPaths && scanPaths.length > 0) {
    const pluginLockfile = plugin.osvFixSpec!.fixLockfile;
    for (const p of scanPaths) {
      if (p.endsWith('/')) {
        return `${p}${pluginLockfile}`;
      }
      if (p.endsWith(`/${pluginLockfile}`) || p === pluginLockfile) {
        return p;
      }
    }
    logger.tagged('osv', 'OSV fix', `scan.paths is configured but no entry matches "${pluginLockfile}". ` +
      `Falling back to default fix lockfile path.`, 'warn');
    return undefined;
  }
  if (ecoEntry.path) {
    return join(ecoEntry.path, plugin.osvFixSpec!.fixLockfile);
  }
  return undefined;
}

interface OsvStagingPhaseParams {
  plugin: EcosystemPlugin;
  fixerStrategy: FixerStrategyId;
  config: ProjectConfig;
  ecoEntry: EcosystemConfig;
  cwd: string;
  dryRun: boolean;
}

/**
 * Executes the OSV staging-apply phase when the fixer strategy is 'osv' or
 * 'osv-then-audit' and the plugin declares an osvFixSpec.
 *
 * Returns the pre-fix backups map and the apply outcome, both of which are
 * forwarded to the updater so it can restore files on error and record
 * which packages were updated by the OSV fixer.
 */
async function executeOsvStagingPhase(
  params: OsvStagingPhaseParams,
): Promise<{ preFixBackups: Map<string, string> | undefined; osvFixOutcome: { applied: boolean; packagesUpdated: Array<{ name: string; versionFrom: string; versionTo: string }> } | undefined }> {
  const { plugin, fixerStrategy, config, ecoEntry, cwd, dryRun } = params;

  if (
    (fixerStrategy === 'osv' || fixerStrategy === 'osv-then-audit') &&
    plugin.osvFixSpec
  ) {
    const fixLockfileOverride = resolveFixLockfilePath(config, ecoEntry, plugin);

    setProgressSink(makeProgressSink());
    let fixResult: Awaited<ReturnType<typeof applyOsvFixViaStaging>>;
    try {
      fixResult = await applyOsvFixViaStaging({
        cwd,
        osvConfig: config.scanners?.osv,
        osvFixSpec: plugin.osvFixSpec,
        fixLockfileOverride,
        dryRun,
      });
    } finally {
      setProgressSink(null);
    }
    return {
      preFixBackups: fixResult.backups,
      osvFixOutcome: {
        applied: fixResult.applied,
        packagesUpdated: fixResult.packagesUpdated,
      },
    };
  }

  return { preFixBackups: undefined, osvFixOutcome: undefined };
}

interface BreakingInstallParams {
  plugin: EcosystemPlugin;
  effectiveRunner: CommandRunner;
  cwd: string;
  scanResult: ScanResultJson;
  dryRun: boolean;
  fixerStrategy: FixerStrategyId;
  authorizeBreaking: boolean;
  updateResult: UpdateResultJson;
  advisorResults: AdvisorResult[] | undefined;
}

/**
 * Runs the plugin's installBreakingPackages hook when it exists, breaking
 * installs are authorized, and the updater did not already error.
 *
 * Returns an error outcome if the install fails, otherwise returns undefined
 * to indicate the caller should continue normally.
 */
async function executeBreakingInstall(
  params: BreakingInstallParams,
): Promise<RunEcosystemFixOutcome | undefined> {
  const {
    plugin, effectiveRunner, cwd, scanResult, dryRun,
    fixerStrategy, authorizeBreaking, updateResult, advisorResults,
  } = params;

  if (
    plugin.installBreakingPackages &&
    authorizeBreaking &&
    updateResult.status !== 'error'
  ) {
    const breakRes = await plugin.installBreakingPackages({
      runner: effectiveRunner,
      cwd,
      scanResult,
      dryRun,
      fixerStrategy,
    });
    if (breakRes?.status === 'error') {
      return {
        status: 'error',
        updateResult: {
          ...updateResult,
          status: 'error',
          error: breakRes.error ?? 'breaking install failed',
        },
        advisorResults,
      };
    }
  }
  return undefined;
}

interface ResolveAdvisorsParams {
  ecoEntry: EcosystemConfig;
  plugin: EcosystemPlugin;
  runner: CommandRunner;
  cwd: string;
  nonfatal: boolean;
}

/**
 * Resolves and runs advisors for the given ecosystem entry and plugin.
 *
 * Uses ecoEntry.advisors if configured, otherwise falls back to
 * plugin.defaultAdvisors. When `nonfatal` is true, errors are swallowed
 * (used in the skip path where there is nothing to fix).
 */
async function resolveAdvisors(
  params: ResolveAdvisorsParams,
): Promise<AdvisorResult[] | undefined> {
  const { ecoEntry, plugin, runner, cwd, nonfatal } = params;
  const advisors = ecoEntry.advisors ?? plugin.defaultAdvisors;
  if (advisors.length === 0) return undefined;

  logger.tagged(plugin.id, 'Advisor Step', `Running advisors for ${plugin.name}...`);
  if (nonfatal) {
    try {
      return await runAdvisors(runner, cwd, plugin.id, advisors);
    } catch {
      return undefined;
    }
  }
  return runAdvisors(runner, cwd, plugin.id, advisors);
}

type OsvPackageEntry = {
  package?: { name?: string; version?: string; ecosystem?: string };
  vulnerabilities?: { id?: string }[];
};

/**
 * Accumulates vulnerability counts from a single osv-scanner result entry
 * into the running summary map.
 *
 * Extracted from buildVerificationSummary to avoid nested-loop ?? chains
 * inflating CC beyond the ≤ 10 helper budget.
 */
function accumulatePackageCounts(
  summary: Record<string, number>,
  packages: OsvPackageEntry[],
): void {
  for (const pkg of packages) {
    const eco = pkg.package?.ecosystem?.toLowerCase() ?? 'unknown';
    const existing = summary[eco] ?? 0;
    const count = pkg.vulnerabilities?.length ?? 0;
    summary[eco] = existing + count;
  }
}

/**
 * Builds the per-ecosystem vulnerability count summary from raw osv-scanner JSON output.
 *
 * Iterates over results → packages → vulnerabilities and accumulates counts keyed
 * by lowercased ecosystem name. Pure data transformation — no I/O.
 * Delegates inner ?? chain to accumulatePackageCounts to stay within CC ≤ 10.
 */
function buildVerificationSummary(data: OsvJsonOutput): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const result of data.results ?? []) {
    accumulatePackageCounts(summary, result.packages ?? []);
  }
  return summary;
}

interface EcosystemFixContext {
  ecoEntry: EcosystemConfig;
  validationCommands: ValidationCommandConfig[] | undefined;
  fixerStrategy: FixerStrategyId;
  entryKey: string;
  ecosystemResult: ScanResultJson['ecosystems'][string] | undefined;
  hasUpdates: boolean;
}

/**
 * Resolves the effective fixer strategy for a plugin.
 *
 * Priority: plugin.resolveEffectiveFixer > ecoEntry.fixer > plugin.supportedFixers[0] > 'osv'.
 * Extracted to isolate the async branch and ?? chain from the parent context resolver.
 */
async function resolveFixerStrategy(
  plugin: EcosystemPlugin,
  config: ProjectConfig,
  cwd: string,
  ecoEntry: EcosystemConfig,
): Promise<FixerStrategyId> {
  if (plugin.resolveEffectiveFixer) {
    return plugin.resolveEffectiveFixer(config, cwd);
  }
  const configured = ecoEntry.fixer;
  if (configured) return configured;
  const first = plugin.supportedFixers[0];
  return (first ?? 'osv') as FixerStrategyId;
}

/**
 * Evaluates whether there are auto-safe or authorized breaking updates to process.
 *
 * Returns true when ecosystemResult exists and auto_safe > 0, or when
 * authorizeBreaking is true and breaking > 0.
 */
function checkHasUpdates(
  ecosystemResult: ScanResultJson['ecosystems'][string] | undefined,
  authorizeBreaking: boolean,
): boolean {
  if (!ecosystemResult) return false;
  if (ecosystemResult.auto_safe > 0) return true;
  return authorizeBreaking && ecosystemResult.breaking > 0;
}

/**
 * Resolves all derived context values needed to drive the ecosystem fix flow.
 *
 * Delegates ?? / ?. / && / || decision logic to focused sub-helpers
 * (resolveFixerStrategy, checkHasUpdates) to keep this function's CC ≤ 10.
 */
async function resolveEcosystemFixContext(
  params: RunEcosystemFixParams,
): Promise<EcosystemFixContext> {
  const { plugin, config, scanResult, cwd, authorizeBreaking } = params;

  const ecoEntry: EcosystemConfig =
    params.ecoEntry ?? config.ecosystems.find((e) => e.id === plugin.id) ?? { id: plugin.id };

  const validationCommands =
    ecoEntry.validationCommands ?? plugin.defaultValidationCommands;

  const fixerStrategy = await resolveFixerStrategy(plugin, config, cwd, ecoEntry);

  const entryKey = ecosystemEntryKey(ecoEntry);
  const ecosystemResult = scanResult.ecosystems[entryKey] ?? scanResult.ecosystems[plugin.id];

  const hasUpdates = checkHasUpdates(ecosystemResult, authorizeBreaking);

  return { ecoEntry, validationCommands, fixerStrategy, entryKey, ecosystemResult, hasUpdates };
}

interface RunUpdaterParams {
  plugin: EcosystemPlugin;
  effectiveRunner: CommandRunner;
  config: ProjectConfig;
  scanResult: ScanResultJson;
  cwd: string;
  authorizeBreaking: boolean;
  validationCommands: ValidationCommandConfig[] | undefined;
  fixerStrategy: FixerStrategyId;
  preFixBackups: Map<string, string> | undefined;
  osvFixOutcome: { applied: boolean; packagesUpdated: Array<{ name: string; versionFrom: string; versionTo: string }> } | undefined;
  preRunSnapshots: Map<string, string> | undefined;
  advisorResults: AdvisorResult[] | undefined;
  ecoEntry: EcosystemConfig;
  ecosystemResult: EcosystemScanResult | undefined;
  dryRun: boolean;
}

/**
 * Runs the plugin updater and returns the update result.
 *
 * Logs the dry-run preview before calling the updater when dryRun is true.
 * Wraps the updater call with a progress sink.
 */
async function runPluginUpdater(
  params: RunUpdaterParams,
): Promise<Awaited<ReturnType<EcosystemPlugin['runUpdater']>>> {
  const {
    plugin, effectiveRunner, config, scanResult, cwd, authorizeBreaking,
    validationCommands, fixerStrategy, preFixBackups, osvFixOutcome,
    preRunSnapshots, advisorResults, ecoEntry, ecosystemResult, dryRun,
  } = params;

  if (dryRun && ecosystemResult) {
    logger.header(plugin.id, 'Dry-run preview');
    logDryRunPreview(plugin.id, ecosystemResult, authorizeBreaking);
  }

  logger.tagged(plugin.id, 'fixer', `Strategy: ${fixerStrategy} (config: ${ecoEntry.fixer ?? 'undefined'}, supportedFixers[0]: ${plugin.supportedFixers[0] ?? 'undefined'}, hasResolveEffectiveFixer: ${!!plugin.resolveEffectiveFixer})`);
  setProgressSink(makeProgressSink());
  try {
    return await plugin.runUpdater({
      runner: effectiveRunner,
      config,
      scanResult,
      cwd,
      authorizeBreaking,
      validationCommands,
      fixerStrategy,
      preFixBackups,
      osvFixOutcome,
      preRunSnapshots: preRunSnapshots && preRunSnapshots.size > 0 ? preRunSnapshots : undefined,
      advisorResults,
    });
  } finally {
    setProgressSink(null);
  }
}

interface OsvVerifyParams {
  plugin: EcosystemPlugin;
  config: ProjectConfig;
  cwd: string;
  hostRunner: CommandRunner;
  fixerStrategy: FixerStrategyId;
  updateResult: UpdateResultJson;
  dryRun: boolean;
}

/**
 * Conditionally runs OSV residual verification after the updater completes.
 *
 * Runs only when the update succeeded and the plugin's postUpdateOsvVerify
 * policy allows it ('always' or 'osv-strategy-only' when fixerStrategy === 'osv').
 * Returns undefined when verification is not applicable or was skipped.
 */
async function maybeRunOsvVerification(
  params: OsvVerifyParams,
): Promise<ResidualVerification | undefined> {
  const { plugin, config, cwd, hostRunner, fixerStrategy, updateResult, dryRun } = params;

  const shouldOsvVerify =
    updateResult.status !== 'error' &&
    (plugin.postUpdateOsvVerify === 'always' ||
      (plugin.postUpdateOsvVerify === 'osv-strategy-only' && fixerStrategy === 'osv'));

  if (!shouldOsvVerify) return undefined;

  const osvVerifyRunner = resolveOsvRuntime(config, cwd, hostRunner);
  const verifyScanArgs = plugin.buildScanArgs();
  const verifyCmd = `osv-scanner ${verifyScanArgs.join(' ')} --format json`;
  return runOsvResidualVerification(osvVerifyRunner, cwd, dryRun, verifyCmd);
}

/**
 * Validates the ecosystem gate and returns a final RunEcosystemFixOutcome.
 *
 * Throws GateValidationError when gate validation fails.
 * Returns error or success outcome based on updateResult.status.
 */
function finalizeEcosystemOutcome(
  plugin: EcosystemPlugin,
  updateResult: UpdateResultJson,
  residualVerification: ResidualVerification | undefined,
  advisorResults: AdvisorResult[] | undefined,
): RunEcosystemFixOutcome {
  const gate = validateEcosystemGate(plugin.id, updateResult);
  if (!gate.valid) {
    throw new GateValidationError(
      `Gate ${plugin.id} validation failed: ${gate.errors.join(', ')}`,
      plugin.id,
      gate.errors,
    );
  }

  if (updateResult.status === 'error') {
    logger.error(`${plugin.name} update failed — stopping pipeline`);
    return { status: 'error', updateResult, advisorResults };
  }

  logger.info(
    `${plugin.name} update complete: ${updateResult.packages_updated.length} packages updated`,
  );
  return { status: 'success', updateResult, residualVerification, advisorResults };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runEcosystemFix(
  params: RunEcosystemFixParams,
): Promise<RunEcosystemFixOutcome> {
  const { plugin, hostRunner, config, scanResult, cwd, dryRun, authorizeBreaking, preRunSnapshots } = params;

  // Resolve all derived context: ecoEntry, fixerStrategy, hasUpdates gate, etc.
  const { ecoEntry, validationCommands, fixerStrategy, ecosystemResult, hasUpdates } =
    await resolveEcosystemFixContext(params);

  if (!hasUpdates) {
    // Run advisors via hostRunner before skipping — no container resolution needed
    // when there is nothing to fix, but advisor data is still valuable (informational only,
    // never throws, never blocks pipeline).
    const skipAdvisorResults = await resolveAdvisors({
      ecoEntry, plugin, runner: hostRunner, cwd, nonfatal: true,
    });
    logger.skip(`Skipping ${plugin.name} — no auto-safe vulnerabilities`);
    return { status: 'skipped', reason: 'no-updates', advisorResults: skipAdvisorResults };
  }

  logger.phase(plugin.id);

  // Resolve effective runner via the ecosystem runtime module
  // Pass the per-ecosystem inline runner config from ecosystems[].runner (if any).
  // projectRoot is passed so buildProjectImage resolves Dockerfile/context paths
  // from the project root, while cwd (ecosystemCwd) is kept for container mounts.
  const effectiveRunner: CommandRunner = plugin.runtimeSpec
    ? await resolveEcosystemRuntime({ plugin, hostRunner, config, cwd, runnerConfig: ecoEntry.runner, projectRoot: params.projectRoot })
    : hostRunner;

  // Run advisors using effectiveRunner so they execute in the same container
  // as the fix phase (when Docker is configured). Informational only — never throws,
  // never blocks the pipeline.
  const advisorResults = await resolveAdvisors({
    ecoEntry, plugin, runner: effectiveRunner, cwd, nonfatal: false,
  });

  // OSV staging-apply (generic, driven by plugin.osvFixSpec)
  const { preFixBackups, osvFixOutcome } = await executeOsvStagingPhase({
    plugin, fixerStrategy, config, ecoEntry, cwd, dryRun,
  });

  const updateResult = await runPluginUpdater({
    plugin, effectiveRunner, config, scanResult, cwd, authorizeBreaking,
    validationCommands, fixerStrategy, preFixBackups, osvFixOutcome,
    preRunSnapshots, advisorResults, ecoEntry, ecosystemResult, dryRun,
  });

  // === Post-updater: Breaking packages install (generic, via plugin hook) ===
  const breakingError = await executeBreakingInstall({
    plugin, effectiveRunner, cwd, scanResult, dryRun,
    fixerStrategy, authorizeBreaking, updateResult, advisorResults,
  });
  if (breakingError) return breakingError;

  // === Post-updater: OSV residual verification (driven by plugin.postUpdateOsvVerify) ===
  const residualVerification = await maybeRunOsvVerification({
    plugin, config, cwd, hostRunner, fixerStrategy, updateResult, dryRun,
  });

  return finalizeEcosystemOutcome(plugin, updateResult, residualVerification, advisorResults);
}

/**
 * Run residual OSV scan verification after updates are applied.
 * Best-effort: logs a warning on failure but never throws.
 */
async function runOsvResidualVerification(
  osvRunner: CommandRunner,
  cwd: string,
  dryRun: boolean,
  command: string,
): Promise<ResidualVerification> {
  if (dryRun) {
    logger.tagged('osv', 'DRY-RUN', `Would execute: ${command}`);
    return { status: 'skipped' };
  }
  logger.tagged('osv', 'OSV verify', `Running post-update OSV verification: ${command}`);
  try {
    const cmdResult = await osvRunner.run(command, { cwd });

    // Empty stdout means no vulnerabilities found (osv-scanner exits 0 with no output)
    if (!cmdResult.stdout.trim()) {
      return { status: 'verified', summary: {} };
    }

    let data: OsvJsonOutput;
    try {
      data = JSON.parse(cmdResult.stdout) as OsvJsonOutput;
    } catch {
      logger.tagged('osv', 'OSV verify', 'Could not parse osv-scanner JSON output — treating as non-fatal', 'warn');
      return { status: 'skipped' };
    }

    const summary = buildVerificationSummary(data);
    const hasResidual = Object.values(summary).some((n) => n > 0);
    if (hasResidual) {
      logger.tagged('osv', 'OSV verify', 'Residual CVEs detected after update — see summary for details', 'warn');
    }
    return hasResidual
      ? { status: 'unverified', summary }
      : { status: 'verified', summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.tagged('osv', 'OSV verify', `Post-update OSV verification failed (non-fatal): ${message}`, 'warn');
    return { status: 'skipped' };
  }
}
