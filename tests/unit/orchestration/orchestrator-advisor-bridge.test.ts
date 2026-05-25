/**
 * Tests verifying that the orchestrator passes advisor results
 * for the current plugin to runEcosystemFix() (AC4).
 *
 * Strategy: mock runEcosystemFix and capture its params to verify
 * that advisorResults[plugin.id] is forwarded correctly.
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

// Mock runAdvisors to return controlled advisor results
vi.mock('@modules/advisor/index', () => ({
  runAdvisors: vi.fn().mockResolvedValue([]),
}));

// Mock runEcosystemFix so we can capture the params it receives
const capturedRunEcosystemFixParams: Parameters<typeof import('@orchestration/run-ecosystem-fix').runEcosystemFix>[0][] = [];
vi.mock('@orchestration/run-ecosystem-fix', () => ({
  runEcosystemFix: vi.fn(async (params: Parameters<typeof import('@orchestration/run-ecosystem-fix').runEcosystemFix>[0]) => {
    capturedRunEcosystemFixParams.push(params);
    return { status: 'skipped', reason: 'no-updates' };
  }),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

import { runOrchestrator } from '@orchestration/orchestrator';
import { runAdvisors } from '@modules/advisor/index';
import type { CommandRunner, CommandResult, CommandRunnerOptions } from '@core/types/common';
import type { ProjectConfig } from '@core/types/config';
import type { ScanResultJson } from '@core/types/scan';
import type { AdvisorResult, AdvisorFinding } from '@core/types/report';
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

// ── AC4: orchestrator passes advisor results to runEcosystemFix ───────────────

describe('runOrchestrator — advisor results threading to runEcosystemFix (AC4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRunEcosystemFixParams.length = 0;
  });

  it('passes advisor results for the current plugin to runEcosystemFix', async () => {
    const scanResult = makeScanResult();
    const npmAdvisorResults: AdvisorResult[] = [
      makeAdvisorResult([makeAdvisorFinding('lodash')]),
    ];

    // runAdvisors returns controlled results for npm plugin
    vi.mocked(runAdvisors).mockResolvedValueOnce(npmAdvisorResults);

    // Use a fake EcosystemRegistry with npm plugin
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
      runUpdater: vi.fn().mockResolvedValue({
        $schema: 'osv-update-result/v1',
        agent: 'npm-safe-update',
        status: 'success',
        packages_updated: [],
        packages_skipped: [],
        packages_pending_breaking: [],
        validations: [],
        error: null,
      }),
      postUpdateOsvVerify: 'never',
    } as any;

    registry.register(fakeNpmPlugin);

    await runOrchestrator(new MockRunner(), makeConfig('npm'), {
      configPath: 'project-config.yml',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      registry,
      scannerRegistry: makeScannerRegistry(scanResult),
    });

    // runEcosystemFix should have been called with the npm advisor results
    const fixCall = capturedRunEcosystemFixParams.find((p) => p.plugin.id === 'npm');
    expect(fixCall).toBeDefined();
    expect(fixCall!.advisorResults).toEqual(npmAdvisorResults);
  });

  it('passes undefined advisorResults when no advisors ran for the plugin', async () => {
    const scanResult = makeScanResult();

    // runAdvisors is not called when advisors array is empty
    // Config has empty advisors for the plugin
    const config: ProjectConfig = {
      ...makeConfig('npm'),
      ecosystems: [{ id: 'npm', advisors: [] }],
    } as unknown as ProjectConfig;

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
      defaultAdvisors: [], // no default advisors either
      buildScanArgs: () => ['--lockfile', 'package-lock.json'],
      getProtectedPackages: () => [],
      runUpdater: vi.fn(),
      postUpdateOsvVerify: 'never',
    } as any;

    registry.register(fakeNpmPlugin);

    await runOrchestrator(new MockRunner(), config, {
      configPath: 'project-config.yml',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      registry,
      scannerRegistry: makeScannerRegistry(scanResult),
    });

    const fixCall = capturedRunEcosystemFixParams.find((p) => p.plugin.id === 'npm');
    expect(fixCall).toBeDefined();
    // When no advisors ran, result.advisorResults['npm'] is undefined
    expect(fixCall!.advisorResults).toBeUndefined();
  });
});
