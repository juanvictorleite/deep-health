/**
 * Additional behavior coverage for OsvScannerEngine, split from osv-engine.test.ts
 * to keep that file's size manageable. Same scaffolding style (MockRunner,
 * makeConfig, makeEcosystemRegistry) — see osv-engine.test.ts for the base suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OsvScannerEngine } from '@modules/scanner/osv-engine';
import { PhaseError } from '@core/errors';
import type { CommandRunner, CommandResult, CommandRunnerOptions, ExecutionEnv } from '@core/types/common';
import type { EcosystemConfig, ProjectConfig } from '@core/types/config';

vi.mock('@infra/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), phase: vi.fn(), skip: vi.fn(), header: vi.fn(), tagged: vi.fn() },
}));

vi.mock('@modules/ecosystem/plugins/npm-reachability.js', () => ({
  NpmReachabilityAdapter: vi.fn().mockImplementation(function () {
    return { ecosystemId: 'npm', checkReachability: vi.fn().mockResolvedValue([]) };
  }),
}));

vi.mock('@modules/ecosystem/plugins/composer-reachability.js', () => ({
  ComposerReachabilityAdapter: vi.fn().mockImplementation(function () {
    return { ecosystemId: 'composer', checkReachability: vi.fn().mockResolvedValue([]) };
  }),
}));

vi.mock('@modules/ecosystem/plugins/pip-reachability.js', () => ({
  PipReachabilityAdapter: vi.fn().mockImplementation(function () {
    return { ecosystemId: 'pip', checkReachability: vi.fn().mockResolvedValue([]) };
  }),
}));

const mockDockerRun = vi.fn();

vi.mock('@infra/provisioner/osv-runner.js', () => ({
  OsvDockerRunner: vi.fn().mockImplementation(function () { return { run: mockDockerRun }; }),
}));

vi.mock('@infra/utils/osv-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@infra/utils/osv-commands')>();
  return { ...actual, resolveScanPathArgs: vi.fn(actual.resolveScanPathArgs) };
});

import { OsvDockerRunner } from '@infra/provisioner/osv-runner';
import { resolveScanPathArgs } from '@infra/utils/osv-commands';
import { logger } from '@infra/utils/logger';
import type { EcosystemRegistry } from '@modules/ecosystem/registry';
import type { ScannerEngineContext } from '@modules/scanner/types';

class MockRunner implements CommandRunner {
  readonly dryRun: boolean;
  readonly environment: ExecutionEnv = 'local';
  readonly calledCommands: string[] = [];
  private responses: Map<string, Partial<CommandResult>>;

  constructor(
    responses: Record<string, Partial<CommandResult>> = {},
    options: { dryRun?: boolean } = {},
  ) {
    this.dryRun = options.dryRun ?? false;
    this.responses = new Map(Object.entries(responses));
  }

  async run(command: string, _opts?: CommandRunnerOptions): Promise<CommandResult> {
    this.calledCommands.push(command);
    for (const [key, resp] of this.responses) {
      if (command.includes(key)) {
        return { stdout: resp.stdout ?? '', stderr: resp.stderr ?? '', exitCode: resp.exitCode ?? 0, command, dryRun: this.dryRun };
      }
    }
    return { stdout: '', stderr: '', exitCode: 0, command, dryRun: this.dryRun };
  }

  async runArgs(file: string, args: string[], _opts?: CommandRunnerOptions): Promise<CommandResult> {
    return this.run([file, ...args].join(' '), _opts);
  }
}

const MINIMAL_SCAN_JSON = JSON.stringify({ results: [] });

function makeConfig(osvConfig?: ProjectConfig['scanners']): ProjectConfig {
  return {
    project: { name: 'test', client: 'test' },
    ecosystems: [{ id: 'npm' }],
    protected_packages: {},
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: false,
    },
    conflict_resolution: 'fail',
    ...(osvConfig !== undefined ? { scanners: osvConfig } : {}),
  };
}

type FakePlugin = ReturnType<EcosystemRegistry['getAll']>[number];

function makeRegistry(plugins: FakePlugin[]): EcosystemRegistry {
  return {
    getAll: () => plugins,
    register: vi.fn(),
    get: vi.fn(),
    findByOsvEcosystem: vi.fn(),
  } as unknown as EcosystemRegistry;
}

function makeNpmPlugin(overrides: Partial<FakePlugin> = {}): FakePlugin {
  return {
    id: 'npm',
    buildScanArgs: () => ['--lockfile', 'package-lock.json'],
    getProtectedPackages: () => [],
    findByOsvEcosystem: () => undefined,
    ...overrides,
  } as unknown as FakePlugin;
}

describe('OsvScannerEngine.assertAvailable() — unrecognized runner mode', () => {
  const engine = new OsvScannerEngine();
  afterEach(() => vi.clearAllMocks());

  it('resolves without checking local or docker when the configured runner is neither', async () => {
    const runner = new MockRunner();
    const ctx: ScannerEngineContext = {
      runner,
      config: makeConfig({ osv: { runner: 'bogus' as unknown as 'local' } }),
      cwd: '/project',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    await expect(engine.assertAvailable(ctx)).resolves.toBeUndefined();
    expect(runner.calledCommands).toHaveLength(0);
  });
});

describe('OsvScannerEngine.scan() — local runner recommendation warning', () => {
  const engine = new OsvScannerEngine();

  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it('warns to recommend Docker when runner=local', async () => {
    const runner = new MockRunner({
      'osv-scanner --version': { exitCode: 0 },
      'osv-scanner': { exitCode: 0, stdout: MINIMAL_SCAN_JSON },
    });
    const ctx: ScannerEngineContext = {
      runner,
      config: makeConfig({ osv: { runner: 'local' } }),
      cwd: '/project',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    await engine.scan(ctx);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('runner=local'));
  });

  it('does not warn when runner=docker', async () => {
    mockDockerRun.mockResolvedValue({ exitCode: 0, stdout: MINIMAL_SCAN_JSON, stderr: '' });
    const runner = new MockRunner({ docker: { exitCode: 0 } });
    const ctx: ScannerEngineContext = {
      runner,
      config: makeConfig({ osv: { runner: 'docker' } }),
      cwd: '/project',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    await engine.scan(ctx);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('OsvScannerEngine.scan() — scan.paths dry run', () => {
  const engine = new OsvScannerEngine();

  beforeEach(() => {
    mockDockerRun.mockClear();
    vi.mocked(OsvDockerRunner).mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it.each([
    // The runner's own availability probe still runs before the dry-run
    // short-circuit — only the actual scan invocation is skipped.
    ['docker' as const, ['docker --version']],
    ['local' as const, ['osv-scanner --version']],
  ])('skips the scan invocation under runner=%s when dryRun is true', async (mode, expectedCommands) => {
    const runner = new MockRunner({}, { dryRun: true });
    const ctx: ScannerEngineContext = {
      runner,
      config: { ...makeConfig({ osv: { runner: mode } }), scan: { auto_discover: true, paths: ['app/'] } },
      cwd: '/project',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    const result = await engine.scan(ctx);

    expect(result.status).toBe('success');
    expect(Object.keys(result.ecosystems)).toHaveLength(0);
    expect(mockDockerRun).not.toHaveBeenCalled();
    expect(runner.calledCommands).toEqual(expectedCommands);
  });
});

describe('OsvScannerEngine.scan() — scan.paths resolving to zero arguments', () => {
  const engine = new OsvScannerEngine();

  afterEach(() => {
    vi.mocked(resolveScanPathArgs).mockClear();
    vi.clearAllMocks();
  });

  it('throws PhaseError when the configured paths resolve to no osv-scanner arguments', async () => {
    vi.mocked(resolveScanPathArgs).mockReturnValueOnce([]);
    const runner = new MockRunner({ docker: { exitCode: 0 } });
    const ctx: ScannerEngineContext = {
      runner,
      config: { ...makeConfig({ osv: { runner: 'docker' } }), scan: { auto_discover: true, paths: ['app/'] } },
      cwd: '/project',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    const failure = await engine.scan(ctx).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(PhaseError);
    expect((failure as Error).message).toContain('zero lockfile args');
  });
});

describe('OsvScannerEngine.scan() — scan.paths scan failure', () => {
  const engine = new OsvScannerEngine();

  beforeEach(() => {
    mockDockerRun.mockClear();
    vi.mocked(OsvDockerRunner).mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it('returns a status:error result when the combined-path scan exits non-zero with no stdout', async () => {
    mockDockerRun.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'osv-scanner crashed' });
    const runner = new MockRunner({ docker: { exitCode: 0 } });
    const ctx: ScannerEngineContext = {
      runner,
      config: { ...makeConfig({ osv: { runner: 'docker' } }), scan: { auto_discover: true, paths: ['app/'] } },
      cwd: '/project',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    const result = await engine.scan(ctx);

    expect(result.status).toBe('error');
    expect(result.error).toContain('osv-scanner crashed');
  });
});

describe('OsvScannerEngine.scan() — monorepo entry path rewriting', () => {
  const engine = new OsvScannerEngine();

  beforeEach(() => {
    mockDockerRun.mockResolvedValue({ exitCode: 0, stdout: MINIMAL_SCAN_JSON, stderr: '' });
    vi.mocked(OsvDockerRunner).mockClear();
    mockDockerRun.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it('prepends entry.path to --lockfile arguments for a monorepo entry', async () => {
    const runner = new MockRunner({ docker: { exitCode: 0 } });
    const config: ProjectConfig = {
      ...makeConfig({ osv: { runner: 'docker' } }),
      ecosystems: [{ id: 'npm', path: 'packages/frontend' } as EcosystemConfig],
    };
    const ctx: ScannerEngineContext = {
      runner,
      config,
      cwd: '/repo',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    await engine.scan(ctx);

    expect(mockDockerRun).toHaveBeenCalledWith(['--lockfile', 'packages/frontend/package-lock.json']);
  });

  it('passes plugin args through unchanged for a root entry with no path', async () => {
    const runner = new MockRunner({ docker: { exitCode: 0 } });
    const ctx: ScannerEngineContext = {
      runner,
      config: makeConfig({ osv: { runner: 'docker' } }),
      cwd: '/repo',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    await engine.scan(ctx);

    expect(mockDockerRun).toHaveBeenCalledWith(['--lockfile', 'package-lock.json']);
  });
});

describe('OsvScannerEngine.scan() — per-entry prepareScan hook', () => {
  const engine = new OsvScannerEngine();

  beforeEach(() => {
    mockDockerRun.mockResolvedValue({ exitCode: 0, stdout: MINIMAL_SCAN_JSON, stderr: '' });
    vi.mocked(OsvDockerRunner).mockClear();
    mockDockerRun.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it('awaits the plugin prepareScan hook with the entry directory before scanning', async () => {
    const prepareScan = vi.fn().mockResolvedValue(undefined);
    const runner = new MockRunner({ docker: { exitCode: 0 } });
    const config: ProjectConfig = {
      ...makeConfig({ osv: { runner: 'docker' } }),
      ecosystems: [{ id: 'npm', path: 'services/api' } as EcosystemConfig],
    };
    const ctx: ScannerEngineContext = {
      runner,
      config,
      cwd: '/repo',
      ecosystemRegistry: makeRegistry([makeNpmPlugin({ prepareScan })]),
      branch: null,
    };

    await engine.scan(ctx);

    expect(prepareScan).toHaveBeenCalledWith('/repo/services/api');
  });

  it('does not require prepareScan when the plugin omits the hook', async () => {
    const runner = new MockRunner({ docker: { exitCode: 0 } });
    const ctx: ScannerEngineContext = {
      runner,
      config: makeConfig({ osv: { runner: 'docker' } }),
      cwd: '/repo',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    const result = await engine.scan(ctx);

    expect(result.status).toBe('success');
  });
});

describe('OsvScannerEngine.scan() — entry with no matching scan output', () => {
  const engine = new OsvScannerEngine();

  beforeEach(() => {
    vi.mocked(OsvDockerRunner).mockClear();
    mockDockerRun.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it('omits the ecosystem key entirely when the scan output has no matching packages', async () => {
    mockDockerRun.mockResolvedValue({ exitCode: 0, stdout: MINIMAL_SCAN_JSON, stderr: '' });
    const runner = new MockRunner({ docker: { exitCode: 0 } });
    const ctx: ScannerEngineContext = {
      runner,
      config: makeConfig({ osv: { runner: 'docker' } }),
      cwd: '/project',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    const result = await engine.scan(ctx);

    expect(result.status).toBe('success');
    expect(result.ecosystems['npm']).toBeUndefined();
  });
});

describe('OsvScannerEngine.scan() — ecosystem entries without a registered plugin', () => {
  const engine = new OsvScannerEngine();

  beforeEach(() => {
    mockDockerRun.mockResolvedValue({ exitCode: 0, stdout: MINIMAL_SCAN_JSON, stderr: '' });
    vi.mocked(OsvDockerRunner).mockClear();
    mockDockerRun.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it('skips config.ecosystems entries that have no matching plugin in the registry', async () => {
    const runner = new MockRunner({ docker: { exitCode: 0 } });
    const config: ProjectConfig = {
      ...makeConfig({ osv: { runner: 'docker' } }),
      ecosystems: [{ id: 'unregistered-ecosystem' } as EcosystemConfig],
    };
    const ctx: ScannerEngineContext = {
      runner,
      config,
      cwd: '/project',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    const result = await engine.scan(ctx);

    expect(result.status).toBe('success');
    expect(result.ecosystems).toEqual({});
    expect(mockDockerRun).not.toHaveBeenCalled();
  });

  it('scans registered entries while skipping unregistered ones in the same config', async () => {
    const runner = new MockRunner({ docker: { exitCode: 0 } });
    const config: ProjectConfig = {
      ...makeConfig({ osv: { runner: 'docker' } }),
      ecosystems: [{ id: 'unregistered-ecosystem' } as EcosystemConfig, { id: 'npm' }],
    };
    const ctx: ScannerEngineContext = {
      runner,
      config,
      cwd: '/project',
      ecosystemRegistry: makeRegistry([makeNpmPlugin()]),
      branch: null,
    };

    await engine.scan(ctx);

    expect(mockDockerRun).toHaveBeenCalledOnce();
    expect(mockDockerRun).toHaveBeenCalledWith(['--lockfile', 'package-lock.json']);
  });
});
