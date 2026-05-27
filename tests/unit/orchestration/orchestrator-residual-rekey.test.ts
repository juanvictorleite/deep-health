/**
 * Tests for AC1: orchestrator re-keys residualVerification.summary
 * from plugin.id (raw OSV ecosystem name) to entryKey format
 * (e.g. 'npm:frontend') after runEcosystemFix returns.
 *
 * This ensures executive.ts lookup by eco.key (entryKey format) matches.
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

vi.mock('@orchestration/run-ecosystem-fix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@orchestration/run-ecosystem-fix')>();
  return {
    ...actual,
    runEcosystemFix: vi.fn(),
  };
});

vi.mock('@modules/advisor/index.js', () => ({
  runAdvisors: vi.fn().mockResolvedValue([]),
}));

import { runOrchestrator } from '@orchestration/orchestrator';
import { runEcosystemFix } from '@orchestration/run-ecosystem-fix';
import { ScannerEngineRegistry } from '@modules/scanner/registry';
import type { CommandRunner, CommandResult, CommandRunnerOptions } from '@core/types/common';
import type { ProjectConfig } from '@core/types/config';
import type { ScanResultJson } from '@core/types/scan';
import type { EcosystemPlugin } from '@modules/ecosystem/types';
import type { EcosystemRegistry } from '@modules/ecosystem/registry';

// ── Helpers ──────────────────────────────────────────────────────────────────

class MockRunner implements CommandRunner {
  readonly dryRun = false;
  readonly environment = 'local' as const;
  async run(_cmd: string): Promise<CommandResult> {
    return { stdout: '', stderr: '', exitCode: 0, command: '', dryRun: false };
  }
  async runArgs(file: string, args: string[], _opts?: CommandRunnerOptions): Promise<CommandResult> {
    return this.run([file, ...args].join(' '));
  }
}

function makeSuccessUpdateResult() {
  return {
    $schema: 'osv-update-result/v1',
    agent: 'security-scan/test',
    status: 'success' as const,
    packages_updated: [],
    packages_skipped: [],
    packages_pending_breaking: [],
    validations: [{ name: 'v', status: 'skipped' as const }],
    error: null,
  };
}

function makeNpmPlugin(): EcosystemPlugin {
  return {
    id: 'npm',
    name: 'npm',
    lockfiles: ['package-lock.json'],
    osvEcosystems: ['npm'],
    reportLabel: 'npm',
    supportedFixers: ['osv'],
    defaultValidationCommands: [],
    defaultAdvisors: [],
    buildScanArgs: () => ['--lockfile', 'package-lock.json'],
    getProtectedPackages: () => [],
    runUpdater: vi.fn(async () => makeSuccessUpdateResult()),
    postUpdateOsvVerify: 'never',
  } as EcosystemPlugin;
}

function makeScannerRegistry(scanOutput: string): ScannerEngineRegistry {
  const reg = new ScannerEngineRegistry();
  const engine = {
    id: 'osv',
    phase: 'scan',
    scan: vi.fn().mockResolvedValue(JSON.parse(scanOutput) as ScanResultJson),
  };
  reg.register(engine as any);
  return reg;
}

function makeEcosystemRegistry(plugin: EcosystemPlugin): EcosystemRegistry {
  return {
    getAll: () => [plugin],
    getByPhase: vi.fn(),
    register: vi.fn(),
    get: (id: string) => id === plugin.id ? plugin : undefined,
    has: (id: string) => id === plugin.id,
    findByOsvEcosystem: vi.fn(),
  } as unknown as EcosystemRegistry;
}

function makeEmptyScan(ecoKey: string): ScanResultJson {
  return {
    $schema: 'osv-scan-result/v1',
    agent: 'osv-scanner',
    status: 'success',
    environment: 'local',
    ecosystems: {
      [ecoKey]: {
        vulnerabilities_total: 1,
        auto_safe: 1,
        breaking: 0,
        manual: 0,
        auto_safe_packages: ['lodash'],
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: [],
      },
    },
    error: null,
  };
}

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    project: { name: 'Test', client: 'Test' },
    ecosystems: [{ id: 'npm' }],
    protected_packages: { npm: [] },
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: true,
    },
    conflict_resolution: 'stop_and_ask',
    scanners: { osv: { runner: 'local' } },
    ...overrides,
  } as ProjectConfig;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('orchestrator — residualVerification re-keying (AC1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes residualVerification through unchanged when entryKey equals plugin.id (no label)', async () => {
    const plugin = makeNpmPlugin();
    const scanResult = makeEmptyScan('npm');

    vi.mocked(runEcosystemFix).mockResolvedValue({
      status: 'success',
      updateResult: makeSuccessUpdateResult(),
      residualVerification: { status: 'verified', summary: { npm: 0 } },
    });

    const config = makeConfig({ ecosystems: [{ id: 'npm' }] });
    const result = await runOrchestrator(new MockRunner(), config, {
      configPath: 'config.yml',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      rendererType: 'verbose',
      registry: makeEcosystemRegistry(plugin),
      scannerRegistry: makeScannerRegistry(JSON.stringify(scanResult)),
    });

    expect(result.residualVerification).toEqual({ status: 'verified', summary: { npm: 0 } });
  });

  it('re-keys summary from plugin.id to entryKey when ecosystem has a label', async () => {
    const plugin = makeNpmPlugin();
    // scan result keyed by entryKey 'npm:frontend'
    const scanResult = makeEmptyScan('npm:frontend');

    vi.mocked(runEcosystemFix).mockResolvedValue({
      status: 'success',
      updateResult: makeSuccessUpdateResult(),
      // runEcosystemFix returns summary keyed by plugin.id ('npm'), not entryKey
      residualVerification: { status: 'unverified', summary: { npm: 2 } },
    });

    const config = makeConfig({
      ecosystems: [{ id: 'npm', label: 'frontend' }],
    });

    const result = await runOrchestrator(new MockRunner(), config, {
      configPath: 'config.yml',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      rendererType: 'verbose',
      registry: makeEcosystemRegistry(plugin),
      scannerRegistry: makeScannerRegistry(JSON.stringify(scanResult)),
    });

    // After re-keying, summary should use 'npm:frontend' not 'npm'
    expect(result.residualVerification?.status).toBe('unverified');
    if (result.residualVerification?.status === 'unverified') {
      expect(result.residualVerification.summary['npm:frontend']).toBe(2);
      expect(result.residualVerification.summary['npm']).toBeUndefined();
    }
  });

  it('passes skipped residualVerification through unchanged (no summary to re-key)', async () => {
    const plugin = makeNpmPlugin();
    const scanResult = makeEmptyScan('npm:api');

    vi.mocked(runEcosystemFix).mockResolvedValue({
      status: 'success',
      updateResult: makeSuccessUpdateResult(),
      residualVerification: { status: 'skipped' },
    });

    const config = makeConfig({ ecosystems: [{ id: 'npm', label: 'api' }] });

    const result = await runOrchestrator(new MockRunner(), config, {
      configPath: 'config.yml',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      rendererType: 'verbose',
      registry: makeEcosystemRegistry(plugin),
      scannerRegistry: makeScannerRegistry(JSON.stringify(scanResult)),
    });

    expect(result.residualVerification?.status).toBe('skipped');
  });

  it('leaves verified summary as-is when plugin.id key is absent (already correctly keyed)', async () => {
    const plugin = makeNpmPlugin();
    const scanResult = makeEmptyScan('npm:backend');

    vi.mocked(runEcosystemFix).mockResolvedValue({
      status: 'success',
      updateResult: makeSuccessUpdateResult(),
      // summary already keyed by entryKey (edge case: no re-keying needed)
      residualVerification: { status: 'verified', summary: { 'npm:backend': 0 } },
    });

    const config = makeConfig({ ecosystems: [{ id: 'npm', label: 'backend' }] });

    const result = await runOrchestrator(new MockRunner(), config, {
      configPath: 'config.yml',
      cwd: '/project',
      dryRun: false,
      verbose: false,
      rendererType: 'verbose',
      registry: makeEcosystemRegistry(plugin),
      scannerRegistry: makeScannerRegistry(JSON.stringify(scanResult)),
    });

    // Summary already had 'npm:backend' key — should be left intact
    if (result.residualVerification?.status === 'verified') {
      expect(result.residualVerification.summary['npm:backend']).toBe(0);
    }
  });
});
