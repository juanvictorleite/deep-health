import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock pip-tooling-detector BEFORE importing pip.ts so the import is intercepted
vi.mock('@modules/ecosystem/plugins/pip-tooling-detector', () => ({
  detectPipTooling: vi.fn(),
}));

import { detectPipTooling } from '@modules/ecosystem/plugins/pip-tooling-detector';
import { pipPlugin, _resetDetectionCache } from '@modules/ecosystem/plugins/pip';
import type { PipToolingDetection } from '@modules/ecosystem/plugins/pip-tooling-detector';
import {
  runPipUpdater,
  resolveBackupFiles,
  resolveBootstrapSpec,
} from '@modules/ecosystem/plugins/pip-updater';
import type { CommandRunner } from '@core/types/common';
import type { ScanResultJson } from '@core/types/scan';

const mockedDetectPipTooling = detectPipTooling as unknown as ReturnType<typeof vi.fn>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CWD = '/project/python-app';

function makeDetection(overrides: Partial<PipToolingDetection>): PipToolingDetection {
  return {
    tier: 3,
    tooling: 'bare-pip',
    manifest: `${CWD}/requirements.txt`,
    ...overrides,
  };
}

function makeScanResult(autoSafePackages: string[] = ['django==3.2.15']): ScanResultJson {
  return {
    $schema: 'osv-scan-result/v1',
    ecosystems: {
      pip: {
        vulnerabilities: [
          {
            id: 'GHSA-test-0001-test',
            package: 'django',
            ecosystem: 'pip',
            severity: 'high',
            safeVersion: '3.2.15',
            classification: 'auto_safe',
            summary: 'Test vulnerability',
            aliases: [],
            reachability: undefined,
          },
        ],
        auto_safe_packages: autoSafePackages,
        breaking_packages: [],
        skipped_packages: [],
      },
    },
  };
}

function mockRunner(
  exitCode = 0,
  stdout = 'Successfully installed django-3.2.15',
  stderr = '',
): CommandRunner {
  return {
    run: vi.fn().mockResolvedValue({ exitCode, stdout, stderr }),
    runArgs: vi.fn().mockResolvedValue({ exitCode, stdout, stderr }),
    dryRun: true, // use dryRun to avoid full lifecycle execution in routing tests
    environment: 'host',
  } as unknown as CommandRunner;
}

// ─── buildScanArgs with detection cache ───────────────────────────────────────

describe('buildScanArgs with detection cache', () => {
  beforeEach(() => {
    _resetDetectionCache();
    vi.clearAllMocks();
  });

  it('returns ["--lockfile", "requirements.txt"] when no detection cached (backward compat)', () => {
    const args = pipPlugin.buildScanArgs();
    expect(args).toEqual(['--lockfile', 'requirements.txt']);
  });

  it('returns ["--lockfile", "poetry.lock"] when Tier 1 poetry detection cached', async () => {
    mockedDetectPipTooling.mockResolvedValue(
      makeDetection({ tier: 1, tooling: 'poetry', lockfile: `${CWD}/poetry.lock` }),
    );
    await pipPlugin.prepareScan!(CWD);
    expect(pipPlugin.buildScanArgs()).toEqual(['--lockfile', 'poetry.lock']);
  });

  it('returns ["--lockfile", "uv.lock"] when Tier 1 uv detection cached', async () => {
    mockedDetectPipTooling.mockResolvedValue(
      makeDetection({ tier: 1, tooling: 'uv', lockfile: `${CWD}/uv.lock` }),
    );
    await pipPlugin.prepareScan!(CWD);
    expect(pipPlugin.buildScanArgs()).toEqual(['--lockfile', 'uv.lock']);
  });

  it('returns ["--lockfile", "pdm.lock"] when Tier 1 pdm detection cached', async () => {
    mockedDetectPipTooling.mockResolvedValue(
      makeDetection({ tier: 1, tooling: 'pdm', lockfile: `${CWD}/pdm.lock` }),
    );
    await pipPlugin.prepareScan!(CWD);
    expect(pipPlugin.buildScanArgs()).toEqual(['--lockfile', 'pdm.lock']);
  });

  it('returns ["--lockfile", "Pipfile.lock"] when Tier 1 pipenv detection cached', async () => {
    mockedDetectPipTooling.mockResolvedValue(
      makeDetection({ tier: 1, tooling: 'pipenv', lockfile: `${CWD}/Pipfile.lock` }),
    );
    await pipPlugin.prepareScan!(CWD);
    expect(pipPlugin.buildScanArgs()).toEqual(['--lockfile', 'Pipfile.lock']);
  });

  it('returns ["--lockfile", "requirements.txt"] when Tier 2 pip-tools detection cached', async () => {
    mockedDetectPipTooling.mockResolvedValue(
      makeDetection({ tier: 2, tooling: 'pip-tools', lockfile: undefined }),
    );
    await pipPlugin.prepareScan!(CWD);
    expect(pipPlugin.buildScanArgs()).toEqual(['--lockfile', 'requirements.txt']);
  });

  it('returns ["--lockfile", "requirements.txt"] when Tier 3 bare-pip detection cached', async () => {
    mockedDetectPipTooling.mockResolvedValue(
      makeDetection({ tier: 3, tooling: 'bare-pip', lockfile: undefined }),
    );
    await pipPlugin.prepareScan!(CWD);
    expect(pipPlugin.buildScanArgs()).toEqual(['--lockfile', 'requirements.txt']);
  });

  it('falls back to requirements.txt when detectPipTooling throws', async () => {
    mockedDetectPipTooling.mockRejectedValue(new Error('No requirements.txt found'));
    await pipPlugin.prepareScan!(CWD);
    expect(pipPlugin.buildScanArgs()).toEqual(['--lockfile', 'requirements.txt']);
  });

  it('cache is cleared after _resetDetectionCache', async () => {
    mockedDetectPipTooling.mockResolvedValue(
      makeDetection({ tier: 1, tooling: 'uv', lockfile: `${CWD}/uv.lock` }),
    );
    await pipPlugin.prepareScan!(CWD);
    expect(pipPlugin.buildScanArgs()).toEqual(['--lockfile', 'uv.lock']);
    _resetDetectionCache();
    expect(pipPlugin.buildScanArgs()).toEqual(['--lockfile', 'requirements.txt']);
  });
});

// ─── pip fixer routing ─────────────────────────────────────────────────────────

describe('pip fixer routing (non-dry-run)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeLiveRunner(exitCode = 0, stdout = 'Successfully installed django-3.2.15', stderr = ''): CommandRunner {
    return {
      run: vi.fn().mockResolvedValue({ exitCode, stdout, stderr }),
      runArgs: vi.fn().mockResolvedValue({ exitCode, stdout, stderr }),
      dryRun: false,
      environment: 'host',
    } as unknown as CommandRunner;
  }

  it('poetry routing — calls poetry update with correct args', async () => {
    const runner = makeLiveRunner();
    const detection = makeDetection({ tier: 1, tooling: 'poetry', lockfile: `${CWD}/poetry.lock` });
    mockedDetectPipTooling.mockResolvedValue(detection);

    await runPipUpdater(
      runner,
      {},
      makeScanResult(),
      CWD,
      false,
      [],
      'osv',
      undefined,
      undefined,
      undefined,
      undefined,
      'pip',
      detection,
    );

    const runArgsCalls = (runner.runArgs as ReturnType<typeof vi.fn>).mock.calls;
    const poetryCall = runArgsCalls.find((call: unknown[]) => call[0] === 'poetry');
    expect(poetryCall).toBeDefined();
    expect(poetryCall![1]).toEqual(['update', 'django', '--no-interaction']);
  });

  it('uv routing — calls uv pip install with correct specs', async () => {
    const runner = makeLiveRunner();
    const detection = makeDetection({ tier: 1, tooling: 'uv', lockfile: `${CWD}/uv.lock` });
    mockedDetectPipTooling.mockResolvedValue(detection);

    await runPipUpdater(
      runner, {}, makeScanResult(), CWD, false, [], 'osv',
      undefined, undefined, undefined, undefined, 'pip', detection,
    );

    const runArgsCalls = (runner.runArgs as ReturnType<typeof vi.fn>).mock.calls;
    const uvCall = runArgsCalls.find((call: unknown[]) => call[0] === 'uv');
    expect(uvCall).toBeDefined();
    expect(uvCall![1]).toEqual(['pip', 'install', 'django==3.2.15']);
  });

  it('pipenv routing — calls pipenv install with correct specs', async () => {
    const runner = makeLiveRunner();
    const detection = makeDetection({ tier: 1, tooling: 'pipenv', lockfile: `${CWD}/Pipfile.lock` });
    mockedDetectPipTooling.mockResolvedValue(detection);

    await runPipUpdater(
      runner, {}, makeScanResult(), CWD, false, [], 'osv',
      undefined, undefined, undefined, undefined, 'pip', detection,
    );

    const runArgsCalls = (runner.runArgs as ReturnType<typeof vi.fn>).mock.calls;
    const pipenvCall = runArgsCalls.find((call: unknown[]) => call[0] === 'pipenv');
    expect(pipenvCall).toBeDefined();
    expect(pipenvCall![1]).toEqual(['install', 'django==3.2.15']);
  });

  it('pdm routing — calls pdm update with correct args', async () => {
    const runner = makeLiveRunner();
    const detection = makeDetection({ tier: 1, tooling: 'pdm', lockfile: `${CWD}/pdm.lock` });
    mockedDetectPipTooling.mockResolvedValue(detection);

    await runPipUpdater(
      runner, {}, makeScanResult(), CWD, false, [], 'osv',
      undefined, undefined, undefined, undefined, 'pip', detection,
    );

    const runArgsCalls = (runner.runArgs as ReturnType<typeof vi.fn>).mock.calls;
    const pdmCall = runArgsCalls.find((call: unknown[]) => call[0] === 'pdm');
    expect(pdmCall).toBeDefined();
    expect(pdmCall![1]).toEqual(['update', 'django', '--no-isolation']);
  });

  it('pip-tools routing — calls pip-compile then pip-sync', async () => {
    const runner = makeLiveRunner();
    const detection = makeDetection({ tier: 2, tooling: 'pip-tools', lockfile: undefined });
    mockedDetectPipTooling.mockResolvedValue(detection);

    await runPipUpdater(
      runner, {}, makeScanResult(), CWD, false, [], 'osv',
      undefined, undefined, undefined, undefined, 'pip', detection,
    );

    const runArgsCalls = (runner.runArgs as ReturnType<typeof vi.fn>).mock.calls;
    const compileCall = runArgsCalls.find((call: unknown[]) => call[0] === 'pip-compile');
    expect(compileCall).toBeDefined();
    expect(compileCall![1]).toContain('-o');
    expect(compileCall![1]).toContain('requirements.txt');
    expect(compileCall![1]).toContain('requirements.in');

    const syncCall = runArgsCalls.find((call: unknown[]) => call[0] === 'pip-sync');
    expect(syncCall).toBeDefined();
    expect(syncCall![1]).toEqual(['requirements.txt']);
  });

  it('bare-pip (no detection) — uses existing flow (no native tool calls)', async () => {
    const runner = makeLiveRunner(0, 'Successfully installed django-3.2.15');
    // detection is undefined → bare-pip flow
    mockedDetectPipTooling.mockResolvedValue(makeDetection({ tier: 3, tooling: 'bare-pip' }));

    await runPipUpdater(
      runner, {}, makeScanResult(), CWD, false, [], 'osv',
      undefined, undefined, undefined, undefined, 'pip',
      undefined, // no detection
    );

    const runArgsCalls = (runner.runArgs as ReturnType<typeof vi.fn>).mock.calls;
    // Should NOT call poetry, uv, pipenv, pdm, pip-compile
    const nativeToolCall = runArgsCalls.find(
      (call: unknown[]) => ['poetry', 'uv', 'pipenv', 'pdm', 'pip-compile'].includes(call[0] as string),
    );
    expect(nativeToolCall).toBeUndefined();
  });

  it('tool binary ENOENT → falls back to pip install with warning', async () => {
    const runner: CommandRunner = {
      run: vi.fn(),
      runArgs: vi.fn().mockImplementation((binary: string) => {
        if (binary === 'poetry') {
          throw Object.assign(new Error('Command failed: poetry not found'), { code: 'ENOENT' });
        }
        // pip install fallback
        return Promise.resolve({ exitCode: 0, stdout: 'Successfully installed django-3.2.15', stderr: '' });
      }),
      dryRun: false,
      environment: 'host',
    } as unknown as CommandRunner;

    const detection = makeDetection({ tier: 1, tooling: 'poetry', lockfile: `${CWD}/poetry.lock` });
    mockedDetectPipTooling.mockResolvedValue(detection);

    // Should not throw — fallback handles ENOENT
    const result = await runPipUpdater(
      runner, {}, makeScanResult(), CWD, false, [], 'osv',
      undefined, undefined, undefined, undefined, 'pip', detection,
    );

    // Result should succeed (pip fallback works)
    expect(result.status).toBe('success');

    const runArgsCalls = (runner.runArgs as ReturnType<typeof vi.fn>).mock.calls;
    const pipCall = runArgsCalls.find((call: unknown[]) => call[0] === 'pip');
    expect(pipCall).toBeDefined();
  });
});

// ─── AC6: uv routing forwards registry env vars ───────────────────────────────

describe('uv routing registry env vars (AC6)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('forwards PIP_INDEX_URL and UV_INDEX_URL when defined', async () => {
    process.env['PIP_INDEX_URL'] = 'https://pypi.example.com/simple/';
    process.env['UV_INDEX_URL'] = 'https://uv.example.com/simple/';

    const runner: CommandRunner = {
      run: vi.fn(),
      runArgs: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'Successfully installed django-3.2.15', stderr: '' }),
      dryRun: false,
      environment: 'host',
    } as unknown as CommandRunner;

    const detection = makeDetection({ tier: 1, tooling: 'uv', lockfile: `${CWD}/uv.lock` });
    mockedDetectPipTooling.mockResolvedValue(detection);

    await runPipUpdater(
      runner, {}, makeScanResult(), CWD, false, [], 'osv',
      undefined, undefined, undefined, undefined, 'pip', detection,
    );

    const runArgsCalls = (runner.runArgs as ReturnType<typeof vi.fn>).mock.calls;
    const uvCall = runArgsCalls.find((call: unknown[]) => call[0] === 'uv');
    expect(uvCall).toBeDefined();
    const opts = uvCall![2] as { env?: Record<string, string> };
    expect(opts.env).toBeDefined();
    expect(opts.env!['PIP_INDEX_URL']).toBe('https://pypi.example.com/simple/');
    expect(opts.env!['UV_INDEX_URL']).toBe('https://uv.example.com/simple/');
  });

  it('does NOT include undefined env vars in uv call', async () => {
    // Ensure these are not set
    delete process.env['PIP_INDEX_URL'];
    delete process.env['PIP_EXTRA_INDEX_URL'];
    delete process.env['UV_INDEX_URL'];
    delete process.env['UV_EXTRA_INDEX_URL'];

    const runner: CommandRunner = {
      run: vi.fn(),
      runArgs: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'Successfully installed django-3.2.15', stderr: '' }),
      dryRun: false,
      environment: 'host',
    } as unknown as CommandRunner;

    const detection = makeDetection({ tier: 1, tooling: 'uv', lockfile: `${CWD}/uv.lock` });
    mockedDetectPipTooling.mockResolvedValue(detection);

    await runPipUpdater(
      runner, {}, makeScanResult(), CWD, false, [], 'osv',
      undefined, undefined, undefined, undefined, 'pip', detection,
    );

    const runArgsCalls = (runner.runArgs as ReturnType<typeof vi.fn>).mock.calls;
    const uvCall = runArgsCalls.find((call: unknown[]) => call[0] === 'uv');
    expect(uvCall).toBeDefined();
    const opts = uvCall![2] as { env?: Record<string, string> };
    // When no env vars are set, env should be undefined (not passed)
    expect(opts.env).toBeUndefined();
  });
});

// ─── AC3: reachability-filtered packages ─────────────────────────────────────

describe('reachability-filtered packages (AC3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updater processes only packages present in the pre-filtered scan result', async () => {
    // The reachability engine removes blocked packages BEFORE the updater runs.
    // Here we simulate a scan result where only 'django' passes the filter
    // (e.g. 'pillow' was removed upstream as unreachable).
    const filteredScanResult = makeScanResult(['django==3.2.15']); // pillow removed

    const runner: CommandRunner = {
      run: vi.fn(),
      runArgs: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'Successfully installed django-3.2.15',
        stderr: '',
      }),
      dryRun: false,
      environment: 'host',
    } as unknown as CommandRunner;

    mockedDetectPipTooling.mockResolvedValue(makeDetection({ tier: 3, tooling: 'bare-pip' }));

    const result = await runPipUpdater(
      runner, {}, filteredScanResult, CWD, false, [], 'osv',
      undefined, undefined, undefined, undefined, 'pip', undefined,
    );

    expect(result.status).toBe('success');

    // The bare-pip flow checks pip-audit availability first; our mock returns exitCode 0
    // so pip-audit --fix is called. Either way, 'pillow' should never appear in any
    // command call since the scan result only contains django.
    const runArgsCalls = (runner.runArgs as ReturnType<typeof vi.fn>).mock.calls;
    const allArgStrings = runArgsCalls
      .filter((call: unknown[]) => Array.isArray(call[1]))
      .flatMap((call: unknown[]) => call[1] as string[])
      .join(' ');
    expect(allArgStrings).not.toContain('pillow');
    // At minimum, pip-audit or some tool was invoked (runner was used)
    expect(runArgsCalls.length).toBeGreaterThan(0);
  });
});

// ─── resolveBackupFiles ───────────────────────────────────────────────────────

describe('resolveBackupFiles', () => {
  it('returns PIP_FILES (requirements.txt) for bare-pip', () => {
    const det = makeDetection({ tier: 3, tooling: 'bare-pip' });
    expect(resolveBackupFiles(det)).toEqual(['requirements.txt']);
  });

  it('returns PIP_FILES for undefined detection', () => {
    expect(resolveBackupFiles(undefined)).toEqual(['requirements.txt']);
  });

  it('returns requirements.txt + poetry.lock for poetry', () => {
    const det = makeDetection({ tier: 1, tooling: 'poetry', lockfile: `${CWD}/poetry.lock` });
    expect(resolveBackupFiles(det)).toEqual(['requirements.txt', 'poetry.lock']);
  });

  it('returns requirements.txt + uv.lock for uv', () => {
    const det = makeDetection({ tier: 1, tooling: 'uv', lockfile: `${CWD}/uv.lock` });
    expect(resolveBackupFiles(det)).toEqual(['requirements.txt', 'uv.lock']);
  });

  it('returns requirements.txt + Pipfile.lock for pipenv', () => {
    const det = makeDetection({ tier: 1, tooling: 'pipenv', lockfile: `${CWD}/Pipfile.lock` });
    expect(resolveBackupFiles(det)).toEqual(['requirements.txt', 'Pipfile.lock']);
  });

  it('returns requirements.txt + requirements.in for pip-tools', () => {
    const det = makeDetection({ tier: 2, tooling: 'pip-tools', lockfile: undefined });
    expect(resolveBackupFiles(det)).toEqual(['requirements.txt', 'requirements.in']);
  });
});

// ─── resolveBootstrapSpec ─────────────────────────────────────────────────────

describe('resolveBootstrapSpec', () => {
  it('returns pip install for bare-pip', () => {
    const det = makeDetection({ tier: 3, tooling: 'bare-pip' });
    const spec = resolveBootstrapSpec(det);
    expect(spec.binary).toBe('pip');
    expect(spec.args).toEqual(['install', '-r', 'requirements.txt']);
  });

  it('returns pip install for undefined detection', () => {
    const spec = resolveBootstrapSpec(undefined);
    expect(spec.binary).toBe('pip');
  });

  it('returns poetry install for poetry', () => {
    const det = makeDetection({ tier: 1, tooling: 'poetry', lockfile: `${CWD}/poetry.lock` });
    const spec = resolveBootstrapSpec(det);
    expect(spec.binary).toBe('poetry');
    expect(spec.args).toEqual(['install', '--no-interaction']);
  });

  it('returns uv pip install for uv', () => {
    const det = makeDetection({ tier: 1, tooling: 'uv', lockfile: `${CWD}/uv.lock` });
    const spec = resolveBootstrapSpec(det);
    expect(spec.binary).toBe('uv');
    expect(spec.args).toEqual(['pip', 'install', '-r', 'requirements.txt']);
  });

  it('returns pipenv install for pipenv', () => {
    const det = makeDetection({ tier: 1, tooling: 'pipenv', lockfile: `${CWD}/Pipfile.lock` });
    const spec = resolveBootstrapSpec(det);
    expect(spec.binary).toBe('pipenv');
    expect(spec.args).toEqual(['install']);
  });

  it('returns pdm install for pdm', () => {
    const det = makeDetection({ tier: 1, tooling: 'pdm', lockfile: `${CWD}/pdm.lock` });
    const spec = resolveBootstrapSpec(det);
    expect(spec.binary).toBe('pdm');
    expect(spec.args).toEqual(['install', '--no-isolation']);
  });

  it('returns pip install for pip-tools', () => {
    const det = makeDetection({ tier: 2, tooling: 'pip-tools', lockfile: undefined });
    const spec = resolveBootstrapSpec(det);
    expect(spec.binary).toBe('pip');
    expect(spec.args).toEqual(['install', '-r', 'requirements.txt']);
  });
});
