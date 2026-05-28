/**
 * Tests for src/app/progress-reporter.ts
 * Covers renderer selection, Listr task-list construction, and ecosystem fix subtask builder.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@infra/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), phase: vi.fn(), skip: vi.fn(), header: vi.fn(), tagged: vi.fn() },
  setProgressSink: vi.fn(),
  makeProgressSink: vi.fn(),
}));

import { Listr, PRESET_TIMER } from 'listr2';
import {
  selectRenderer,
  buildScanTaskList,
  buildFixTaskList,
  buildEcosystemFixTaskList,
  buildEcosystemFixSubtasks,
} from '@app/progress-reporter';
import type { EcosystemFixStepFns, EcosystemFixSubtasksParams } from '@app/progress-reporter';
import type { ScannerEngine, ScannerEngineContext } from '@modules/scanner/types';
import type { ProjectConfig } from '@core/types/config';
import type { EcosystemPlugin } from '@modules/ecosystem/types';
import type { UpdateResultJson } from '@core/types/update';
import type { CommandRunner, CommandResult } from '@core/types/common';

// ─── selectRenderer() ─────────────────────────────────────────────────────────

describe('selectRenderer()', () => {
  it('returns "verbose" when verbose is true', () => {
    expect(selectRenderer({ verbose: true })).toBe('verbose');
  });

  it('returns "silent" when quiet is true', () => {
    expect(selectRenderer({ quiet: true })).toBe('silent');
  });

  it('returns "silent" when json is true', () => {
    expect(selectRenderer({ json: true })).toBe('silent');
  });

  it('returns "default" when no flags are set', () => {
    expect(selectRenderer({})).toBe('default');
  });

  it('returns "default" when all flags are false', () => {
    expect(selectRenderer({ verbose: false, quiet: false, json: false })).toBe('default');
  });

  it('verbose takes precedence over quiet', () => {
    expect(selectRenderer({ verbose: true, quiet: true })).toBe('verbose');
  });

  it('verbose takes precedence over json', () => {
    expect(selectRenderer({ verbose: true, json: true })).toBe('verbose');
  });
});

// ─── buildScanTaskList() ──────────────────────────────────────────────────────

function makeMockEngine(id: string, name: string): ScannerEngine {
  return { id, name, scan: vi.fn().mockResolvedValue({ status: 'success', ecosystems: {} }) } as unknown as ScannerEngine;
}

describe('buildScanTaskList()', () => {
  const ctx = {} as ScannerEngineContext;
  const config = {} as ProjectConfig;

  it('returns a Listr instance', () => {
    const engines = [makeMockEngine('osv', 'OSV Scanner')];
    const list = buildScanTaskList(engines, ctx, config, 'silent');
    expect(list).toBeInstanceOf(Listr);
  });

  it('creates one task per engine', () => {
    const engines = [
      makeMockEngine('osv', 'OSV Scanner'),
      makeMockEngine('sonarqube', 'SonarQube'),
    ];
    const list = buildScanTaskList(engines, ctx, config, 'silent');
    // Listr exposes the task count via .tasks
    expect((list as unknown as { tasks: unknown[] }).tasks).toHaveLength(2);
  });

  it('includes the engine name in the task title', () => {
    const engines = [makeMockEngine('npm', 'NPM Audit')];
    const list = buildScanTaskList(engines, ctx, config, 'silent');
    const tasks = (list as unknown as { tasks: Array<{ title: string }> }).tasks;
    expect(tasks[0].title).toContain('NPM Audit');
  });

  it('accepts the "verbose" renderer without throwing', () => {
    const engines = [makeMockEngine('osv', 'OSV Scanner')];
    expect(() => buildScanTaskList(engines, ctx, config, 'verbose')).not.toThrow();
  });

  it('includes timer config in rendererOptions for default renderer', () => {
    const engines = [makeMockEngine('osv', 'OSV Scanner')];
    const list = buildScanTaskList(engines, ctx, config, 'default');
    const opts = (list as unknown as { options: { rendererOptions?: { timer?: unknown } } }).options;
    expect(opts.rendererOptions?.timer).toBeDefined();
    expect(opts.rendererOptions?.timer).toBe(PRESET_TIMER);
  });

  it('does not set rendererOptions for silent renderer', () => {
    const engines = [makeMockEngine('osv', 'OSV Scanner')];
    const list = buildScanTaskList(engines, ctx, config, 'silent');
    const opts = (list as unknown as { options: { rendererOptions?: unknown } }).options;
    expect(opts.rendererOptions).toBeUndefined();
  });
});

// ─── buildFixTaskList() ───────────────────────────────────────────────────────

describe('buildFixTaskList()', () => {
  it('returns a Listr instance', () => {
    const steps = [{ title: 'Apply fixes', task: vi.fn().mockResolvedValue(undefined) }];
    const list = buildFixTaskList('npm-fix', steps, 'silent');
    expect(list).toBeInstanceOf(Listr);
  });

  it('creates one task per step', () => {
    const steps = [
      { title: 'Step A', task: vi.fn().mockResolvedValue(undefined) },
      { title: 'Step B', task: vi.fn().mockResolvedValue(undefined) },
      { title: 'Step C', task: vi.fn().mockResolvedValue(undefined) },
    ];
    const list = buildFixTaskList('label', steps, 'silent');
    expect((list as unknown as { tasks: unknown[] }).tasks).toHaveLength(3);
  });

  it('preserves each step title', () => {
    const steps = [{ title: 'Revert lock file', task: vi.fn().mockResolvedValue(undefined) }];
    const list = buildFixTaskList('label', steps, 'silent');
    const tasks = (list as unknown as { tasks: Array<{ title: string }> }).tasks;
    expect(tasks[0].title).toBe('Revert lock file');
  });

  it('includes timer config in rendererOptions for default renderer', () => {
    const steps = [{ title: 'Install deps', task: vi.fn().mockResolvedValue(undefined) }];
    const list = buildFixTaskList('label', steps, 'default');
    const opts = (list as unknown as { options: { rendererOptions?: { timer?: unknown } } }).options;
    expect(opts.rendererOptions?.timer).toBeDefined();
    expect(opts.rendererOptions?.timer).toBe(PRESET_TIMER);
  });

  it('does not set rendererOptions for silent renderer', () => {
    const steps = [{ title: 'Install deps', task: vi.fn().mockResolvedValue(undefined) }];
    const list = buildFixTaskList('label', steps, 'silent');
    const opts = (list as unknown as { options: { rendererOptions?: unknown } }).options;
    expect(opts.rendererOptions).toBeUndefined();
  });
});

// ─── buildEcosystemFixTaskList() ──────────────────────────────────────────────

describe('buildEcosystemFixTaskList()', () => {
  it('returns a Listr instance', () => {
    const entries = [{ title: '[NPM] npm', run: vi.fn().mockResolvedValue(undefined) }];
    const list = buildEcosystemFixTaskList(entries, 'silent');
    expect(list).toBeInstanceOf(Listr);
  });

  it('creates one task per entry', () => {
    const entries = [
      { title: '[NPM] npm', run: vi.fn().mockResolvedValue(undefined) },
      { title: '[COMPOSER] Composer', run: vi.fn().mockResolvedValue(undefined) },
      { title: '[PIP] pip', run: vi.fn().mockResolvedValue(undefined) },
    ];
    const list = buildEcosystemFixTaskList(entries, 'silent');
    expect((list as unknown as { tasks: unknown[] }).tasks).toHaveLength(3);
  });

  it('preserves the entry title on each task', () => {
    const entries = [{ title: '[NPM] npm', run: vi.fn().mockResolvedValue(undefined) }];
    const list = buildEcosystemFixTaskList(entries, 'silent');
    const tasks = (list as unknown as { tasks: Array<{ title: string }> }).tasks;
    expect(tasks[0].title).toBe('[NPM] npm');
  });

  it('includes timer config in rendererOptions for default renderer', () => {
    const entries = [{ title: '[NPM] npm', run: vi.fn().mockResolvedValue(undefined) }];
    const list = buildEcosystemFixTaskList(entries, 'default');
    const opts = (list as unknown as { options: { rendererOptions?: { timer?: unknown } } }).options;
    expect(opts.rendererOptions?.timer).toBeDefined();
    expect(opts.rendererOptions?.timer).toBe(PRESET_TIMER);
  });

  it('does not set rendererOptions for verbose renderer', () => {
    const entries = [{ title: '[NPM] npm', run: vi.fn().mockResolvedValue(undefined) }];
    const list = buildEcosystemFixTaskList(entries, 'verbose');
    const opts = (list as unknown as { options: { rendererOptions?: unknown } }).options;
    expect(opts.rendererOptions).toBeUndefined();
  });

  it('does not set rendererOptions for silent renderer', () => {
    const entries = [{ title: '[NPM] npm', run: vi.fn().mockResolvedValue(undefined) }];
    const list = buildEcosystemFixTaskList(entries, 'silent');
    const opts = (list as unknown as { options: { rendererOptions?: unknown } }).options;
    expect(opts.rendererOptions).toBeUndefined();
  });

  it('creates an empty task list when entries array is empty', () => {
    const list = buildEcosystemFixTaskList([], 'silent');
    expect((list as unknown as { tasks: unknown[] }).tasks).toHaveLength(0);
  });

  it('accepts verbose renderer without throwing', () => {
    const entries = [{ title: '[NPM] npm', run: vi.fn().mockResolvedValue(undefined) }];
    expect(() => buildEcosystemFixTaskList(entries, 'verbose')).not.toThrow();
  });

  it('creates one task per entry when entries have buildSubtasks', () => {
    const entries = [
      { title: '[NPM] npm', buildSubtasks: () => [] },
      { title: '[PIP] pip', buildSubtasks: () => [] },
    ];
    const list = buildEcosystemFixTaskList(entries, 'silent');
    expect((list as unknown as { tasks: unknown[] }).tasks).toHaveLength(2);
  });

  it('preserves entry title when entry has buildSubtasks', () => {
    const entries = [{ title: '[NPM] npm', buildSubtasks: () => [] }];
    const list = buildEcosystemFixTaskList(entries, 'silent');
    const tasks = (list as unknown as { tasks: Array<{ title: string }> }).tasks;
    expect(tasks[0].title).toBe('[NPM] npm');
  });
});

// ─── buildEcosystemFixSubtasks() ─────────────────────────────────────────────

function makeSuccessUpdateResult(): UpdateResultJson {
  return {
    $schema: 'osv-update-result/v1',
    agent: 'test',
    status: 'success',
    packages_updated: [{ name: 'lodash', versionFrom: '4.17.15', versionTo: '4.17.21' }],
    packages_skipped: [],
    packages_pending_breaking: [],
    validations: [{ name: 'test', status: 'skipped' as const }],
    error: null,
  };
}

function makePlugin(overrides: Partial<EcosystemPlugin> = {}): EcosystemPlugin {
  return {
    id: 'npm',
    name: 'npm',
    manifest: 'package.json',
    osvEcosystems: ['npm'],
    reportLabel: 'npm',
    supportedFixers: ['osv'],
    defaultValidationCommands: [],
    defaultAdvisors: [],
    buildScanArgs: () => ['--lockfile', 'package-lock.json'],
    getProtectedPackages: () => [],
    runUpdater: vi.fn().mockResolvedValue(makeSuccessUpdateResult()),
    postUpdateOsvVerify: 'never',
    ...overrides,
  } as unknown as EcosystemPlugin;
}

function makeMockRunner(): CommandRunner {
  return {
    dryRun: false,
    environment: 'local' as const,
    run: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, command: '', dryRun: false } as CommandResult),
    runArgs: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, command: '', dryRun: false } as CommandResult),
  };
}

function makeMinimalSteps(overrides: Partial<EcosystemFixStepFns> = {}): EcosystemFixStepFns {
  return {
    resolveContext: vi.fn().mockResolvedValue({
      ecoEntry: { id: 'npm', advisors: [] },
      validationCommands: undefined,
      fixerStrategy: 'osv',
      entryKey: 'npm',
      ecosystemResult: { vulnerabilities_total: 1, auto_safe: 1, breaking: 0, manual: 0, auto_safe_packages: [], breaking_packages: [], manual_packages: [], vulnerabilities: [] },
      hasUpdates: true,
    }),
    resolveAdvisors: vi.fn().mockResolvedValue(undefined),
    executeOsvStagingPhase: vi.fn().mockResolvedValue({ preFixBackups: undefined, osvFixOutcome: undefined }),
    runPluginUpdater: vi.fn().mockResolvedValue(makeSuccessUpdateResult()),
    executeBreakingInstall: vi.fn().mockResolvedValue(undefined),
    maybeRunOsvVerification: vi.fn().mockResolvedValue(undefined),
    finalizeOutcome: vi.fn().mockReturnValue({ status: 'success', updateResult: makeSuccessUpdateResult() }),
    ...overrides,
  };
}

function makeSubtaskParams(pluginOverrides: Partial<EcosystemPlugin> = {}, stepsOverrides: Partial<EcosystemFixStepFns> = {}): EcosystemFixSubtasksParams {
  return {
    plugin: makePlugin(pluginOverrides),
    hostRunner: makeMockRunner(),
    config: {} as ProjectConfig,
    scanResult: { $schema: 'osv-scan-result/v1', status: 'success', agent: 'osv', environment: 'local', ecosystems: { npm: { vulnerabilities_total: 1, auto_safe: 1, breaking: 0, manual: 0, auto_safe_packages: [], breaking_packages: [], manual_packages: [], vulnerabilities: [] } }, error: null },
    cwd: '/project',
    dryRun: false,
    authorizeBreaking: false,
    preRunSnapshots: undefined,
    steps: makeMinimalSteps(stepsOverrides),
    onOutcome: vi.fn(),
  };
}

async function runSubtask(subtasks: ReturnType<typeof buildEcosystemFixSubtasks>, index: number): Promise<{ title: string }> {
  const subtask = subtasks[index];
  const fakeTask = { title: subtask.title, output: '' };
  await subtask.task(undefined, fakeTask);
  return fakeTask;
}

describe('buildEcosystemFixSubtasks()', () => {
  it('returns an array of 5 subtask definitions', () => {
    const params = makeSubtaskParams();
    const subtasks = buildEcosystemFixSubtasks(params);
    expect(subtasks).toHaveLength(5);
  });

  it('subtask titles match expected phase names', () => {
    const params = makeSubtaskParams();
    const subtasks = buildEcosystemFixSubtasks(params);
    expect(subtasks[0].title).toContain('Docker runtime');
    expect(subtasks[1].title).toContain('Advisors');
    expect(subtasks[2].title).toContain('OSV fix');
    expect(subtasks[3].title).toContain('Ecosystem fixer');
    expect(subtasks[4].title).toContain('Verification');
  });

  it('Docker runtime subtask updates title to "host runner" when plugin has no runtimeSpec', async () => {
    const params = makeSubtaskParams({ runtimeSpec: undefined });
    const subtasks = buildEcosystemFixSubtasks(params);
    const result = await runSubtask(subtasks, 0);
    expect(result.title).toContain('host runner');
  });

  it('Docker runtime subtask sets done=true and calls onOutcome with skipped when hasUpdates is false', async () => {
    const onOutcome = vi.fn();
    const steps = makeMinimalSteps({
      resolveContext: vi.fn().mockResolvedValue({
        ecoEntry: { id: 'npm', advisors: [] },
        validationCommands: undefined,
        fixerStrategy: 'osv',
        entryKey: 'npm',
        ecosystemResult: undefined,
        hasUpdates: false,
      }),
      resolveAdvisors: vi.fn().mockResolvedValue(undefined),
    });
    const params = { ...makeSubtaskParams({}, steps), onOutcome };
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0);
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', reason: 'no-updates' }));
  });

  it('Advisors subtask skips when done flag is set (previous skipped)', async () => {
    const steps = makeMinimalSteps({
      resolveContext: vi.fn().mockResolvedValue({
        ecoEntry: { id: 'npm', advisors: [] },
        validationCommands: undefined,
        fixerStrategy: 'osv',
        entryKey: 'npm',
        ecosystemResult: undefined,
        hasUpdates: false,
      }),
      resolveAdvisors: vi.fn().mockResolvedValue(undefined),
    });
    const params = makeSubtaskParams({}, steps);
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0); // Docker runtime sets done=true
    const result = await runSubtask(subtasks, 1); // Advisors
    expect(result.title).toContain('skipped');
    expect(steps.resolveAdvisors).toHaveBeenCalledTimes(1); // only in Docker runtime for skip case
  });

  it('Advisors subtask reports "none configured" when advisors list is empty', async () => {
    const params = makeSubtaskParams();
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0); // run Docker runtime (no runtimeSpec path, hasUpdates=true)
    const result = await runSubtask(subtasks, 1);
    expect(result.title).toContain('none configured');
  });

  it('Advisors subtask reports count when advisors run and return results', async () => {
    const advisorResults = [{ name: 'audit', command: 'npm audit', exitCode: 0, status: 'clean' as const, output: '' }];
    const steps = makeMinimalSteps({
      resolveContext: vi.fn().mockResolvedValue({
        ecoEntry: { id: 'npm', advisors: [{ name: 'audit', command: 'npm audit', format: 'text' }] },
        validationCommands: undefined,
        fixerStrategy: 'osv',
        entryKey: 'npm',
        ecosystemResult: { vulnerabilities_total: 1, auto_safe: 1, breaking: 0, manual: 0, auto_safe_packages: [], breaking_packages: [], manual_packages: [], vulnerabilities: [] },
        hasUpdates: true,
      }),
      resolveAdvisors: vi.fn().mockResolvedValue(advisorResults),
      executeOsvStagingPhase: vi.fn().mockResolvedValue({ preFixBackups: undefined, osvFixOutcome: undefined }),
    });
    const params = makeSubtaskParams({}, steps);
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0); // Docker runtime
    const result = await runSubtask(subtasks, 1); // Advisors
    expect(result.title).toContain('1 finding(s)');
  });

  it('OSV fix subtask reports "not applicable" when fixer strategy is not osv/osv-then-audit', async () => {
    const steps = makeMinimalSteps({
      resolveContext: vi.fn().mockResolvedValue({
        ecoEntry: { id: 'npm', advisors: [] },
        validationCommands: undefined,
        fixerStrategy: 'npm-audit',
        entryKey: 'npm',
        ecosystemResult: { vulnerabilities_total: 1, auto_safe: 1, breaking: 0, manual: 0, auto_safe_packages: [], breaking_packages: [], manual_packages: [], vulnerabilities: [] },
        hasUpdates: true,
      }),
      resolveAdvisors: vi.fn().mockResolvedValue(undefined),
    });
    const params = makeSubtaskParams({}, steps);
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0);
    await runSubtask(subtasks, 1);
    const result = await runSubtask(subtasks, 2);
    expect(result.title).toContain('not applicable');
  });

  it('OSV fix subtask reports package count after staging phase runs', async () => {
    const steps = makeMinimalSteps({
      executeOsvStagingPhase: vi.fn().mockResolvedValue({
        preFixBackups: undefined,
        osvFixOutcome: { applied: true, packagesUpdated: [{ name: 'pkg', versionFrom: '1.0.0', versionTo: '1.0.1' }, { name: 'pkg2', versionFrom: '2.0.0', versionTo: '2.0.1' }] },
      }),
    });
    const params = makeSubtaskParams({ osvFixSpec: { fixLockfile: 'package-lock.json', backupFiles: [] } }, steps);
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0);
    await runSubtask(subtasks, 1);
    const result = await runSubtask(subtasks, 2);
    expect(result.title).toContain('2 package(s) updated');
  });

  it('Ecosystem fixer subtask reports package count from update result', async () => {
    const params = makeSubtaskParams();
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0);
    await runSubtask(subtasks, 1);
    await runSubtask(subtasks, 2);
    const result = await runSubtask(subtasks, 3);
    expect(result.title).toContain('npm — 1 package(s) updated');
  });

  it('Verification subtask reports "all passed" on success', async () => {
    const onOutcome = vi.fn();
    // postUpdateOsvVerify must be non-'never' so hasVerificationStep=true and we reach the
    // "all passed" path. Default makePlugin() uses 'never' which triggers the "not applicable" branch.
    const params = { ...makeSubtaskParams({ postUpdateOsvVerify: 'always' }), onOutcome };
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0);
    await runSubtask(subtasks, 1);
    await runSubtask(subtasks, 2);
    await runSubtask(subtasks, 3);
    const result = await runSubtask(subtasks, 4);
    expect(result.title).toContain('all passed');
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });

  it('Verification subtask reports "not applicable" when plugin has postUpdateOsvVerify=never and no installBreakingPackages', async () => {
    const onOutcome = vi.fn();
    const params = { ...makeSubtaskParams({ postUpdateOsvVerify: 'never', installBreakingPackages: undefined }), onOutcome };
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0);
    await runSubtask(subtasks, 1);
    await runSubtask(subtasks, 2);
    await runSubtask(subtasks, 3);
    const result = await runSubtask(subtasks, 4);
    expect(result.title).toContain('not applicable');
    expect(onOutcome).toHaveBeenCalled();
  });

  it('Verification subtask reports "residual CVEs" when residual verification is unverified', async () => {
    const onOutcome = vi.fn();
    const steps = makeMinimalSteps({
      maybeRunOsvVerification: vi.fn().mockResolvedValue({ status: 'unverified', summary: { npm: 2 } }),
      finalizeOutcome: vi.fn().mockReturnValue({ status: 'success', updateResult: makeSuccessUpdateResult(), residualVerification: { status: 'unverified', summary: { npm: 2 } } }),
    });
    const params = { ...makeSubtaskParams({ postUpdateOsvVerify: 'always' }, steps), onOutcome };
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0);
    await runSubtask(subtasks, 1);
    await runSubtask(subtasks, 2);
    await runSubtask(subtasks, 3);
    const result = await runSubtask(subtasks, 4);
    expect(result.title).toContain('residual CVEs');
  });

  it('Verification subtask calls onOutcome with breaking error when executeBreakingInstall returns error', async () => {
    const onOutcome = vi.fn();
    const breakingError = { status: 'error' as const, updateResult: { ...makeSuccessUpdateResult(), status: 'error' as const, error: 'breaking install failed' } };
    const steps = makeMinimalSteps({
      executeBreakingInstall: vi.fn().mockResolvedValue(breakingError),
    });
    const params = { ...makeSubtaskParams({ postUpdateOsvVerify: 'always', installBreakingPackages: vi.fn() as any }, steps), onOutcome };
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0);
    await runSubtask(subtasks, 1);
    await runSubtask(subtasks, 2);
    await runSubtask(subtasks, 3);
    const result = await runSubtask(subtasks, 4);
    expect(onOutcome).toHaveBeenCalledWith(breakingError);
    expect(result.title).toContain('breaking install failed');
  });

  it('clears the progress sink in finally even when a step throws', async () => {
    const { setProgressSink } = await import('@infra/utils/logger');
    const steps = makeMinimalSteps({
      executeOsvStagingPhase: vi.fn().mockRejectedValue(new Error('staging failed')),
    });
    const params = makeSubtaskParams({ osvFixSpec: { fixLockfile: 'package-lock.json', backupFiles: [] } }, steps);
    const subtasks = buildEcosystemFixSubtasks(params);
    await runSubtask(subtasks, 0);
    await runSubtask(subtasks, 1);
    await expect(runSubtask(subtasks, 2)).rejects.toThrow('staging failed');
    expect(setProgressSink).toHaveBeenLastCalledWith(null);
  });
});
