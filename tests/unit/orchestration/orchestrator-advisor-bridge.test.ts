/**
 * Tests verifying that the orchestrator reads advisor results from the
 * runEcosystemFix outcome and stores them in result.advisorResults[entryKey].
 *
 * Strategy: mock runEcosystemFix to return outcomes with advisorResults and
 * verify that the orchestrator stores them correctly in the rolling result.
 *
 * AC3: RunEcosystemFixOutcome includes advisorResults. Orchestrator reads
 * advisorResults from outcome and stores in result.advisorResults[entryKey].
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@infra/utils/logger', () => ({
  logger: {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    phase: vi.fn(), skip: vi.fn(), header: vi.fn(), tagged: vi.fn(),
  },
  setProgressSink: vi.fn(),
  makeProgressSink: vi.fn(),
}));

vi.mock('@infra/utils/git-branch', () => ({
  detectGitBranch: vi.fn().mockResolvedValue(null),
}));

vi.mock('@orchestration/osv-fix-applier', () => ({
  applyOsvFixViaStaging: vi.fn(),
}));

vi.mock('@core/gates/validator', () => ({
  validateGateA: vi.fn().mockReturnValue({ valid: true, gate: 'A', errors: [] }),
  validateEcosystemGate: vi.fn().mockReturnValue({ valid: true, gate: 'npm', errors: [] }),
}));

vi.mock('@infra/ecosystem-runtime', () => ({
  resolveEcosystemRuntime: vi.fn(async (_plugin: unknown, hostRunner: unknown) => hostRunner),
  resolveOsvRuntime: vi.fn((_config: unknown, _cwd: unknown, hostRunner: unknown) => hostRunner),
}));

// runAdvisors is now called inside runEcosystemFix, not in orchestrator
vi.mock('@modules/advisor/index', () => ({
  runAdvisors: vi.fn().mockResolvedValue([]),
}));

// Mock runEcosystemFix — the orchestrator reads advisorResults from the outcome
import type { RunEcosystemFixOutcome } from '@orchestration/run-ecosystem-fix';
let mockedOutcome: RunEcosystemFixOutcome = { status: 'skipped', reason: 'no-updates' };
vi.mock('@orchestration/run-ecosystem-fix', () => ({
  runEcosystemFix: vi.fn(async () => mockedOutcome),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

import { runOrchestrator } from '@orchestration/orchestrator';
import type { CommandRunner, CommandResult, CommandRunnerOptions } from '@core/types/common';
import type { ProjectConfig } from '@core/types/config';
import type { ScanResultJson } from '@core/types/scan';
import type { AdvisorResult, AdvisorFinding } from '@core/types/report';
import type { UpdateResultJson } from '@core/types/update';
import { ScannerEngineRegistry } from '@modules/scanner/registry';
import type { ScannerEngine, ScannerEngineContext } from '@modules/scanner/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

class MockRunner implements CommandRunner {
  readonly dryRun = false;
  readonly environment = 'local' as const;
  async run(_cmd: string, _opts?: CommandRunnerOptions): Promise<CommandResult> {
    return { stdout: '', stderr: '', exitCode: 0, command: _cmd, dryRun: false };
  }
  async runArgs(file: string, args: string[]): Promise<CommandResult> {
    return this.run([file, ...args].join(' '));
  }
}

function makeScanResult(): ScanResultJson {
  return {
    $schema: 'osv-scan-result/v1',
    status: 'success',
    agent: 'osv',
    environment: 'local',
    ecosystems: {
      npm: {
        vulnerabilities_total: 1,
        auto_safe: 1,
        breaking: 0,
        manual: 0,
        auto_safe_packages: ['lodash@4.17.21'],
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: [],
      },
    },
    error: null,
  };
}

function makeAdvisorFinding(pkg: string): AdvisorFinding {
  return {
    package: pkg,
    severity: 'high',
    title: `Vuln in ${pkg}`,
  };
}

function makeAdvisorResult(findingsList?: AdvisorFinding[]): AdvisorResult {
  return {
    name: 'npm-audit',
    command: 'npm audit --json',
    exitCode: 0,
    status: findingsList ? 'findings' : 'clean',
    output: '',
    ...(findingsList ? { findings: findingsList } : {}),
  };
}

function makeUpdateResult(): UpdateResultJson {
  return {
    $schema: 'osv-update-result/v1',
    agent: 'npm-safe-update',
    status: 'success',
    packages_updated: [],
    packages_skipped: [],
    packages_pending_breaking: [],
    validations: [],
    error: null,
  };
}

/**
 * Build a minimal ScannerEngineRegistry with a fake OSV engine that returns
 * the given scan result.
 */
function makeScannerRegistry(scanResult: ScanResultJson): ScannerEngineRegistry {
  const registry = new ScannerEngineRegistry();
  const fakeOsvEngine: ScannerEngine = {
    id: 'osv',
    name: 'OSV Scanner (fake)',
    phase: 'scan',
    async scan(_ctx: ScannerEngineContext): Promise<ScanResultJson> {
      return scanResult;
    },
  };
  registry.register(fakeOsvEngine);
  return registry;
}

function makeConfig(pluginId = 'npm'): ProjectConfig {
  return {
    project: { name: 'Test', client: 'Test' },
    ecosystems: [{ id: pluginId, advisors: [{ name: 'audit', command: 'npm audit --json', format: 'json' }] }],
    protected_packages: {},
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: false,
    },
    conflict_resolution: 'fail',
    scanners: { osv: { runner: 'local' } },
  } as unknown as ProjectConfig;
}

async function makeNpmRegistry() {
  const { EcosystemRegistry } = await import('@modules/ecosystem/index');
  const registry = new EcosystemRegistry();
  const fakeNpmPlugin = {
    id: 'npm',
    name: 'npm',
    lockfiles: ['package-lock.json'],
    osvEcosystems: ['npm'],
    reportLabel: 'npm',
    supportedFixers: ['osv'],
    defaultValidationCommands: [],
    defaultAdvisors: [{ name: 'audit', command: 'npm audit --json', format: 'json' }],
    buildScanArgs: () => ['--lockfile', 'package-lock.json'],
    getProtectedPackages: () => [],
    runUpdater: vi.fn().mockResolvedValue(makeUpdateResult()),
    postUpdateOsvVerify: 'never',
  } as any;
  registry.register(fakeNpmPlugin);
  return registry;
}

// ── AC3: orchestrator reads advisorResults from runEcosystemFix outcome ────────

describe('runOrchestrator — advisor results from runEcosystemFix outcome (AC3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores advisorResults in result.advisorResults[entryKey] when outcome contains them', async () => {
    const scanResult = makeScanResult();
    const npmAdvisorResults: AdvisorResult[] = [
      makeAdvisorResult([makeAdvisorFinding('lodash')]),
    ];

    // runEcosystemFix returns a success outcome with advisorResults
    mockedOutcome = {
      status: 'success',
      updateResult: makeUpdateResult(),
      advisorResults: npmAdvisorResults,
    };

    const registry = await makeNpmRegistry();
    const result = await runOrchestrator(new MockRunner(), makeConfig('npm'), {
      configPath: 'security-scan.config.json',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      registry,
      scannerRegistry: makeScannerRegistry(scanResult),
    });

    // Orchestrator should have stored advisorResults from the outcome under entryKey 'npm'
    expect(result.advisorResults['npm']).toEqual(npmAdvisorResults);
  });

  it('stores advisorResults when outcome status is error and contains them', async () => {
    const scanResult = makeScanResult();
    const npmAdvisorResults: AdvisorResult[] = [
      makeAdvisorResult([makeAdvisorFinding('express')]),
    ];

    // runEcosystemFix returns an error outcome with advisorResults
    mockedOutcome = {
      status: 'error',
      updateResult: { ...makeUpdateResult(), status: 'error', error: 'update failed' },
      advisorResults: npmAdvisorResults,
    };

    const registry = await makeNpmRegistry();
    const result = await runOrchestrator(new MockRunner(), makeConfig('npm'), {
      configPath: 'security-scan.config.json',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      registry,
      scannerRegistry: makeScannerRegistry(scanResult),
    });

    expect(result.advisorResults['npm']).toEqual(npmAdvisorResults);
  });

  it('does NOT set result.advisorResults[entryKey] when outcome has no advisorResults', async () => {
    const scanResult = makeScanResult();

    // runEcosystemFix returns a success outcome without advisorResults
    mockedOutcome = {
      status: 'success',
      updateResult: makeUpdateResult(),
      // advisorResults intentionally omitted
    };

    const registry = await makeNpmRegistry();
    const result = await runOrchestrator(new MockRunner(), makeConfig('npm'), {
      configPath: 'security-scan.config.json',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      registry,
      scannerRegistry: makeScannerRegistry(scanResult),
    });

    // When outcome has no advisorResults, the key should be absent (not set to undefined)
    expect(result.advisorResults['npm']).toBeUndefined();
  });

  it('does NOT set result.advisorResults[entryKey] when outcome is skipped', async () => {
    const scanResult = makeScanResult();

    // runEcosystemFix returns a skipped outcome (no advisorResults — advisors should not run)
    mockedOutcome = { status: 'skipped', reason: 'no-updates' };

    const registry = await makeNpmRegistry();
    const result = await runOrchestrator(new MockRunner(), makeConfig('npm'), {
      configPath: 'security-scan.config.json',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      registry,
      scannerRegistry: makeScannerRegistry(scanResult),
    });

    // Skipped ecosystem: advisorResults should not be set
    expect(result.advisorResults['npm']).toBeUndefined();
  });

  it('orchestrator does NOT call runAdvisors directly (advisors run inside runEcosystemFix)', async () => {
    const scanResult = makeScanResult();
    const { runAdvisors } = await import('@modules/advisor/index');

    mockedOutcome = {
      status: 'success',
      updateResult: makeUpdateResult(),
    };

    const registry = await makeNpmRegistry();
    await runOrchestrator(new MockRunner(), makeConfig('npm'), {
      configPath: 'security-scan.config.json',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      registry,
      scannerRegistry: makeScannerRegistry(scanResult),
    });

    // The orchestrator must not call runAdvisors directly — it delegates to runEcosystemFix
    expect(runAdvisors).not.toHaveBeenCalled();
  });
});
