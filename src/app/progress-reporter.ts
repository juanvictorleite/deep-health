import { Listr, type ListrRendererValue } from 'listr2';

import { badge } from '@infra/utils/ui';
import { setProgressSink } from '@infra/utils/logger';
import { __ } from '@core/i18n';
import { createQuietRunner } from '@infra/utils/quiet-runner';
import { resolveEcosystemRuntime } from '@infra/ecosystem-runtime';
import type { ScannerEngine, ScannerEngineContext } from '@modules/scanner/types';
import type { ProjectConfig } from '@core/types/config';
import type { CommandRunner } from '@core/types/common';
import type { ScanResultJson } from '@core/types/scan';
import type { AdvisorResult, ResidualVerification } from '@core/types/report';
import type { EcosystemPlugin } from '@modules/ecosystem/types';
import type { EcosystemConfig, FixerStrategyId, ValidationCommandConfig } from '@core/types/config';
import type { UpdateResultJson } from '@core/types/update';

// ─── Renderer selection ───────────────────────────────────────────────────────

export type RendererType = 'default' | 'verbose' | 'silent';

export function selectRenderer(opts: {
  verbose?: boolean;
  quiet?: boolean;
  json?: boolean;
}): RendererType {
  if (opts.verbose) return 'verbose';
  if (opts.quiet || opts.json) return 'silent';
  return 'default';
}

// ─── Ecosystem fix subtask builder ───────────────────────────────────────────

/**
 * Outcome union type mirrored from RunEcosystemFixOutcome.
 * Defined here to avoid a circular import with @orchestration/run-ecosystem-fix.
 */
export type EcosystemFixOutcome =
  | { status: 'skipped'; reason: 'no-updates'; advisorResults?: AdvisorResult[] }
  | { status: 'success'; updateResult: UpdateResultJson; residualVerification?: ResidualVerification; advisorResults?: AdvisorResult[] }
  | { status: 'error'; updateResult: UpdateResultJson; advisorResults?: AdvisorResult[] };

/**
 * Context resolved once per ecosystem fix run (shared across subtasks via closure).
 */
export interface ResolvedEcosystemFixContext {
  ecoEntry: EcosystemConfig;
  validationCommands: ValidationCommandConfig[] | undefined;
  fixerStrategy: FixerStrategyId;
  entryKey: string;
  ecosystemResult: ScanResultJson['ecosystems'][string] | undefined;
  hasUpdates: boolean;
}

/**
 * Injectable step-function interfaces injected by the orchestrator.
 * Progress-reporter.ts does NOT import from @orchestration/run-ecosystem-fix — the orchestrator
 * passes the bound step functions as arguments. This keeps the listr2 ceremony isolated in
 * this file while avoiding a circular dependency chain that would break existing mocks.
 */
export interface EcosystemFixStepFns {
  resolveContext(params: EcosystemFixSubtasksParams): Promise<ResolvedEcosystemFixContext>;
  resolveAdvisors(opts: {
    ecoEntry: EcosystemConfig;
    plugin: EcosystemPlugin;
    runner: CommandRunner;
    cwd: string;
    nonfatal: boolean;
  }): Promise<AdvisorResult[] | undefined>;
  executeOsvStagingPhase(opts: {
    plugin: EcosystemPlugin;
    fixerStrategy: FixerStrategyId;
    config: ProjectConfig;
    ecoEntry: EcosystemConfig;
    cwd: string;
    dryRun: boolean;
    verbose?: boolean;
  }): Promise<{ preFixBackups: Map<string, string> | undefined; osvFixOutcome: { applied: boolean; packagesUpdated: Array<{ name: string; versionFrom: string; versionTo: string }> } | undefined }>;
  runPluginUpdater(opts: {
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
    ecosystemResult: ScanResultJson['ecosystems'][string] | undefined;
    dryRun: boolean;
    entryKey: string;
    verbose?: boolean;
  }): Promise<UpdateResultJson>;
  executeBreakingInstall(opts: {
    plugin: EcosystemPlugin;
    effectiveRunner: CommandRunner;
    cwd: string;
    scanResult: ScanResultJson;
    dryRun: boolean;
    fixerStrategy: FixerStrategyId;
    authorizeBreaking: boolean;
    updateResult: UpdateResultJson;
    advisorResults: AdvisorResult[] | undefined;
    entryKey: string;
  }): Promise<EcosystemFixOutcome | undefined>;
  maybeRunOsvVerification(opts: {
    plugin: EcosystemPlugin;
    config: ProjectConfig;
    cwd: string;
    hostRunner: CommandRunner;
    fixerStrategy: FixerStrategyId;
    updateResult: UpdateResultJson;
    dryRun: boolean;
  }): Promise<ResidualVerification | undefined>;
  finalizeOutcome(
    plugin: EcosystemPlugin,
    updateResult: UpdateResultJson,
    residualVerification: ResidualVerification | undefined,
    advisorResults: AdvisorResult[] | undefined,
  ): EcosystemFixOutcome;
}

/**
 * Params for buildEcosystemFixSubtasks.
 */
export interface EcosystemFixSubtasksParams {
  plugin: EcosystemPlugin;
  ecoEntry?: EcosystemConfig;
  hostRunner: CommandRunner;
  config: ProjectConfig;
  scanResult: ScanResultJson;
  cwd: string;
  dryRun: boolean;
  authorizeBreaking: boolean;
  preRunSnapshots: Map<string, string> | undefined;
  projectRoot?: string;
  verbose?: boolean;
  steps: EcosystemFixStepFns;
  onOutcome: (outcome: EcosystemFixOutcome) => void;
}

type SubtaskDef = {
  title: string;
  task: (_ctx: unknown, task: { title: string; output: string }) => Promise<void>;
};

/**
 * Builds an array of Listr subtask definitions for the per-ecosystem fix phases.
 *
 * Intended to be passed to `task.newListr(subtasks, options)` inside the parent
 * Listr task, producing nested spinners for each internal phase.
 *
 * The adapter pattern: listr2 ceremony stays in this file; step functions are
 * injected via `params.steps` so this file does NOT import from run-ecosystem-fix.ts.
 * The orchestrator wires the real step functions before calling this builder.
 *
 * Context is resolved once in the first subtask and shared across all subtasks via
 * closure variables. Phase subtasks:
 *   (1) Docker runtime  — only when plugin.runtimeSpec exists
 *   (2) Advisors        — only when advisors are configured
 *   (3) OSV fix         — only when fixerStrategy is osv/osv-then-audit AND osvFixSpec exists
 *   (4) Ecosystem fixer — always (short-circuits when no updates)
 *   (5) Verification    — always (short-circuits when no updates or no update result)
 */
export function buildEcosystemFixSubtasks(params: EcosystemFixSubtasksParams): SubtaskDef[] {
  const { plugin, hostRunner, config, scanResult, cwd, dryRun, authorizeBreaking, preRunSnapshots, steps, onOutcome } = params;

  let fixCtx: ResolvedEcosystemFixContext | undefined;
  let effectiveRunner = hostRunner;
  let advisorResults: AdvisorResult[] | undefined;
  let preFixBackups: Map<string, string> | undefined;
  let osvFixOutcome: { applied: boolean; packagesUpdated: Array<{ name: string; versionFrom: string; versionTo: string }> } | undefined;
  let updateResult: UpdateResultJson | undefined;
  let done = false;

  async function getCtx(): Promise<ResolvedEcosystemFixContext> {
    if (!fixCtx) fixCtx = await steps.resolveContext(params);
    return fixCtx;
  }

  const subtasks: SubtaskDef[] = [];

  subtasks.push({
    title: __('Docker runtime'),
    task: async (_ctx, task) => {
      const ctx = await getCtx();
      if (!ctx.hasUpdates) {
        const skipAdvisors = await steps.resolveAdvisors({
          ecoEntry: ctx.ecoEntry, plugin, runner: hostRunner, cwd, nonfatal: true,
        });
        onOutcome({ status: 'skipped', reason: 'no-updates', advisorResults: skipAdvisors });
        done = true;
        task.title = __('Docker runtime') + ' — no updates';
        return;
      }
      if (!plugin.runtimeSpec) {
        task.title = __('Docker runtime') + ' — host runner';
        return;
      }
      setProgressSink((msg: string) => { task.output = msg; });
      try {
        const resolved = await resolveEcosystemRuntime({
          plugin,
          hostRunner,
          config,
          cwd,
          runnerConfig: ctx.ecoEntry.runner,
          projectRoot: params.projectRoot,
        });
        effectiveRunner = createQuietRunner(resolved);
        task.title = __('Docker runtime') + ' — ready';
      } finally {
        setProgressSink(null);
      }
    },
  });

  subtasks.push({
    title: __('Advisors'),
    task: async (_ctx, task) => {
      if (done) {
        task.title = __('Advisors') + ' — skipped';
        return;
      }
      const ctx = await getCtx();
      const advisors = ctx.ecoEntry.advisors ?? plugin.defaultAdvisors;
      if (advisors.length === 0) {
        task.title = __('Advisors') + ' — none configured';
        return;
      }
      setProgressSink((msg: string) => { task.output = msg; });
      try {
        advisorResults = await steps.resolveAdvisors({
          ecoEntry: ctx.ecoEntry, plugin, runner: effectiveRunner, cwd, nonfatal: false,
        });
      } finally {
        setProgressSink(null);
      }
      const count = advisorResults?.length ?? 0;
      task.title = __('Advisors') + ` — ${count} finding(s)`;
    },
  });

  subtasks.push({
    title: __('OSV fix'),
    task: async (_ctx, task) => {
      if (done) {
        task.title = __('OSV fix') + ' — skipped';
        return;
      }
      const ctx = await getCtx();
      const needsOsv =
        (ctx.fixerStrategy === 'osv' || ctx.fixerStrategy === 'osv-then-audit') &&
        !!plugin.osvFixSpec;
      if (!needsOsv) {
        task.title = __('OSV fix') + ' — not applicable';
        return;
      }
      setProgressSink((msg: string) => { task.output = msg; });
      try {
        const result = await steps.executeOsvStagingPhase({
          plugin,
          fixerStrategy: ctx.fixerStrategy,
          config,
          ecoEntry: ctx.ecoEntry,
          cwd,
          dryRun,
          verbose: false,
        });
        preFixBackups = result.preFixBackups;
        osvFixOutcome = result.osvFixOutcome;
      } finally {
        setProgressSink(null);
      }
      const count = osvFixOutcome?.packagesUpdated.length ?? 0;
      task.title = __('OSV fix') + ` — ${count} package(s) updated`;
    },
  });

  subtasks.push({
    title: __('Ecosystem fixer'),
    task: async (_ctx, task) => {
      if (done) {
        task.title = __('Ecosystem fixer') + ' — skipped';
        return;
      }
      const ctx = await getCtx();
      if (!plugin.runtimeSpec) {
        effectiveRunner = createQuietRunner(hostRunner);
      }
      setProgressSink((msg: string) => { task.output = msg; });
      try {
        updateResult = await steps.runPluginUpdater({
          plugin,
          effectiveRunner,
          config,
          scanResult,
          cwd,
          authorizeBreaking,
          validationCommands: ctx.validationCommands,
          fixerStrategy: ctx.fixerStrategy,
          preFixBackups,
          osvFixOutcome,
          preRunSnapshots,
          advisorResults,
          ecoEntry: ctx.ecoEntry,
          ecosystemResult: ctx.ecosystemResult,
          dryRun,
          entryKey: ctx.entryKey,
          verbose: false,
        });
      } finally {
        setProgressSink(null);
      }
      const count = updateResult.packages_updated.length;
      task.title = `${plugin.name} — ${count} package(s) updated`;
    },
  });

  subtasks.push({
    title: __('Verification'),
    task: async (_ctx, task) => {
      if (done || !updateResult) {
        task.title = __('Verification') + ' — skipped';
        return;
      }
      const ctx = await getCtx();
      const hasVerificationStep =
        plugin.postUpdateOsvVerify !== 'never' ||
        !!plugin.installBreakingPackages;
      if (!hasVerificationStep) {
        const outcome = steps.finalizeOutcome(plugin, updateResult, undefined, advisorResults);
        onOutcome(outcome);
        task.title = __('Verification') + ' — not applicable';
        return;
      }
      setProgressSink((msg: string) => { task.output = msg; });
      let residualVerification: ResidualVerification | undefined;
      try {
        const breakingError = await steps.executeBreakingInstall({
          plugin,
          effectiveRunner,
          cwd,
          scanResult,
          dryRun,
          fixerStrategy: ctx.fixerStrategy,
          authorizeBreaking,
          updateResult,
          advisorResults,
          entryKey: ctx.entryKey,
        });
        if (breakingError) {
          onOutcome(breakingError);
          task.title = __('Verification') + ' — breaking install failed';
          return;
        }
        residualVerification = await steps.maybeRunOsvVerification({
          plugin,
          config,
          cwd,
          hostRunner,
          fixerStrategy: ctx.fixerStrategy,
          updateResult,
          dryRun,
        });
      } finally {
        setProgressSink(null);
      }
      const outcome = steps.finalizeOutcome(plugin, updateResult, residualVerification, advisorResults);
      onOutcome(outcome);
      const hasResidual = residualVerification?.status === 'unverified';
      if (outcome.status === 'success') {
        task.title = __('Verification') + (hasResidual ? ' — residual CVEs' : ' — all passed');
      } else {
        task.title = __('Verification') + ' — error';
      }
    },
  });

  return subtasks;
}

// ─── Scan task list ───────────────────────────────────────────────────────────

export function buildScanTaskList(
  engines: ScannerEngine[],
  ctx: ScannerEngineContext,
  config: ProjectConfig,
  rendererType: RendererType,
): Listr<unknown, ListrRendererValue> {
  const tasks = engines.map((engine) => ({
    title: `${badge(engine.id)} ${engine.name}`,
    task: async (_: unknown, task: { output: string }) => {
      setProgressSink((msg: string) => {
        task.output = msg;
      });
      try {
        await engine.scan(ctx);
      } finally {
        setProgressSink(null);
      }
    },
  }));

  return new Listr(tasks, {
    renderer: rendererType,
    rendererOptions: rendererType === 'default'
      ? { collapseSubtasks: false, timer: { condition: true, field: 'Timer' } }
      : undefined,
    concurrent: false,
  });
}

// ─── Fix task list ────────────────────────────────────────────────────────────

export function buildFixTaskList(
  label: string,
  steps: Array<{ title: string; task: () => Promise<void> }>,
  rendererType: RendererType,
): Listr<unknown, ListrRendererValue> {
  const tasks = steps.map((step) => ({
    title: step.title,
    task: step.task,
  }));

  return new Listr(tasks, {
    renderer: rendererType,
    rendererOptions: rendererType === 'default'
      ? { collapseSubtasks: false, timer: { condition: true, field: 'Timer' } }
      : undefined,
    concurrent: false,
  });
}

// ─── Ecosystem fix task list ──────────────────────────────────────────────────

/**
 * Builds a Listr task list for the ecosystem fix loop.
 *
 * When an entry provides `buildSubtasks`, the parent task delegates to nested
 * listr2 subtasks (collapseSubtasks: true after completion). Each subtask owns
 * the progress sink exclusively during its execution.
 *
 * When an entry provides only `run`, the task wires setProgressSink to
 * task.output so logger.tagged() output routes to the rolling last-line display.
 * The sink is cleared in finally so the global singleton is not left dangling.
 */
export function buildEcosystemFixTaskList(
  entries: Array<{
    title: string;
    run?: () => Promise<void>;
    buildSubtasks?: () => SubtaskDef[];
  }>,
  rendererType: RendererType,
): Listr<unknown, ListrRendererValue> {
  const tasks = entries.map((entry) => ({
    title: entry.title,
    task: async (_: unknown, task: { output: string; newListr: (subtasks: SubtaskDef[], options?: Record<string, unknown>) => Listr<unknown, ListrRendererValue> }) => {
      if (entry.buildSubtasks) {
        return task.newListr(entry.buildSubtasks(), {
          rendererOptions: rendererType === 'default'
            ? { collapseSubtasks: true, timer: { condition: true, field: 'Timer' } }
            : undefined,
          concurrent: false,
        });
      }
      setProgressSink((msg: string) => {
        task.output = msg;
      });
      try {
        await entry.run!();
      } finally {
        setProgressSink(null);
      }
    },
  }));

  return new Listr(tasks, {
    renderer: rendererType,
    rendererOptions: rendererType === 'default'
      ? { collapseSubtasks: false, timer: { condition: true, field: 'Timer' } }
      : undefined,
    concurrent: false,
  });
}
