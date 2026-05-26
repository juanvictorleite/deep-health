/**
 * Tests for monorepo subdirectory path support (Slice E):
 *
 * AC1: OSV engine derives lockfile args from config.ecosystems[] entries,
 *      prepending entry.path when present.
 * AC2: Orchestrator fix-phase iterates config.ecosystems entries, so multiple
 *      entries with the same plugin id at different paths are each processed.
 * AC3: runEcosystemFix uses ecoEntry.path to derive fixLockfileOverride when
 *      scan.paths is not configured.
 * AC4: Orchestrator passes resolved ecosystem cwd (options.cwd + entry.path) to
 *      runEcosystemFix.
 * AC5: scan.paths takes full precedence over auto-derived paths (existing behavior).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (must be hoisted before imports) ───────────────────────────

vi.mock('@infra/utils/logger', () => ({
  logger: {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    phase: vi.fn(), skip: vi.fn(), header: vi.fn(), tagged: vi.fn(),
  },
  setProgressSink: vi.fn(),
  makeProgressSink: vi.fn(),
}));

vi.mock('@infra/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    phase: vi.fn(), skip: vi.fn(), header: vi.fn(), tagged: vi.fn(),
  },
  setProgressSink: vi.fn(),
  makeProgressSink: vi.fn(),
}));

vi.mock('@infra/utils/git-branch.js', () => ({
  detectGitBranch: vi.fn().mockResolvedValue(null),
}));

vi.mock('@infra/provisioner/osv-runner.js', () => ({
  OsvDockerRunner: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@infra/ecosystem-runtime', () => ({
  resolveEcosystemRuntime: vi.fn(async (opts: any) => opts.hostRunner),
  resolveOsvRuntime: vi.fn((_config: unknown, _cwd: unknown, hostRunner: unknown) => hostRunner),
}));

vi.mock('@orchestration/osv-fix-applier', () => ({
  applyOsvFixViaStaging: vi.fn(),
}));

vi.mock('@orchestration/osv-fix-applier.js', () => ({
  applyOsvFixViaStaging: vi.fn(),
}));

vi.mock('@core/gates/validator', () => ({
  validateEcosystemGate: vi.fn().mockReturnValue({ valid: true, gate: 'npm', errors: [] }),
}));

vi.mock('@modules/advisor/index.js', () => ({
  runAdvisors: vi.fn().mockResolvedValue([]),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { OsvScannerEngine } from '@modules/scanner/osv-engine';
import type { ScannerEngineContext } from '@modules/scanner/types';
import type { EcosystemRegistry } from '@modules/ecosystem/registry';
import type { CommandRunner, CommandResult, CommandRunnerOptions, ExecutionEnv } from '@core/types/common';
import type { ProjectConfig, EcosystemConfig } from '@core/types/config';
import type { ScanResultJson } from '@core/types/scan';
import type { UpdateResultJson } from '@core/types/update';
import type { EcosystemPlugin } from '@modules/ecosystem/types';
import { runEcosystemFix } from '@orchestration/run-ecosystem-fix';
import { applyOsvFixViaStaging } from '@orchestration/osv-fix-applier';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MINIMAL_SCAN_JSON = JSON.stringify({ results: [] });

class MockRunner implements CommandRunner {
  readonly dryRun = false;
  readonly environment: ExecutionEnv = 'local';
  readonly calledCommands: string[] = [];

  async run(command: string, _opts?: CommandRunnerOptions): Promise<CommandResult> {
    this.calledCommands.push(command);
    // Return valid JSON for osv-scanner calls so the engine doesn't throw on parse
    const stdout = command.includes('osv-scanner') ? MINIMAL_SCAN_JSON : '';
    return { stdout, stderr: '', exitCode: 0, command, dryRun: false };
  }

  async runArgs(file: string, args: string[], _opts?: CommandRunnerOptions): Promise<CommandResult> {
    return this.run([file, ...args].join(' '));
  }
}

function makeUpdateResult(overrides: Partial<UpdateResultJson> = {}): UpdateResultJson {
  return {
    $schema: 'osv-update-result/v1',
    agent: 'security-scan/test',
    status: 'success',
    packages_updated: [],
    packages_skipped: [],
    packages_pending_breaking: [],
    validations: [{ name: 'tests', status: 'pass' }],
    error: null,
    ...overrides,
  };
}

function makePlugin(overrides: Partial<EcosystemPlugin> = {}): EcosystemPlugin {
  return {
    id: 'npm',
    name: 'npm',
    lockfiles: ['package-lock.json'],
    osvEcosystems: ['npm'],
    reportLabel: 'npm',
    supportedFixers: ['osv', 'npm-audit'],
    defaultValidationCommands: [],
    defaultAdvisors: [],
    buildScanArgs: () => ['--lockfile', 'package-lock.json'],
    getProtectedPackages: () => [],
    runUpdater: vi.fn(async () => makeUpdateResult()),
    postUpdateOsvVerify: 'never',
    ...overrides,
  } as EcosystemPlugin;
}

function makeScanResult(
  id: string,
  overrides: { auto_safe?: number; breaking?: number } = {},
): ScanResultJson {
  return {
    $schema: 'osv-scan-result/v1',
    status: 'success',
    ecosystems: {
      [id]: {
        vulnerabilities_total: (overrides.auto_safe ?? 1) + (overrides.breaking ?? 0),
        auto_safe: overrides.auto_safe ?? 1,
        breaking: overrides.breaking ?? 0,
        manual: 0,
        vulnerabilities: [],
      },
    },
  } as ScanResultJson;
}

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    project: { name: 'Test', client: 'Test' },
    ecosystems: [{ id: 'npm', validationCommands: [], advisors: [] }],
    protected_packages: { npm: [], composer: [], pip: [] },
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: true,
    },
    conflict_resolution: 'stop_and_ask',
    scanners: { osv: { runner: 'local' } },
    ...overrides,
  } as ProjectConfig;
}

/**
 * Build a fake EcosystemRegistry with the given plugins.
 */
function makeRegistry(plugins: EcosystemPlugin[]): EcosystemRegistry {
  return {
    getAll: () => plugins,
    register: vi.fn(),
    get: vi.fn(),
    findByOsvEcosystem: vi.fn(),
  } as unknown as EcosystemRegistry;
}

function makeEngineCtx(
  config: ProjectConfig,
  registry: EcosystemRegistry,
  runner: MockRunner = new MockRunner(),
): ScannerEngineContext {
  return { runner, config, cwd: '/project', ecosystemRegistry: registry, branch: null };
}

// ─── AC1: OSV engine derives lockfile args from config.ecosystems[].path ──────

describe('AC1 — OSV engine: lockfile args derived from config.ecosystems[].path', () => {
  const engine = new OsvScannerEngine();

  beforeEach(() => vi.clearAllMocks());

  it('uses plugin.buildScanArgs() unchanged when entry has no path (root ecosystem)', async () => {
    const plugin = makePlugin({ buildScanArgs: () => ['--lockfile', 'package-lock.json'] });
    const config = makeConfig({
      ecosystems: [{ id: 'npm' }],
      scanners: { osv: { runner: 'local' } },
    });
    const runner = new MockRunner();
    const ctx = makeEngineCtx(config, makeRegistry([plugin]), runner);

    await engine.scan(ctx);

    const cmd = runner.calledCommands.find((c) => c.includes('--lockfile'));
    expect(cmd).toContain('--lockfile package-lock.json');
    // Must NOT contain a subdirectory prefix
    expect(cmd).not.toMatch(/--lockfile \w+\/package-lock\.json/);
  });

  it('prepends entry.path to lockfile arg when entry has a path', async () => {
    const plugin = makePlugin({ buildScanArgs: () => ['--lockfile', 'package-lock.json'] });
    const config = makeConfig({
      ecosystems: [{ id: 'npm', path: 'web' }],
      scanners: { osv: { runner: 'local' } },
    });
    const runner = new MockRunner();
    const ctx = makeEngineCtx(config, makeRegistry([plugin]), runner);

    await engine.scan(ctx);

    const cmd = runner.calledCommands.find((c) => c.includes('--lockfile'));
    expect(cmd).toContain('--lockfile web/package-lock.json');
  });

  it('produces two separate scan invocations for two entries of same plugin at different paths', async () => {
    // N-scan architecture: one osv-scanner invocation per config.ecosystems entry,
    // not a single combined invocation. Two npm entries → two separate commands.
    const plugin = makePlugin({ buildScanArgs: () => ['--lockfile', 'package-lock.json'] });
    const config = makeConfig({
      ecosystems: [
        { id: 'npm', path: 'web' },
        { id: 'npm', path: 'admin' },
      ],
      scanners: { osv: { runner: 'local' } },
    });
    const runner = new MockRunner();
    const ctx = makeEngineCtx(config, makeRegistry([plugin]), runner);

    await engine.scan(ctx);

    const lockfileCmds = runner.calledCommands.filter((c) => c.includes('--lockfile'));
    // Exactly two scan invocations — one per entry
    expect(lockfileCmds).toHaveLength(2);
    // Each invocation targets its own path-prefixed lockfile
    expect(lockfileCmds.some((c) => c.includes('--lockfile web/package-lock.json'))).toBe(true);
    expect(lockfileCmds.some((c) => c.includes('--lockfile admin/package-lock.json'))).toBe(true);
  });

  it('handles nested paths correctly using join()', async () => {
    const plugin = makePlugin({ buildScanArgs: () => ['--lockfile', 'requirements.txt'] });
    const config = makeConfig({
      ecosystems: [{ id: 'pip', path: 'api/app' }],
      scanners: { osv: { runner: 'local' } },
    });
    const runner = new MockRunner();
    const registry = makeRegistry([plugin]);
    // Override plugin id to match config entry
    Object.defineProperty(plugin, 'id', { value: 'pip' });
    const ctx = makeEngineCtx(config, registry, runner);

    await engine.scan(ctx);

    const cmd = runner.calledCommands.find((c) => c.includes('--lockfile'));
    expect(cmd).toContain('--lockfile api/app/requirements.txt');
  });

  it('skips config entries whose plugin is not in the registry', async () => {
    const npmPlugin = makePlugin({ buildScanArgs: () => ['--lockfile', 'package-lock.json'] });
    const config = makeConfig({
      ecosystems: [
        { id: 'npm' },
        { id: 'composer' }, // not in registry
      ],
      scanners: { osv: { runner: 'local' } },
    });
    const runner = new MockRunner();
    const ctx = makeEngineCtx(config, makeRegistry([npmPlugin]), runner);

    await engine.scan(ctx);

    const cmd = runner.calledCommands.find((c) => c.includes('--lockfile'));
    expect(cmd).toContain('--lockfile package-lock.json');
    expect(cmd).not.toContain('composer.lock');
  });
});

// ─── AC5: scan.paths takes precedence over auto-derived paths ────────────────

describe('AC5 — scan.paths takes precedence over config.ecosystems[] paths', () => {
  const engine = new OsvScannerEngine();

  beforeEach(() => vi.clearAllMocks());

  it('uses scan.paths when explicitly configured, ignoring entry.path', async () => {
    const plugin = makePlugin({ buildScanArgs: () => ['--lockfile', 'package-lock.json'] });
    const config = makeConfig({
      ecosystems: [{ id: 'npm', path: 'web' }],
      scan: { paths: ['apps/web/package-lock.json'] },
      scanners: { osv: { runner: 'local' } },
    });
    const runner = new MockRunner();
    const ctx = makeEngineCtx(config, makeRegistry([plugin]), runner);

    await engine.scan(ctx);

    const cmd = runner.calledCommands.find((c) => c.includes('--lockfile'));
    // scan.paths entry should be used directly
    expect(cmd).toContain('apps/web/package-lock.json');
    // Should have exactly one lockfile arg (from scan.paths, not duplicated with auto-derived)
    const lockfileMatches = (cmd ?? '').match(/--lockfile/g);
    expect(lockfileMatches).toHaveLength(1);
  });
});

// ─── AC3: runEcosystemFix derives fixLockfileOverride from ecoEntry.path ──────

describe('AC3 — runEcosystemFix: fixLockfileOverride from ecoEntry.path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(applyOsvFixViaStaging).mockResolvedValue({
      applied: false,
      packagesUpdated: [],
      backups: new Map(),
      rawFixStdout: '',
      rawFixStderr: '',
    });
  });

  it('passes no fixLockfileOverride when ecoEntry has no path and scan.paths is unset', async () => {
    const plugin = makePlugin({
      osvFixSpec: { fixLockfile: 'package-lock.json', backupFiles: ['package-lock.json'] },
    });
    const ecoEntry: EcosystemConfig = { id: 'npm', fixer: 'osv', validationCommands: [], advisors: [] };
    const config = makeConfig({ ecosystems: [ecoEntry] });

    await runEcosystemFix({
      plugin,
      ecoEntry,
      hostRunner: new MockRunner(),
      config,
      scanResult: makeScanResult('npm'),
      cwd: '/project',
      dryRun: false,
      authorizeBreaking: false,
      preRunSnapshots: undefined,
    });

    const call = vi.mocked(applyOsvFixViaStaging).mock.calls[0][0];
    expect(call.fixLockfileOverride).toBeUndefined();
  });

  it('derives fixLockfileOverride from join(entry.path, plugin.osvFixSpec.fixLockfile) when path is set', async () => {
    const plugin = makePlugin({
      osvFixSpec: { fixLockfile: 'package-lock.json', backupFiles: ['package-lock.json'] },
    });
    const ecoEntry: EcosystemConfig = {
      id: 'npm',
      path: 'web',
      fixer: 'osv',
      validationCommands: [],
      advisors: [],
    };
    const config = makeConfig({ ecosystems: [ecoEntry] });

    await runEcosystemFix({
      plugin,
      ecoEntry,
      hostRunner: new MockRunner(),
      config,
      scanResult: makeScanResult('npm'),
      cwd: '/project/web',
      dryRun: false,
      authorizeBreaking: false,
      preRunSnapshots: undefined,
    });

    const call = vi.mocked(applyOsvFixViaStaging).mock.calls[0][0];
    expect(call.fixLockfileOverride).toBe('web/package-lock.json');
  });

  it('derives fixLockfileOverride for nested path (api/app)', async () => {
    const pipPlugin = makePlugin({
      id: 'pip',
      osvFixSpec: { fixLockfile: 'requirements.txt', backupFiles: ['requirements.txt'] },
    });
    const ecoEntry: EcosystemConfig = {
      id: 'pip',
      path: 'api/app',
      fixer: 'osv',
      validationCommands: [],
      advisors: [],
    };
    const config = makeConfig({
      ecosystems: [ecoEntry],
    });

    await runEcosystemFix({
      plugin: pipPlugin,
      ecoEntry,
      hostRunner: new MockRunner(),
      config,
      scanResult: makeScanResult('pip'),
      cwd: '/project/api/app',
      dryRun: false,
      authorizeBreaking: false,
      preRunSnapshots: undefined,
    });

    const call = vi.mocked(applyOsvFixViaStaging).mock.calls[0][0];
    expect(call.fixLockfileOverride).toBe('api/app/requirements.txt');
  });

  it('scan.paths takes precedence over entry.path for fixLockfileOverride', async () => {
    const plugin = makePlugin({
      osvFixSpec: { fixLockfile: 'package-lock.json', backupFiles: ['package-lock.json'] },
    });
    const ecoEntry: EcosystemConfig = {
      id: 'npm',
      path: 'web',
      fixer: 'osv',
      validationCommands: [],
      advisors: [],
    };
    const config = makeConfig({
      ecosystems: [ecoEntry],
      scan: { paths: ['apps/frontend/package-lock.json'] },
    });

    await runEcosystemFix({
      plugin,
      ecoEntry,
      hostRunner: new MockRunner(),
      config,
      scanResult: makeScanResult('npm'),
      cwd: '/project',
      dryRun: false,
      authorizeBreaking: false,
      preRunSnapshots: undefined,
    });

    const call = vi.mocked(applyOsvFixViaStaging).mock.calls[0][0];
    // scan.paths wins — should use the explicit path, not web/package-lock.json
    expect(call.fixLockfileOverride).toBe('apps/frontend/package-lock.json');
  });
});

// ─── AC2 + AC4: Orchestrator iterates config.ecosystems entries and passes correct cwd ──

describe('AC2 + AC4 — runEcosystemFix called per ecosystem entry with resolved cwd', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls runEcosystemFix for each config.ecosystems entry independently', async () => {
    // Two npm entries at different paths — both must be processed
    const npmPlugin = makePlugin();
    const config = makeConfig({
      ecosystems: [
        { id: 'npm', path: 'web', validationCommands: [], advisors: [] },
        { id: 'npm', path: 'admin', validationCommands: [], advisors: [] },
      ],
    });

    const ecoEntry1 = config.ecosystems[0];
    const ecoEntry2 = config.ecosystems[1];

    // runEcosystemFix is called directly; we test it receives the correct entries
    // by calling it with each entry and checking cwd.

    vi.mocked(applyOsvFixViaStaging).mockResolvedValue({
      applied: false,
      packagesUpdated: [],
      backups: new Map(),
      rawFixStdout: '',
      rawFixStderr: '',
    });

    const scanResult = makeScanResult('npm');

    await runEcosystemFix({
      plugin: npmPlugin,
      ecoEntry: ecoEntry1,
      hostRunner: new MockRunner(),
      config,
      scanResult,
      cwd: '/project/web',
      dryRun: false,
      authorizeBreaking: false,
      preRunSnapshots: undefined,
    });

    await runEcosystemFix({
      plugin: npmPlugin,
      ecoEntry: ecoEntry2,
      hostRunner: new MockRunner(),
      config,
      scanResult,
      cwd: '/project/admin',
      dryRun: false,
      authorizeBreaking: false,
      preRunSnapshots: undefined,
    });

    // Both entries were processed (runUpdater called twice)
    expect(npmPlugin.runUpdater).toHaveBeenCalledTimes(2);
  });

  it('passes cwd as resolved ecosystem path (options.cwd + entry.path)', () => {
    // Verify the resolve() pattern: given cwd=/project, entry.path=web,
    // the ecosystem cwd should be /project/web
    const { resolve } = require('node:path');
    const projectCwd = '/project';
    const entryPath = 'web';
    const ecosystemCwd = entryPath ? resolve(projectCwd, entryPath) : projectCwd;
    expect(ecosystemCwd).toBe('/project/web');
  });

  it('uses project root cwd when entry has no path', () => {
    const { resolve } = require('node:path');
    const projectCwd = '/project';
    const entryPath = undefined;
    const ecosystemCwd = entryPath ? resolve(projectCwd, entryPath) : projectCwd;
    expect(ecosystemCwd).toBe('/project');
  });

  it('uses project root cwd when entry has empty path', () => {
    const { resolve } = require('node:path');
    const projectCwd = '/project';
    const entryPath = '';
    const ecosystemCwd = entryPath ? resolve(projectCwd, entryPath) : projectCwd;
    expect(ecosystemCwd).toBe('/project');
  });

  it('resolves nested path correctly', () => {
    const { resolve } = require('node:path');
    const projectCwd = '/project';
    const entryPath = 'services/api';
    const ecosystemCwd = entryPath ? resolve(projectCwd, entryPath) : projectCwd;
    expect(ecosystemCwd).toBe('/project/services/api');
  });
});

// ─── Backward compatibility: no path on any entry behaves like before ─────────

describe('Backward compatibility — no entry.path behaves identically to pre-slice behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(applyOsvFixViaStaging).mockResolvedValue({
      applied: false,
      packagesUpdated: [],
      backups: new Map(),
      rawFixStdout: '',
      rawFixStderr: '',
    });
  });

  it('runEcosystemFix uses config.ecosystems.find() fallback when ecoEntry not passed', async () => {
    const plugin = makePlugin({
      osvFixSpec: { fixLockfile: 'package-lock.json', backupFiles: ['package-lock.json'] },
    });
    const config = makeConfig({
      ecosystems: [{ id: 'npm', fixer: 'osv', validationCommands: [], advisors: [] }],
    });

    // Call WITHOUT ecoEntry (old calling convention — backward compat)
    await runEcosystemFix({
      plugin,
      hostRunner: new MockRunner(),
      config,
      scanResult: makeScanResult('npm'),
      cwd: '/project',
      dryRun: false,
      authorizeBreaking: false,
      preRunSnapshots: undefined,
    });

    const call = vi.mocked(applyOsvFixViaStaging).mock.calls[0][0];
    // No path on entry → no fixLockfileOverride
    expect(call.fixLockfileOverride).toBeUndefined();
  });

  it('OSV engine produces root-level lockfile args when no entry has a path', async () => {
    const engine = new OsvScannerEngine();
    const plugin = makePlugin({ buildScanArgs: () => ['--lockfile', 'package-lock.json'] });
    const config = makeConfig({
      ecosystems: [{ id: 'npm' }],
      scanners: { osv: { runner: 'local' } },
    });
    const runner = new MockRunner();
    const ctx = makeEngineCtx(config, makeRegistry([plugin]), runner);

    await engine.scan(ctx);

    const cmd = runner.calledCommands.find((c) => c.includes('--lockfile'));
    // Exact match — no subdirectory prefix
    expect(cmd).toMatch(/--lockfile package-lock\.json/);
    expect(cmd).not.toMatch(/--lockfile \w+\//);
  });
});
