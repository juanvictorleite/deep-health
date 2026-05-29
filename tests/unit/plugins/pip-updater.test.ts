import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommandRunner, CommandResult } from '@core/types/common';

// ── Module-level mocks ───────────────────────────────────────────────────────
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('requests==2.9.2\npillow==8.0.1\n'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@infra/utils/fs-backup.js', () => ({
  backupFiles: vi.fn().mockResolvedValue(new Map()),
  restoreFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@infra/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), phase: vi.fn(), skip: vi.fn(), header: vi.fn(), tagged: vi.fn() },
}));

vi.mock('@core/types/scan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@core/types/scan.js')>();
  return {
    ...actual,
    emptyEcosystem: vi.fn(() => ({
      vulnerabilities_total: 0,
      auto_safe: 0,
      breaking: 0,
      manual: 0,
      auto_safe_packages: [],
      breaking_packages: [],
      manual_packages: [],
      vulnerabilities: [],
    })),
  };
});

import { readFile as mockReadFile, writeFile as mockWriteFile } from 'node:fs/promises';

import type { ProjectConfig } from '@core/types/config';
import type { VulnerabilityEntry } from '@core/types/scan';
import type { ScanResultJson } from '@core/types/scan';
import { logger } from '@infra/utils/logger';
import {
  runPipUpdater,
  stripPipVersion,
  parsePipAuditFixJson,
  toPipInstallSpec,
  updateRequirementsContent,
  computeMaxSafeVersions,
  computeSortedSafeVersions,
  buildMaxCvssMap,
  sortSpecsByCvss,
  buildPipPackagesUpdated,
} from '@modules/ecosystem/plugins/pip-updater';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRunner(overrides: { dryRun?: boolean; run?: ReturnType<typeof vi.fn>; runArgs?: ReturnType<typeof vi.fn> } = {}): CommandRunner {
  const { dryRun = false, run, runArgs } = overrides;
  return {
    run: run ?? vi.fn().mockResolvedValue(ok()),
    runArgs: runArgs ?? vi.fn().mockResolvedValue(ok()),
    dryRun,
    environment: 'local',
  } as unknown as CommandRunner;
}

function ok(stdout = '', stderr = ''): CommandResult {
  return { stdout, stderr, exitCode: 0, command: '', dryRun: false };
}

function fail(stderr = 'pip install failed'): CommandResult {
  return { stdout: '', stderr, exitCode: 1, command: '', dryRun: false };
}

function failWithStdout(stdout: string, stderr = ''): CommandResult {
  return { stdout, stderr, exitCode: 1, command: '', dryRun: false };
}

function baseConfig(): ProjectConfig {
  return {
    project: { name: 'test-project', client: 'test-client' },
    ecosystems: [{ id: 'pip' }],
    protected_packages: { pip: [], npm: [], composer: [] },
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: false,
    },
    conflict_resolution: 'fail',
  };
}

function baseScan(pipAutoSafe: string[] = ['requests@2.31']): ScanResultJson {
  return {
    $schema: 'osv-scan-result/v1',
    agent: 'osv',
    status: 'success',
    environment: 'local',
    ecosystems: {
      pip: {
        vulnerabilities_total: 1,
        auto_safe: 1,
        breaking: 0,
        manual: 0,
        auto_safe_packages: pipAutoSafe,
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: [],
      },
    },
    error: null,
  };
}

function emptyScan(): ScanResultJson {
  return {
    $schema: 'osv-scan-result/v1',
    agent: 'osv',
    status: 'success',
    environment: 'local',
    ecosystems: {
      pip: {
        vulnerabilities_total: 0,
        auto_safe: 0,
        breaking: 0,
        manual: 0,
        auto_safe_packages: [],
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: [],
      },
    },
    error: null,
  };
}

function scanWithBreaking(breaking: string[] = ['django@4.0']): ScanResultJson {
  return {
    $schema: 'osv-scan-result/v1',
    agent: 'osv',
    status: 'success',
    environment: 'local',
    ecosystems: {
      pip: {
        vulnerabilities_total: 2,
        auto_safe: 1,
        breaking: 1,
        manual: 0,
        auto_safe_packages: ['requests@2.31'],
        breaking_packages: breaking,
        manual_packages: [],
        vulnerabilities: [],
      },
    },
    error: null,
  };
}

// pip-audit --version check fails (unavailable) → fallback to pip install
function pipAuditUnavailable(): CommandResult {
  return { stdout: '', stderr: 'pip-audit: command not found', exitCode: 127, command: '', dryRun: false };
}

// pip-audit --version succeeds
function pipAuditAvailable(): CommandResult {
  return { stdout: 'pip-audit 2.7.3', stderr: '', exitCode: 0, command: '', dryRun: false };
}

// ── (a) No packages to update ────────────────────────────────────────────────

describe('runPipUpdater — no packages to update', () => {
  it('returns immediately with a skipped validation when packageNamesToUpdate is empty', async () => {
    const runner = makeRunner();
    const result = await runPipUpdater(runner, baseConfig(), emptyScan(), '/tmp/project');
    expect(result.validations).toHaveLength(1);
    expect(result.validations[0]!.status).toBe('skipped');
    expect(result.validations[0]!.detail).toMatch(/no packages to update/i);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('no-packages path returns status "success"', async () => {
    const runner = makeRunner();
    const result = await runPipUpdater(runner, baseConfig(), emptyScan(), '/tmp/project');
    expect(result.status).toBe('success');
    expect(result.error).toBeNull();
  });

  // AC6(a): no-packages short-circuit is driven via probe — runArgs never called
  it('no-packages path: runArgs is never called (probe returns early without opening transaction)', async () => {
    const runArgsMock = vi.fn();
    const runner = makeRunner({ runArgs: runArgsMock });
    const result = await runPipUpdater(runner, baseConfig(), emptyScan(), '/tmp/project');
    expect(result.status).toBe('success');
    expect(result.packages_updated).toEqual([]);
    expect(runArgsMock).not.toHaveBeenCalled();
  });
});

// ── (b) Dry-run ───────────────────────────────────────────────────────────────

describe('runPipUpdater — dry-run paths', () => {
  it('dry-run WITH validationCommands => validation status is "skipped" and detail is "Dry-run — not executed"', async () => {
    const runner = makeRunner({ dryRun: true });
    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
    );
    expect(result.validations).toHaveLength(1);
    expect(result.validations[0]!.status).toBe('skipped');
    expect(result.validations[0]!.detail).toBe('Dry-run — not executed');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('dry-run WITHOUT validationCommands => validation status is "skipped" with no-validation detail', async () => {
    const runner = makeRunner({ dryRun: true });
    const result = await runPipUpdater(runner, baseConfig(), baseScan(), '/tmp/project', false, []);
    expect(result.validations[0]!.status).toBe('skipped');
    expect(result.validations[0]!.detail).toMatch(/no validation commands configured/i);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('dry-run always returns status "success" and agent "pip-safe-update"', async () => {
    const runner = makeRunner({ dryRun: true });
    const result = await runPipUpdater(runner, baseConfig(), baseScan(), '/tmp/project');
    expect(result.status).toBe('success');
    expect(result.agent).toBe('pip-safe-update');
    expect(result.$schema).toBe('osv-update-result/v1');
  });

  it('dry-run packages_updated is empty [] (post-update version not knowable in dry-run)', async () => {
    const runner = makeRunner({ dryRun: true });
    const scan = baseScan(['requests@2.31']);
    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, [{ name: 'check', command: 'pip check' }]);
    expect(result.packages_updated).toEqual([]);
  });

  // AC6(b): dryRun=true with packages — runArgs never called (no pip install -U)
  it('dry-run with packages: runArgs never called for pip install -U', async () => {
    const runArgsMock = vi.fn();
    const runner = makeRunner({ dryRun: true, runArgs: runArgsMock });
    const result = await runPipUpdater(runner, baseConfig(), baseScan(['requests@2.31']), '/tmp/project');
    expect(result.status).toBe('success');
    expect(runArgsMock).not.toHaveBeenCalled();
  });
});

// ── (c) Happy path (pip install fallback) ─────────────────────────────────────

describe('runPipUpdater — happy path (pip-audit unavailable → pip install -U fallback)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs validation command after successful update and returns status "success"', async () => {
    const runMock = vi.fn()
      .mockResolvedValueOnce(ok('No broken packages')); // pip check (validation)

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())      // pip-audit --version (unavailable)
      .mockResolvedValueOnce(ok('Successfully installed')); // pip install (version-pinned)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
    );

    expect(result.status).toBe('success');
    expect(result.validations).toHaveLength(1);
    expect(result.validations[0]!.name).toBe('check');
    expect(result.validations[0]!.status).toBe('pass');
  });
});

// ── (d) pip install fails ────────────────────────────────────────────────────

describe('runPipUpdater — update failure path (pip install fallback)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pip install failure => status is "error" and error message contains stderr', async () => {
    const runMock = vi.fn();

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())      // pip-audit --version (unavailable)
      .mockResolvedValueOnce(fail('Could not find a version that satisfies the requirement')) // pip install
      .mockResolvedValueOnce(ok()); // pip install -r requirements.txt (revert)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });
    const result = await runPipUpdater(runner, baseConfig(), baseScan(), '/tmp/project');

    expect(result.status).toBe('error');
    expect(result.error).toContain('pip install failed');
    expect(result.error).toContain('Could not find a version that satisfies');
  });

  it('pip install failure => validations are skipped', async () => {
    const runMock = vi.fn();

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())      // pip-audit --version (unavailable)
      .mockResolvedValueOnce(fail('conflict'))           // pip install
      .mockResolvedValueOnce(ok()); // pip install -r requirements.txt (revert)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });
    const result = await runPipUpdater(runner, baseConfig(), baseScan(), '/tmp/project');

    expect(result.validations[0]!.status).toBe('skipped');
  });

  it('pip install failure => reverts requirements.txt (revert wraps pip install with restore-twice)', async () => {
    const { restoreFiles: mockRestoreFiles } = await import('@infra/utils/fs-backup.js');
    const restoreSpy = mockRestoreFiles as ReturnType<typeof vi.fn>;
    restoreSpy.mockClear();

    const runMock = vi.fn();

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())      // pip-audit --version (unavailable)
      .mockResolvedValueOnce(fail('resolver error'))     // pip install
      .mockResolvedValueOnce(ok());                      // pip install -r requirements.txt (revert)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });
    const result = await runPipUpdater(runner, baseConfig(), baseScan(), '/tmp/project');

    expect(result.status).toBe('error');
    // Revert path runs restoreFiles twice (wrap pattern: pre + post pip install).
    expect(restoreSpy).toHaveBeenCalledTimes(2);
  });
});

// ── (e) Validation fails ──────────────────────────────────────────────────────

describe('runPipUpdater — validation failure path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validation failure => status is "error", changes reverted, pip install -r requirements.txt called', async () => {
    const runMock = vi.fn()
      .mockResolvedValueOnce(fail('pip check failed')); // pip check (FAIL via validation-runner)

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())      // pip-audit --version (unavailable)
      .mockResolvedValueOnce(ok())                       // pip install (version-pinned)
      .mockResolvedValueOnce(ok()); // pip install -r requirements.txt (revert)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('reverted');
    expect(result.validations[0]!.status).toBe('fail');
    expect(result.validations[0]!.name).toBe('check');

    // Revert pip install -r requirements.txt is called via runArgs
    const runArgsCommands = runArgsMock.mock.calls.map((c: unknown[]) => [String(c[0]), ...(c[1] as string[])].join(' '));
    expect(runArgsCommands.some((cmd) => cmd.includes('pip install -r requirements.txt'))).toBe(true);
  });
});

// ── (f) authorizeBreaking=true ────────────────────────────────────────────────

describe('runPipUpdater — authorizeBreaking=true', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes both auto_safe and breaking packages in update command (version-pinned, no -U)', async () => {
    const runMock = vi.fn()
      .mockResolvedValueOnce(ok()); // pip check (validation)

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())      // pip-audit --version (unavailable)
      .mockResolvedValueOnce(ok()); // pip install (version-pinned)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    await runPipUpdater(
      runner,
      baseConfig(),
      scanWithBreaking(['django@4.0']),
      '/tmp/project',
      true,
      [{ name: 'check', command: 'pip check' }],
    );

    // runArgs[0] = pip-audit --version, [1] = pip install (version-pinned)
    const runArgsArgs = runArgsMock.mock.calls[1] as [string, string[], unknown];
    expect(runArgsArgs[0]).toBe('pip');
    expect(runArgsArgs[1]).toContain('install');
    expect(runArgsArgs[1]).not.toContain('-U');
    expect(runArgsArgs[1]).toContain('requests==2.31');
    expect(runArgsArgs[1]).toContain('django==4.0');
  });
});

// ── (g) stripPipVersion unit tests ────────────────────────────────────────────

describe('stripPipVersion', () => {
  it('strips ==version specifier', () => {
    expect(stripPipVersion('requests==2.31')).toBe('requests');
  });

  it('strips >=version specifier', () => {
    expect(stripPipVersion('requests>=2.0')).toBe('requests');
  });

  it('strips ~=version specifier', () => {
    expect(stripPipVersion('requests~=2.0')).toBe('requests');
  });

  it('strips !=version specifier', () => {
    expect(stripPipVersion('requests!=1.0')).toBe('requests');
  });

  it('strips <version specifier', () => {
    expect(stripPipVersion('requests<3')).toBe('requests');
  });

  it('strips extras and ==version', () => {
    expect(stripPipVersion('requests[security]==2.31')).toBe('requests');
  });

  it('strips @version specifier', () => {
    expect(stripPipVersion('requests@1.0')).toBe('requests');
  });

  it('returns bare package name unchanged', () => {
    expect(stripPipVersion('requests')).toBe('requests');
  });

  it('strips multi-extra brackets and >=version', () => {
    expect(stripPipVersion('pkg[a,b]>=1')).toBe('pkg');
  });
});

describe('runPipUpdater — revert pip install fails (Resolution 5: now throws)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when pip install -r requirements.txt during revert exits non-zero', async () => {
    const runMock = vi.fn()
      .mockResolvedValueOnce(fail('pip check failed'));

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())      // pip-audit --version (unavailable)
      .mockResolvedValueOnce(ok())                       // pip install (version-pinned)
      .mockResolvedValueOnce(fail('revert err')); // pip install -r requirements.txt (revert FAILS)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    // Behavior change per ADR-0003 Resolution 5: revert-bootstrap failure now throws
    // (was: silently log error and continue)
    await expect(
      runPipUpdater(
        runner,
        baseConfig(),
        baseScan(),
        '/tmp/project',
        false,
        [{ name: 'check', command: 'pip check' }],
      ),
    ).rejects.toThrow(/pip install -r requirements\.txt \(revert\)/i);
  });
});

describe('runPipUpdater — unexpected error triggers PhaseError (lines 186-191)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws PhaseError when backupFiles throws unexpectedly', async () => {
    const { backupFiles } = await import('@infra/utils/fs-backup.js');
    (backupFiles as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

    const runner = makeRunner();

    await expect(
      runPipUpdater(
        runner,
        baseConfig(),
        baseScan(),
        '/tmp/project',
        false,
        [],
      ),
    ).rejects.toThrow('pip updater phase failed');
  });
});

describe('pip-updater additional branch coverage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pip ecosystem uses emptyEcosystem() when pip key missing from scan (line 84 ?? branch)', async () => {
    const runner = makeRunner();
    // Use a scan with no pip ecosystem
    const scan: ScanResultJson = {
      ...baseScan(),
      ecosystems: {}, // no 'pip' key
    };
    // Should not throw — just returns no-op result with no updates
    const result = await runPipUpdater(runner, baseConfig(), scan as any, '/tmp/project', false, []);
    expect(result).toBeDefined();
  });

  it('uses String(err) when a non-Error is thrown during pip updater (line 187)', async () => {
    const { backupFiles } = await import('@infra/utils/fs-backup.js');
    (backupFiles as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string-error');

    const runner = makeRunner();
    await expect(
      runPipUpdater(runner, baseConfig(), baseScan(), '/tmp/project', false, []),
    ).rejects.toThrow('pip updater phase failed: string-error');
  });
});

// ── OSV-first-wins in pip derivePackagesUpdated ──────────────────────────────

describe('runPipUpdater — OSV-first-wins in derivePackagesUpdated', () => {
  beforeEach(() => vi.clearAllMocks());

  it('OSV-first-wins: OSV packages appear first when no overlap with pip install', async () => {
    const runMock = vi.fn().mockResolvedValueOnce(ok());  // pip check (validation)
    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())       // pip-audit --version (unavailable)
      .mockResolvedValueOnce(ok('Successfully installed django-4.2.0')); // pip install (version-pinned)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    const osvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'pillow', versionFrom: '9.0.0', versionTo: '9.5.0' },
      ],
    };

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['requests@2.31', 'django@4.2.0']),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
      undefined,   // _fixerStrategy (default)
      undefined,   // preFixBackups
      osvFixOutcome,
    );

    expect(result.status).toBe('success');
    // OSV package (pillow) comes first
    expect(result.packages_updated[0]).toBe('pillow@9.5.0');
    // pip install package (django) added as complementary
    expect(result.packages_updated).toContain('django@4.2.0');
  });

  it('OSV-first-wins: OSV version wins when fixer also reports the same package', async () => {
    const runMock = vi.fn().mockResolvedValueOnce(ok());  // pip check (validation)
    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())       // pip-audit --version (unavailable)
      .mockResolvedValueOnce(ok('Successfully installed requests-2.32.0')); // pip install (version-pinned)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    // OSV fixed requests@2.31.0; pip install upgraded to 2.32.0
    const osvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'requests', versionFrom: '2.30.0', versionTo: '2.31.0' },
      ],
    };

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['requests@2.32.0']),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
      undefined,   // _fixerStrategy (default)
      undefined,   // preFixBackups
      osvFixOutcome,
    );

    expect(result.status).toBe('success');
    // OSV version (2.31.0) wins over pip install version (2.32.0)
    expect(result.packages_updated).toContain('requests@2.31.0');
    expect(result.packages_updated).not.toContain('requests@2.32.0');
    expect(result.packages_updated).toHaveLength(1);
  });

  it('without osvFixOutcome, returns pip packages as-is (no regression)', async () => {
    const runMock = vi.fn().mockResolvedValueOnce(ok());  // pip check (validation)
    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())       // pip-audit --version (unavailable)
      .mockResolvedValueOnce(ok('Successfully installed requests-2.32.0 django-4.2.0')); // pip install (version-pinned)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['requests@2.32.0', 'django@4.2.0']),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
      // no osvFixOutcome
    );

    expect(result.status).toBe('success');
    expect(result.packages_updated).toContain('requests@2.32.0');
    expect(result.packages_updated).toContain('django@4.2.0');
  });
});

// ── parsePipAuditFixJson unit tests ───────────────────────────────────────────

describe('parsePipAuditFixJson', () => {
  it('returns name@fix_version for each non-skipped entry with a fix_version', () => {
    const json = JSON.stringify({
      fixes: [
        { name: 'Pillow', version: '9.0.0', fix_version: '9.5.0', is_skipped: false },
        { name: 'requests', version: '2.28.0', fix_version: '2.31.0', is_skipped: false },
      ],
    });
    expect(parsePipAuditFixJson(json)).toEqual(['pillow@9.5.0', 'requests@2.31.0']);
  });

  it('lowercases package names', () => {
    const json = JSON.stringify({
      fixes: [{ name: 'Django', version: '3.0.0', fix_version: '3.2.20', is_skipped: false }],
    });
    expect(parsePipAuditFixJson(json)).toEqual(['django@3.2.20']);
  });

  it('skips entries where is_skipped is true', () => {
    const json = JSON.stringify({
      fixes: [
        { name: 'pillow', version: '9.0.0', fix_version: '9.5.0', is_skipped: true },
        { name: 'requests', version: '2.28.0', fix_version: '2.31.0', is_skipped: false },
      ],
    });
    expect(parsePipAuditFixJson(json)).toEqual(['requests@2.31.0']);
  });

  it('skips entries without fix_version', () => {
    const json = JSON.stringify({
      fixes: [
        { name: 'pillow', version: '9.0.0', is_skipped: false },
        { name: 'requests', version: '2.28.0', fix_version: '2.31.0', is_skipped: false },
      ],
    });
    expect(parsePipAuditFixJson(json)).toEqual(['requests@2.31.0']);
  });

  it('returns empty array for empty fixes array', () => {
    const json = JSON.stringify({ fixes: [] });
    expect(parsePipAuditFixJson(json)).toEqual([]);
  });

  it('returns empty array when fixes key is missing', () => {
    const json = JSON.stringify({ dependencies: [] });
    expect(parsePipAuditFixJson(json)).toEqual([]);
  });

  it('returns empty array for malformed JSON', () => {
    expect(parsePipAuditFixJson('not-json')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parsePipAuditFixJson('')).toEqual([]);
  });

  it('returns empty array for null JSON value', () => {
    expect(parsePipAuditFixJson('null')).toEqual([]);
  });

  it('handles entries with missing name field (skips them)', () => {
    const json = JSON.stringify({
      fixes: [
        { version: '1.0.0', fix_version: '1.1.0', is_skipped: false },
        { name: 'requests', fix_version: '2.31.0', is_skipped: false },
      ],
    });
    expect(parsePipAuditFixJson(json)).toEqual(['requests@2.31.0']);
  });

  it('handles non-object entries in the fixes array gracefully', () => {
    const json = JSON.stringify({
      fixes: [null, 'bad', 42, { name: 'pillow', fix_version: '9.5.0', is_skipped: false }],
    });
    expect(parsePipAuditFixJson(json)).toEqual(['pillow@9.5.0']);
  });
});

// ── pip-audit happy path ──────────────────────────────────────────────────────

describe('runPipUpdater — pip-audit happy path (exit 0)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses pip-audit --fix when pip-audit is available and returns packages from JSON', async () => {
    const auditJson = JSON.stringify({
      fixes: [
        { name: 'pillow', version: '9.0.0', fix_version: '9.5.0', is_skipped: false },
      ],
    });

    const runMock = vi.fn().mockResolvedValueOnce(ok()); // validation

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditAvailable())        // pip-audit --version (available)
      .mockResolvedValueOnce(ok(auditJson));             // pip-audit --fix -r requirements.txt --format json

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['pillow@9.5.0']),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
    );

    expect(result.status).toBe('success');
    expect(result.packages_updated).toContain('pillow@9.5.0');

    // Verify pip-audit --fix was called with expected args
    const pipAuditCall = runArgsMock.mock.calls[1] as [string, string[], unknown];
    expect(pipAuditCall[0]).toBe('pip-audit');
    expect(pipAuditCall[1]).toContain('--fix');
    expect(pipAuditCall[1]).toContain('-r');
    expect(pipAuditCall[1]).toContain('requirements.txt');
    expect(pipAuditCall[1]).toContain('--format');
    expect(pipAuditCall[1]).toContain('json');
  });

  it('pip-audit path does NOT call pip list --outdated', async () => {
    const auditJson = JSON.stringify({ fixes: [] });

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditAvailable())        // pip-audit --version
      .mockResolvedValueOnce(ok(auditJson));             // pip-audit --fix

    const runner = makeRunner({ runArgs: runArgsMock });

    await runPipUpdater(runner, baseConfig(), baseScan(['requests@2.31']), '/tmp/project', false, []);

    const calledBinaries = runArgsMock.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calledBinaries).not.toContain('pip');
    expect(calledBinaries.filter((b) => b === 'pip-audit')).toHaveLength(2);
  });
});

// ── pip-audit partial fix (exit 1 with JSON) ─────────────────────────────────

describe('runPipUpdater — pip-audit partial fix (exit 1 with JSON stdout)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('treats exit 1 with valid JSON stdout as success', async () => {
    const auditJson = JSON.stringify({
      fixes: [
        { name: 'requests', version: '2.28.0', fix_version: '2.31.0', is_skipped: false },
      ],
    });

    const runMock = vi.fn().mockResolvedValueOnce(ok()); // validation

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditAvailable())              // pip-audit --version
      .mockResolvedValueOnce(failWithStdout(auditJson));       // pip-audit --fix exits 1 but has JSON

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['requests@2.31']),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
    );

    expect(result.status).toBe('success');
    expect(result.packages_updated).toContain('requests@2.31.0');
  });

  it('treats exit 1 with non-JSON stdout as error', async () => {
    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditAvailable())              // pip-audit --version
      .mockResolvedValueOnce(failWithStdout('ERROR: something went wrong')) // exit 1, no JSON
      .mockResolvedValueOnce(ok());                            // pip install -r requirements.txt (revert)

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), baseScan(), '/tmp/project');

    expect(result.status).toBe('error');
    expect(result.error).toContain('pip-audit --fix failed');
  });
});

// ── pip-audit unavailable → fallback ─────────────────────────────────────────

describe('runPipUpdater — pip-audit unavailable fallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls back to pip install (version-pinned) when pip-audit --version fails', async () => {
    const runMock = vi.fn().mockResolvedValueOnce(ok()); // validation

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())      // pip-audit --version (fails)
      .mockResolvedValueOnce(ok('Successfully installed requests-2.31.0')); // pip install (version-pinned)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['requests@2.31']),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
    );

    expect(result.status).toBe('success');
    expect(result.packages_updated).toContain('requests@2.31.0');

    // Verify pip install was called with version-pinned spec (not -U bare name)
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && c[1].includes('install'));
    expect(installCall).toBeDefined();
    expect(installCall![1]).not.toContain('-U');
    expect(installCall![1]).toContain('requests==2.31');
  });

  it('pip-audit --version throwing (e.g. ENOENT) is treated as unavailable', async () => {
    const runArgsMock = vi.fn()
      .mockRejectedValueOnce(new Error('ENOENT: pip-audit not found'))  // pip-audit throws
      .mockResolvedValueOnce(ok('Successfully installed django-4.2.0')); // pip install (version-pinned)

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), baseScan(['django@4.2.0']), '/tmp/project', false, []);

    // Should have fallen back to pip install -U
    expect(result.status).toBe('success');
  });
});

// ── ecosystemKey tests ────────────────────────────────────────────────────────

describe('runPipUpdater — ecosystemKey override', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses ecosystemKey to look up scan result (non-default key "pip:api")', async () => {
    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        'pip:api': {
          vulnerabilities_total: 1,
          auto_safe: 1,
          breaking: 0,
          manual: 0,
          auto_safe_packages: ['flask@2.3.0'],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: [],
        },
      },
      error: null,
    };

    const runMock = vi.fn().mockResolvedValueOnce(ok()); // validation

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())       // pip-audit --version (unavailable)
      .mockResolvedValueOnce(ok('Successfully installed flask-2.3.0')); // pip install (version-pinned)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      scan,
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
      undefined,   // _fixerStrategy
      undefined,   // preFixBackups
      undefined,   // osvFixOutcome
      undefined,   // preRunSnapshots
      undefined,   // _advisorResults
      'pip:api',   // ecosystemKey
    );

    expect(result.status).toBe('success');
    // Packages came from the 'pip:api' key
    expect(result.packages_updated).toContain('flask@2.3.0');
  });

  it('defaults ecosystemKey to "pip" when not specified (no regression)', async () => {
    const runMock = vi.fn().mockResolvedValueOnce(ok());
    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())
      .mockResolvedValueOnce(ok('Successfully installed requests-2.31.0')); // pip install (version-pinned)

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['requests@2.31']),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
      // no ecosystemKey — should default to 'pip'
    );

    expect(result.status).toBe('success');
    expect(result.packages_updated).toContain('requests@2.31.0');
  });

  it('returns no-op when ecosystemKey does not exist in scan (falls back to emptyEcosystem)', async () => {
    const runner = makeRunner();

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(), // has 'pip' key but not 'pip:worker'
      '/tmp/project',
      false,
      [],
      undefined,
      'pip:worker',
    );

    // emptyEcosystem has no packages → probe short-circuits
    expect(result.status).toBe('success');
    expect(result.packages_updated).toEqual([]);
  });
});

// ── toPipInstallSpec unit tests ───────────────────────────────────────────────

describe('toPipInstallSpec', () => {
  it('converts == separator to pinned spec', () => {
    expect(toPipInstallSpec('pillow==9.5.0')).toBe('pillow==9.5.0');
  });

  it('converts @ separator to pinned spec', () => {
    expect(toPipInstallSpec('pillow@9.5.0')).toBe('pillow==9.5.0');
  });

  it('returns bare name when no version found', () => {
    expect(toPipInstallSpec('pillow')).toBe('pillow');
  });

  it('strips extras from name before pinning version', () => {
    expect(toPipInstallSpec('requests[security]@2.31.0')).toBe('requests==2.31.0');
  });

  it('handles requests@2.31 (baseScan format)', () => {
    expect(toPipInstallSpec('requests@2.31')).toBe('requests==2.31');
  });

  it('handles django@4.0 (scanWithBreaking format)', () => {
    expect(toPipInstallSpec('django@4.0')).toBe('django==4.0');
  });

  it('handles == with pre-release version', () => {
    expect(toPipInstallSpec('mypackage==1.0.0a1')).toBe('mypackage==1.0.0a1');
  });
});

// ── updateRequirementsContent unit tests ─────────────────────────────────────

describe('updateRequirementsContent', () => {
  it('replaces version for a matched package', () => {
    const content = 'requests==2.9.2\n';
    const versions = new Map([['requests', '2.31.0']]);
    expect(updateRequirementsContent(content, versions)).toBe('requests==2.31.0\n');
  });

  it('preserves comment lines unchanged', () => {
    const content = '# this is a comment\nrequests==2.9.2\n';
    const versions = new Map([['requests', '2.31.0']]);
    const result = updateRequirementsContent(content, versions);
    expect(result).toContain('# this is a comment');
    expect(result).toContain('requests==2.31.0');
  });

  it('preserves blank lines unchanged', () => {
    const content = 'requests==2.9.2\n\npillow==8.0.1\n';
    const versions = new Map([['requests', '2.31.0'], ['pillow', '9.5.0']]);
    const result = updateRequirementsContent(content, versions);
    expect(result).toContain('\n\n');
    expect(result).toContain('requests==2.31.0');
    expect(result).toContain('pillow==9.5.0');
  });

  it('preserves extras like [security]', () => {
    const content = 'requests[security]==2.9.2\n';
    const versions = new Map([['requests', '2.31.0']]);
    const result = updateRequirementsContent(content, versions);
    expect(result).toBe('requests[security]==2.31.0\n');
  });

  it('preserves environment markers (;  sys_platform == ...)', () => {
    const content = "pillow==8.0.1; sys_platform == 'win32'\n";
    const versions = new Map([['pillow', '9.5.0']]);
    const result = updateRequirementsContent(content, versions);
    expect(result).toBe("pillow==9.5.0; sys_platform == 'win32'\n");
  });

  it('preserves -r and -e options unchanged', () => {
    const content = '-r base.txt\n-e .\nrequests==2.9.2\n';
    const versions = new Map([['requests', '2.31.0']]);
    const result = updateRequirementsContent(content, versions);
    expect(result).toContain('-r base.txt');
    expect(result).toContain('-e .');
  });

  it('leaves unmatched packages unchanged', () => {
    const content = 'flask==1.0.0\nrequests==2.9.2\n';
    const versions = new Map([['requests', '2.31.0']]);
    const result = updateRequirementsContent(content, versions);
    expect(result).toContain('flask==1.0.0');
    expect(result).toContain('requests==2.31.0');
  });

  it('returns original content unchanged when map is empty', () => {
    const content = 'requests==2.9.2\npillow==8.0.1\n';
    const result = updateRequirementsContent(content, new Map());
    expect(result).toBe(content);
  });

  it('updates multiple packages in one pass', () => {
    const content = 'requests==2.9.2\npillow==8.0.1\ndjango==3.2.0\n';
    const versions = new Map([['requests', '2.31.0'], ['pillow', '9.5.0'], ['django', '4.2.0']]);
    const result = updateRequirementsContent(content, versions);
    expect(result).toBe('requests==2.31.0\npillow==9.5.0\ndjango==4.2.0\n');
  });
});

// ── requirements.txt rewrite integration ─────────────────────────────────────

describe('runPipUpdater — requirements.txt rewrite after pip install', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls writeFile with updated content after successful pip install', async () => {
    const mockWrite = mockWriteFile as ReturnType<typeof vi.fn>;
    const mockRead = mockReadFile as ReturnType<typeof vi.fn>;
    mockRead.mockResolvedValueOnce('requests==2.9.2\npillow==8.0.1\n');

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())       // pip-audit --version (unavailable)
      .mockResolvedValueOnce(ok('Successfully installed requests-2.31.0 pillow-9.5.0')); // pip install

    const runner = makeRunner({ runArgs: runArgsMock });

    await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['requests@2.31.0', 'pillow@9.5.0']),
      '/tmp/project',
    );

    expect(mockWrite).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = mockWrite.mock.calls[0] as [string, string, string];
    expect(writtenPath).toContain('requirements.txt');
    expect(writtenContent).toContain('requests==2.31.0');
    expect(writtenContent).toContain('pillow==9.5.0');
  });

  it('does NOT call writeFile for pip-audit path', async () => {
    const mockWrite = mockWriteFile as ReturnType<typeof vi.fn>;
    mockWrite.mockClear();

    const auditJson = JSON.stringify({
      fixes: [{ name: 'requests', version: '2.9.2', fix_version: '2.31.0', is_skipped: false }],
    });

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditAvailable())         // pip-audit --version (available)
      .mockResolvedValueOnce(ok(auditJson));              // pip-audit --fix

    const runner = makeRunner({ runArgs: runArgsMock });

    await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['requests@2.31.0']),
      '/tmp/project',
    );

    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('does NOT call writeFile when pip install fails', async () => {
    const mockWrite = mockWriteFile as ReturnType<typeof vi.fn>;
    mockWrite.mockClear();

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())       // pip-audit --version (unavailable)
      .mockResolvedValueOnce(fail('install failed'))      // pip install fails
      .mockResolvedValueOnce(ok());                       // pip install -r requirements.txt (revert)

    const runner = makeRunner({ runArgs: runArgsMock });

    await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['requests@2.31.0']),
      '/tmp/project',
    );

    expect(mockWrite).not.toHaveBeenCalled();
  });
});

// ── computeMaxSafeVersions unit tests ────────────────────────────────────────

function makeVuln(pkg: string, safeVersion: string | null, classification: 'auto_safe' | 'breaking' | 'manual'): VulnerabilityEntry {
  return {
    ecosystem: 'pip',
    package: pkg,
    currentVersion: '0.0.1',
    safeVersion,
    cvss: '0',
    ghsaId: 'GHSA-test',
    risk: 'low',
    classification,
    reason: 'test',
  };
}

describe('computeMaxSafeVersions', () => {
  it('(a) single vuln — returns that safeVersion', () => {
    const vulns = [makeVuln('pillow', '8.3.2', 'auto_safe')];
    const result = computeMaxSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toBe('8.3.2');
    expect(result.size).toBe(1);
  });

  it('(b) multiple vulns same package — returns MAX version', () => {
    const vulns = [
      makeVuln('pillow', '8.1.0', 'auto_safe'),
      makeVuln('pillow', '8.3.2', 'auto_safe'),
      makeVuln('pillow', '8.2.0', 'auto_safe'),
    ];
    const result = computeMaxSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toBe('8.3.2');
  });

  it('(c) null safeVersion entries are skipped', () => {
    const vulns = [
      makeVuln('pillow', null, 'auto_safe'),
      makeVuln('pillow', '8.3.2', 'auto_safe'),
    ];
    const result = computeMaxSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toBe('8.3.2');
  });

  it('(c) all null safeVersion entries — package NOT in map', () => {
    const vulns = [makeVuln('pillow', null, 'auto_safe')];
    const result = computeMaxSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.has('pillow')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('(d) mixed classifications — only specified ones are included', () => {
    const vulns = [
      makeVuln('pillow', '8.3.2', 'auto_safe'),
      makeVuln('pillow', '12.2.0', 'breaking'),
      makeVuln('django', '3.2.20', 'breaking'),
    ];
    const result = computeMaxSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toBe('8.3.2');
    expect(result.has('django')).toBe(false);
  });

  it('(d) manual classification excluded when not in classifications set', () => {
    const vulns = [
      makeVuln('requests', '2.31.0', 'manual'),
      makeVuln('requests', '2.28.0', 'auto_safe'),
    ];
    const result = computeMaxSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('requests')).toBe('2.28.0');
  });

  it('(e) empty vulnerabilities array — returns empty Map', () => {
    const result = computeMaxSafeVersions([], new Set(['auto_safe']));
    expect(result.size).toBe(0);
  });

  it('(f) non-semver-coercible versions — falls back to localeCompare', () => {
    const vulns = [
      makeVuln('mypkg', 'beta', 'auto_safe'),
      makeVuln('mypkg', 'alpha', 'auto_safe'),
    ];
    const result = computeMaxSafeVersions(vulns, new Set(['auto_safe']));
    // 'beta' > 'alpha' via localeCompare
    expect(result.get('mypkg')).toBe('beta');
  });

  it('package names are normalized to lowercase', () => {
    const vulns = [
      makeVuln('Pillow', '8.3.2', 'auto_safe'),
      makeVuln('PILLOW', '8.2.0', 'auto_safe'),
    ];
    const result = computeMaxSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toBe('8.3.2');
    expect(result.size).toBe(1);
  });

  it('handles multiple packages independently', () => {
    const vulns = [
      makeVuln('requests', '2.28.0', 'auto_safe'),
      makeVuln('requests', '2.31.0', 'auto_safe'),
      makeVuln('django', '3.2.0', 'auto_safe'),
      makeVuln('django', '4.2.0', 'auto_safe'),
    ];
    const result = computeMaxSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('requests')).toBe('2.31.0');
    expect(result.get('django')).toBe('4.2.0');
  });

  it('empty classifications set — returns empty Map', () => {
    const vulns = [makeVuln('pillow', '8.3.2', 'auto_safe')];
    const result = computeMaxSafeVersions(vulns, new Set());
    expect(result.size).toBe(0);
  });
});

// ── computeMaxSafeVersions pillow integration test ────────────────────────────

describe('computeMaxSafeVersions — pillow realistic vulnerability data (AC7)', () => {
  const pillowAutoSafeVulns: VulnerabilityEntry[] = [
    makeVuln('pillow', '8.1.0', 'auto_safe'),
    makeVuln('pillow', '8.1.1', 'auto_safe'),
    makeVuln('pillow', '8.1.2', 'auto_safe'),
    makeVuln('pillow', '8.2.0', 'auto_safe'),
    makeVuln('pillow', '8.3.0', 'auto_safe'),
    makeVuln('pillow', '8.3.2', 'auto_safe'),
  ];

  const pillowBreakingVulns: VulnerabilityEntry[] = [
    makeVuln('pillow', '9.0.0', 'breaking'),
    makeVuln('pillow', '9.0.1', 'breaking'),
    makeVuln('pillow', '9.2.0', 'breaking'),
    makeVuln('pillow', '10.0.0', 'breaking'),
    makeVuln('pillow', '10.2.0', 'breaking'),
    makeVuln('pillow', '12.2.0', 'breaking'),
  ];

  const allVulns = [...pillowAutoSafeVulns, ...pillowBreakingVulns];

  it('authorizeBreaking=false → pillow max auto_safe version is 8.3.2', () => {
    const result = computeMaxSafeVersions(allVulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toBe('8.3.2');
  });

  it('authorizeBreaking=true → pillow max version across all classifications is 12.2.0', () => {
    const result = computeMaxSafeVersions(allVulns, new Set(['auto_safe', 'breaking']));
    expect(result.get('pillow')).toBe('12.2.0');
  });

  it('authorizeBreaking=false → install spec is pillow==8.3.2 (NOT 8.0.1 or 9.5.0)', () => {
    const result = computeMaxSafeVersions(allVulns, new Set(['auto_safe']));
    const spec = result.get('pillow');
    expect(spec).not.toBe('8.0.1'); // NOT currentVersion
    expect(spec).not.toBe('9.5.0'); // NOT latest/breaking
    expect(spec).toBe('8.3.2');
  });
});

// ── runPipUpdater uses computeMaxSafeVersions for pip install specs ───────────

describe('runPipUpdater — computeMaxSafeVersions-driven install specs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses MAX safeVersion from vulnerabilities[] instead of currentVersion for pip install spec', async () => {
    const pillowVulns: VulnerabilityEntry[] = [
      makeVuln('pillow', '8.1.0', 'auto_safe'),
      makeVuln('pillow', '8.3.2', 'auto_safe'),
      makeVuln('pillow', '8.2.0', 'auto_safe'),
    ];

    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        pip: {
          vulnerabilities_total: 3,
          auto_safe: 3,
          breaking: 0,
          manual: 0,
          auto_safe_packages: ['pillow==8.0.1'],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: pillowVulns,
        },
      },
      error: null,
    };

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())   // pip-audit --version (unavailable)
      .mockResolvedValueOnce(ok())                    // pip install --dry-run --quiet (batch validation)
      .mockResolvedValueOnce(ok('Successfully installed pillow-8.3.2')); // pip install

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    expect(result.status).toBe('success');

    // Check that pip install was called with pillow==8.3.2 (MAX safeVersion), not pillow==8.0.1
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && c[1].includes('install') && !c[1].includes('--dry-run'));
    expect(installCall).toBeDefined();
    expect(installCall![1]).toContain('pillow==8.3.2');
    expect(installCall![1]).not.toContain('pillow==8.0.1');
  });

  it('falls back to toPipInstallSpec when vulnerabilities[] is empty (backward compat)', async () => {
    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        pip: {
          vulnerabilities_total: 1,
          auto_safe: 1,
          breaking: 0,
          manual: 0,
          auto_safe_packages: ['requests@2.31'],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: [], // empty — triggers fallback
        },
      },
      error: null,
    };

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())
      .mockResolvedValueOnce(ok('Successfully installed requests-2.31.0'));

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);
    expect(result.status).toBe('success');

    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && c[1].includes('install'));
    expect(installCall).toBeDefined();
    // Fallback: requests@2.31 → requests==2.31
    expect(installCall![1]).toContain('requests==2.31');
  });

  it('authorizeBreaking=true uses MAX across auto_safe AND breaking classifications', async () => {
    const pillowVulns: VulnerabilityEntry[] = [
      makeVuln('pillow', '8.3.2', 'auto_safe'),
      makeVuln('pillow', '12.2.0', 'breaking'),
    ];

    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        pip: {
          vulnerabilities_total: 2,
          auto_safe: 1,
          breaking: 1,
          manual: 0,
          auto_safe_packages: ['pillow==8.0.1'],
          breaking_packages: ['pillow==9.0.0'],
          manual_packages: [],
          vulnerabilities: pillowVulns,
        },
      },
      error: null,
    };

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())
      .mockResolvedValueOnce(ok())                   // pip install --dry-run --quiet (batch validation)
      .mockResolvedValueOnce(ok('Successfully installed pillow-12.2.0'));

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', true, []);
    expect(result.status).toBe('success');

    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && c[1].includes('install') && !c[1].includes('--dry-run'));
    expect(installCall).toBeDefined();
    // authorizeBreaking=true → max of all classifications → 12.2.0
    expect(installCall![1]).toContain('pillow==12.2.0');
    expect(installCall![1]).not.toContain('pillow==8.0.1');
    expect(installCall![1]).not.toContain('pillow==9.0.0');
  });
});

// ── pip-audit OSV-first-wins integration ──────────────────────────────────────

describe('runPipUpdater — pip-audit mode OSV-first-wins', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merges pip-audit packages with OSV outcome (OSV wins on overlap)', async () => {
    const auditJson = JSON.stringify({
      fixes: [
        { name: 'requests', version: '2.28.0', fix_version: '2.32.0', is_skipped: false },
      ],
    });

    const runMock = vi.fn().mockResolvedValueOnce(ok());
    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditAvailable())
      .mockResolvedValueOnce(ok(auditJson));

    const runner = makeRunner({ run: runMock, runArgs: runArgsMock });

    const osvFixOutcome = {
      applied: true,
      packagesUpdated: [{ name: 'requests', versionFrom: '2.28.0', versionTo: '2.31.0' }],
    };

    const result = await runPipUpdater(
      runner,
      baseConfig(),
      baseScan(['requests@2.31']),
      '/tmp/project',
      false,
      [{ name: 'check', command: 'pip check' }],
      undefined,   // _fixerStrategy
      undefined,   // preFixBackups
      osvFixOutcome,
    );

    expect(result.status).toBe('success');
    // OSV version (2.31.0) wins over pip-audit version (2.32.0)
    expect(result.packages_updated).toContain('requests@2.31.0');
    expect(result.packages_updated).not.toContain('requests@2.32.0');
    expect(result.packages_updated).toHaveLength(1);
  });
});

// ── computeSortedSafeVersions unit tests ──────────────────────────────────────

describe('computeSortedSafeVersions', () => {
  it('(1) single vuln — returns array with that version', () => {
    const vulns = [makeVuln('pillow', '8.3.2', 'auto_safe')];
    const result = computeSortedSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toEqual(['8.3.2']);
    expect(result.size).toBe(1);
  });

  it('(2) multiple vulns for same package — returns all unique versions sorted descending', () => {
    const vulns = [
      makeVuln('pillow', '8.1.0', 'auto_safe'),
      makeVuln('pillow', '8.3.2', 'auto_safe'),
      makeVuln('pillow', '8.2.0', 'auto_safe'),
    ];
    const result = computeSortedSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toEqual(['8.3.2', '8.2.0', '8.1.0']);
  });

  it('(3) null safeVersion entries are excluded from the result', () => {
    const vulns = [
      makeVuln('pillow', null, 'auto_safe'),
      makeVuln('pillow', '8.3.2', 'auto_safe'),
      makeVuln('pillow', '8.1.0', 'auto_safe'),
    ];
    const result = computeSortedSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toEqual(['8.3.2', '8.1.0']);
    expect(result.get('pillow')).not.toContain(null);
  });

  it('(4) classification filtering — only specified classifications are included', () => {
    const vulns = [
      makeVuln('pillow', '8.3.2', 'auto_safe'),
      makeVuln('pillow', '12.2.0', 'breaking'),
      makeVuln('django', '3.2.20', 'breaking'),
    ];
    const result = computeSortedSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toEqual(['8.3.2']);
    expect(result.has('django')).toBe(false);
  });

  it('(5) multiple packages — each gets its own sorted version list', () => {
    const vulns = [
      makeVuln('requests', '2.28.0', 'auto_safe'),
      makeVuln('requests', '2.31.0', 'auto_safe'),
      makeVuln('django', '3.2.0', 'auto_safe'),
      makeVuln('django', '4.2.0', 'auto_safe'),
    ];
    const result = computeSortedSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('requests')).toEqual(['2.31.0', '2.28.0']);
    expect(result.get('django')).toEqual(['4.2.0', '3.2.0']);
    expect(result.size).toBe(2);
  });

  it('(6) non-semver versions use localeCompare fallback — sorted descending', () => {
    const vulns = [
      makeVuln('mypkg', 'alpha', 'auto_safe'),
      makeVuln('mypkg', 'beta', 'auto_safe'),
      makeVuln('mypkg', 'gamma', 'auto_safe'),
    ];
    const result = computeSortedSafeVersions(vulns, new Set(['auto_safe']));
    // localeCompare descending: gamma > beta > alpha
    expect(result.get('mypkg')).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('deduplicates identical versions', () => {
    const vulns = [
      makeVuln('pillow', '8.3.2', 'auto_safe'),
      makeVuln('pillow', '8.3.2', 'auto_safe'),
      makeVuln('pillow', '8.1.0', 'auto_safe'),
    ];
    const result = computeSortedSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toEqual(['8.3.2', '8.1.0']);
  });

  it('package names are normalized to lowercase', () => {
    const vulns = [
      makeVuln('Pillow', '8.3.2', 'auto_safe'),
      makeVuln('PILLOW', '8.1.0', 'auto_safe'),
    ];
    const result = computeSortedSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.get('pillow')).toEqual(['8.3.2', '8.1.0']);
    expect(result.size).toBe(1);
  });

  it('empty vulnerabilities array — returns empty Map', () => {
    const result = computeSortedSafeVersions([], new Set(['auto_safe']));
    expect(result.size).toBe(0);
  });

  it('all null safeVersions — package NOT in map', () => {
    const vulns = [makeVuln('pillow', null, 'auto_safe')];
    const result = computeSortedSafeVersions(vulns, new Set(['auto_safe']));
    expect(result.has('pillow')).toBe(false);
  });

  it('both auto_safe and breaking when both included in classifications', () => {
    const vulns = [
      makeVuln('pillow', '8.3.2', 'auto_safe'),
      makeVuln('pillow', '12.2.0', 'breaking'),
    ];
    const result = computeSortedSafeVersions(vulns, new Set(['auto_safe', 'breaking']));
    expect(result.get('pillow')).toEqual(['12.2.0', '8.3.2']);
  });
});

// ── validatePipSpecs — integration tests via runPipUpdater ───────────────────

function scanWithVulns(pkg: string, versions: string[]): ScanResultJson {
  const vulns: VulnerabilityEntry[] = versions.map((v) => makeVuln(pkg, v, 'auto_safe'));
  return {
    $schema: 'osv-scan-result/v1',
    agent: 'osv',
    status: 'success',
    environment: 'local',
    ecosystems: {
      pip: {
        vulnerabilities_total: vulns.length,
        auto_safe: vulns.length,
        breaking: 0,
        manual: 0,
        auto_safe_packages: [`${pkg}@${versions[versions.length - 1]}`],
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: vulns,
      },
    },
    error: null,
  };
}

describe('runPipUpdater — dry-run validation (validatePipSpecs) via integration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('(T1) batch dry-run passes → all specs validated, install proceeds normally', async () => {
    const scan = scanWithVulns('djangorestframework', ['3.11.2', '3.14.0', '3.15.2']);

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())                      // pip-audit --version
      .mockResolvedValueOnce(ok())                                       // batch dry-run → pass
      .mockResolvedValueOnce(ok('Successfully installed djangorestframework-3.15.2')); // pip install

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    expect(result.status).toBe('success');
    // Verify batch dry-run was called with --dry-run flag
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const dryRunCall = calls.find((c) => c[0] === 'pip' && (c[1] as string[]).includes('--dry-run'));
    expect(dryRunCall).toBeDefined();
    expect(dryRunCall![1]).toContain('--dry-run');
    expect(dryRunCall![1]).toContain('--quiet');
  });

  it('(T2) batch dry-run fails, per-package: some pass, some fail → validated + skipped', async () => {
    // Two packages — requests passes, django fails all versions
    const vulns: VulnerabilityEntry[] = [
      makeVuln('requests', '2.28.0', 'auto_safe'),
      makeVuln('requests', '2.31.0', 'auto_safe'),
      makeVuln('django', '3.2.0', 'auto_safe'),
    ];
    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        pip: {
          vulnerabilities_total: 3,
          auto_safe: 3,
          breaking: 0,
          manual: 0,
          auto_safe_packages: ['requests@2.31.0', 'django@3.2.0'],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: vulns,
        },
      },
      error: null,
    };

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())     // pip-audit --version
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'conflict', command: '', dryRun: false }) // batch dry-run → fail
      .mockResolvedValueOnce(ok())                      // per-pkg dry-run: requests==2.31.0 → pass
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'incompatible', command: '', dryRun: false }) // per-pkg dry-run: django==3.2.0 → fail
      // django has only one version (3.2.0) and it was already tried, so tryFallbackVersions makes no calls
      .mockResolvedValueOnce(ok('Successfully installed requests-2.31.0')); // pip install (only requests)

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    expect(result.status).toBe('success');
    // Only requests was validated and installed
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && (c[1] as string[]).includes('install') && !(c[1] as string[]).includes('--dry-run'));
    expect(installCall).toBeDefined();
    expect(installCall![1]).toContain('requests==2.31.0');
    expect(installCall![1]).not.toContain('django==3.2.0');
  });

  it('(T3) batch dry-run fails, fallback version succeeds → lower version used for install', async () => {
    // djangorestframework==3.15.2 fails (Python 3.7 incompatible), 3.11.2 passes
    const vulns: VulnerabilityEntry[] = [
      makeVuln('djangorestframework', '3.11.2', 'auto_safe'),
      makeVuln('djangorestframework', '3.15.2', 'auto_safe'),
    ];
    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        pip: {
          vulnerabilities_total: 2,
          auto_safe: 2,
          breaking: 0,
          manual: 0,
          auto_safe_packages: ['djangorestframework@3.11.2'],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: vulns,
        },
      },
      error: null,
    };

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())     // pip-audit --version
      // maxSafeVersion is 3.15.2, so primarySpec is djangorestframework==3.15.2
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'requires Python>=3.8', command: '', dryRun: false }) // batch dry-run → fail
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'requires Python>=3.8', command: '', dryRun: false }) // per-pkg dry-run: 3.15.2 → fail
      .mockResolvedValueOnce(ok())                      // fallback dry-run: 3.11.2 → pass
      .mockResolvedValueOnce(ok('Successfully installed djangorestframework-3.11.2')); // pip install with 3.11.2

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    expect(result.status).toBe('success');

    // Verify the actual install used 3.11.2, not 3.15.2
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && (c[1] as string[]).includes('install') && !(c[1] as string[]).includes('--dry-run'));
    expect(installCall).toBeDefined();
    expect(installCall![1]).toContain('djangorestframework==3.11.2');
    expect(installCall![1]).not.toContain('djangorestframework==3.15.2');
  });

  it('(T4) old pip (--dry-run unsupported) → validation skipped, install proceeds with original specs', async () => {
    const scan = scanWithVulns('djangorestframework', ['3.11.2', '3.15.2']);

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())  // pip-audit --version
      .mockResolvedValueOnce({                       // batch dry-run → unsupported (stderr contains 'no such option')
        exitCode: 1,
        stdout: '',
        stderr: 'no such option: --dry-run',
        command: '',
        dryRun: false,
      })
      .mockResolvedValueOnce(ok('Successfully installed djangorestframework-3.15.2')); // pip install

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    expect(result.status).toBe('success');

    // Verify install was called with the primary spec (3.15.2 = maxSafeVersion)
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && (c[1] as string[]).includes('install') && !(c[1] as string[]).includes('--dry-run'));
    expect(installCall).toBeDefined();
    expect(installCall![1]).toContain('djangorestframework==3.15.2');
  });

  it('(T4b) old pip with "unrecognized arguments" → validation skipped, install proceeds', async () => {
    const scan = scanWithVulns('pillow', ['8.3.2', '9.5.0']);

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())
      .mockResolvedValueOnce({
        exitCode: 2,
        stdout: '',
        stderr: 'unrecognized arguments: --dry-run',
        command: '',
        dryRun: false,
      })
      .mockResolvedValueOnce(ok('Successfully installed pillow-9.5.0'));

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    expect(result.status).toBe('success');
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && (c[1] as string[]).includes('install') && !(c[1] as string[]).includes('--dry-run'));
    expect(installCall).toBeDefined();
    expect(installCall![1]).toContain('pillow==9.5.0');
  });

  it('(T5) all packages fail dry-run with no alternatives → returns error, no install attempted', async () => {
    const vulns: VulnerabilityEntry[] = [
      makeVuln('incompatiblepkg', '1.0.0', 'auto_safe'),
    ];
    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        pip: {
          vulnerabilities_total: 1,
          auto_safe: 1,
          breaking: 0,
          manual: 0,
          auto_safe_packages: ['incompatiblepkg@1.0.0'],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: vulns,
        },
      },
      error: null,
    };

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())   // pip-audit --version
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'incompatible', command: '', dryRun: false }) // batch dry-run → fail
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'incompatible', command: '', dryRun: false }) // per-pkg dry-run: 1.0.0 → fail
      // no fallback versions → skipped
      .mockResolvedValueOnce(ok()); // pip install -r requirements.txt (revert — called by lifecycle on error)

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    // All packages failed → error reported
    expect(result.status).toBe('error');
    expect(result.error).toContain('All package specs failed dry-run validation');

    // Verify pip install (non-dry-run, non-revert) was NOT called
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const realInstallCall = calls.find(
      (c) => c[0] === 'pip' && (c[1] as string[]).includes('install') && !(c[1] as string[]).includes('--dry-run') && !(c[1] as string[]).includes('-r'),
    );
    expect(realInstallCall).toBeUndefined();
  });

  it('(T6) dry-run passes for batch → install uses the exact specs that passed validation', async () => {
    const scan = scanWithVulns('requests', ['2.28.0', '2.31.0']);

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())  // pip-audit --version
      .mockResolvedValueOnce(ok())                   // batch dry-run → pass (requests==2.31.0)
      .mockResolvedValueOnce(ok('Successfully installed requests-2.31.0')); // pip install

    const runner = makeRunner({ runArgs: runArgsMock });

    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    expect(result.status).toBe('success');

    // Dry-run call must include specs
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const dryRunCall = calls.find((c) => c[0] === 'pip' && (c[1] as string[]).includes('--dry-run'));
    expect(dryRunCall).toBeDefined();
    expect(dryRunCall![1]).toContain('requests==2.31.0');

    // Install must use the same spec
    const installCall = calls.find((c) => c[0] === 'pip' && (c[1] as string[]).includes('install') && !(c[1] as string[]).includes('--dry-run'));
    expect(installCall).toBeDefined();
    expect(installCall![1]).toContain('requests==2.31.0');
  });

  it('(T7) re-batch of validated specs passes → no change from per-package result', async () => {
    // Two packages: batch dry-run fails, but both pass per-package, and re-batch also passes.
    // Result: both packages should be installed without cross-conflict exclusion.
    const vulns: VulnerabilityEntry[] = [
      makeVuln('requests', '2.28.0', 'auto_safe'),
      makeVuln('requests', '2.31.0', 'auto_safe'),
      makeVuln('pillow', '9.0.0', 'auto_safe'),
      makeVuln('pillow', '9.5.0', 'auto_safe'),
    ];
    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        pip: {
          vulnerabilities_total: 4,
          auto_safe: 4,
          breaking: 0,
          manual: 0,
          auto_safe_packages: ['requests@2.31.0', 'pillow@9.5.0'],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: vulns,
        },
      },
      error: null,
    };

    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())             // pip-audit --version
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'conflict', command: '', dryRun: false }) // batch dry-run → fail
      .mockResolvedValueOnce(ok())                              // per-pkg: requests==2.31.0 → pass
      .mockResolvedValueOnce(ok())                              // per-pkg: pillow==9.5.0 → pass
      .mockResolvedValueOnce(ok())                              // re-batch: [requests, pillow] → pass
      .mockResolvedValueOnce(ok('Successfully installed requests-2.31.0 pillow-9.5.0')); // pip install

    const runner = makeRunner({ runArgs: runArgsMock });
    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    expect(result.status).toBe('success');
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && (c[1] as string[]).includes('install') && !(c[1] as string[]).includes('--dry-run'));
    expect(installCall).toBeDefined();
    expect(installCall![1]).toContain('requests==2.31.0');
    expect(installCall![1]).toContain('pillow==9.5.0');
  });

  it('(T8) re-batch fails → greedy subset excludes conflicting package; logger.warn called', async () => {
    // Three packages: batch dry-run fails, all pass per-package, but re-batch also fails.
    // Greedy selection: requests + pillow are compatible, urllib3 conflicts.
    const vulns: VulnerabilityEntry[] = [
      makeVuln('requests', '2.28.0', 'auto_safe'),
      makeVuln('requests', '2.31.0', 'auto_safe'),
      makeVuln('pillow', '9.0.0', 'auto_safe'),
      makeVuln('pillow', '9.5.0', 'auto_safe'),
      makeVuln('urllib3', '1.26.0', 'auto_safe'),
      makeVuln('urllib3', '2.0.7', 'auto_safe'),
    ];
    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        pip: {
          vulnerabilities_total: 6,
          auto_safe: 6,
          breaking: 0,
          manual: 0,
          auto_safe_packages: ['requests@2.31.0', 'pillow@9.5.0', 'urllib3@2.0.7'],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: vulns,
        },
      },
      error: null,
    };

    // Mock sequence:
    // 1. pip-audit --version → unavailable
    // 2. batch dry-run [requests, pillow, urllib3] → fail
    // 3. per-pkg: requests==2.31.0 → pass
    // 4. per-pkg: pillow==9.5.0 → pass
    // 5. per-pkg: urllib3==2.0.7 → pass
    // 6. re-batch [requests, pillow, urllib3] → fail (cross-conflict)
    // 7. greedy: [requests] → pass (requests added to compatible)
    // 8. greedy: [requests, pillow] → pass (pillow added)
    // 9. greedy: [requests, pillow, urllib3] → fail (urllib3 excluded)
    // 10. pip install [requests, pillow] → success
    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())             // 1
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'conflict', command: '', dryRun: false }) // 2
      .mockResolvedValueOnce(ok())                              // 3
      .mockResolvedValueOnce(ok())                              // 4
      .mockResolvedValueOnce(ok())                              // 5
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'ResolutionImpossible', command: '', dryRun: false }) // 6
      .mockResolvedValueOnce(ok())                              // 7
      .mockResolvedValueOnce(ok())                              // 8
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'ResolutionImpossible', command: '', dryRun: false }) // 9
      .mockResolvedValueOnce(ok('Successfully installed requests-2.31.0 pillow-9.5.0')); // 10

    const runner = makeRunner({ runArgs: runArgsMock });
    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    expect(result.status).toBe('success');

    // urllib3 was excluded due to cross-conflict
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && (c[1] as string[]).includes('install') && !(c[1] as string[]).includes('--dry-run'));
    expect(installCall).toBeDefined();
    expect(installCall![1]).toContain('requests==2.31.0');
    expect(installCall![1]).toContain('pillow==9.5.0');
    expect(installCall![1]).not.toContain('urllib3==2.0.7');

    // logger.warn must have been called with cross-conflict message
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('Cross-package conflict detected'),
    );
  });

  it('(T9) greedy finds zero compatible → falls back to per-package validated list', async () => {
    // Two packages both pass per-package, re-batch fails, and greedy also finds no compatible set
    // (every single spec conflicts). The fallback returns the per-package validated list.
    const vulns: VulnerabilityEntry[] = [
      makeVuln('pkga', '1.0.0', 'auto_safe'),
      makeVuln('pkgb', '2.0.0', 'auto_safe'),
    ];
    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        pip: {
          vulnerabilities_total: 2,
          auto_safe: 2,
          breaking: 0,
          manual: 0,
          auto_safe_packages: ['pkga@1.0.0', 'pkgb@2.0.0'],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: vulns,
        },
      },
      error: null,
    };

    // Mock sequence:
    // 1. pip-audit --version → unavailable
    // 2. batch dry-run → fail
    // 3. per-pkg: pkga==1.0.0 → pass
    // 4. per-pkg: pkgb==2.0.0 → pass
    // 5. re-batch [pkga, pkgb] → fail
    // 6. greedy: [pkga] → fail (pkga alone fails)
    // 7. greedy: [pkgb] → fail (pkgb alone fails)
    //    compatible = [] → fallback: return both validated specs
    // 8. pip install [pkga, pkgb] → success (real install attempted with fallback)
    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())             // 1
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'conflict', command: '', dryRun: false }) // 2
      .mockResolvedValueOnce(ok())                              // 3
      .mockResolvedValueOnce(ok())                              // 4
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'ResolutionImpossible', command: '', dryRun: false }) // 5
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'ResolutionImpossible', command: '', dryRun: false }) // 6
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'ResolutionImpossible', command: '', dryRun: false }) // 7
      .mockResolvedValueOnce(ok('Successfully installed pkga-1.0.0 pkgb-2.0.0')); // 8

    const runner = makeRunner({ runArgs: runArgsMock });
    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    // Status could be success or error depending on install; the key assertion is
    // that both packages were passed to pip install (fallback used per-package validated list)
    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find((c) => c[0] === 'pip' && (c[1] as string[]).includes('install') && !(c[1] as string[]).includes('--dry-run'));
    expect(installCall).toBeDefined();
    expect(installCall![1]).toContain('pkga==1.0.0');
    expect(installCall![1]).toContain('pkgb==2.0.0');
    // No packages were added to skipped (fallback returns full validated list)
    // The install should succeed with the mocked ok() response
    expect(result.status).toBe('success');
  });
});

// ── buildMaxCvssMap unit tests ────────────────────────────────────────────────

function makeVulnWithCvss(
  pkg: string,
  cvss: string,
  classification: 'auto_safe' | 'breaking' | 'manual' = 'auto_safe',
): VulnerabilityEntry {
  return {
    ecosystem: 'pip',
    package: pkg,
    currentVersion: '1.0.0',
    safeVersion: '2.0.0',
    cvss,
    ghsaId: 'GHSA-test',
    risk: 'high',
    classification,
    reason: 'test',
  };
}

describe('buildMaxCvssMap — AC3', () => {
  const classifications = new Set<'auto_safe' | 'breaking' | 'manual'>(['auto_safe']);

  it('single vuln — returns its CVSS score for the package', () => {
    const vulns = [makeVulnWithCvss('requests', '7.5')];
    const map = buildMaxCvssMap(vulns, classifications);
    expect(map.get('requests')).toBe(7.5);
  });

  it('multiple vulns for the same package — returns max CVSS', () => {
    const vulns = [
      makeVulnWithCvss('requests', '5.0'),
      makeVulnWithCvss('requests', '9.8'),
      makeVulnWithCvss('requests', '7.5'),
    ];
    const map = buildMaxCvssMap(vulns, classifications);
    expect(map.get('requests')).toBe(9.8);
  });

  it('non-numeric CVSS (dash) is treated as 0', () => {
    const vulns = [makeVulnWithCvss('requests', '—')];
    const map = buildMaxCvssMap(vulns, classifications);
    expect(map.get('requests')).toBe(0);
  });

  it('empty string CVSS is treated as 0', () => {
    const vulns = [makeVulnWithCvss('pillow', '')];
    const map = buildMaxCvssMap(vulns, classifications);
    expect(map.get('pillow')).toBe(0);
  });

  it('empty vulnerabilities array returns empty map', () => {
    const map = buildMaxCvssMap([], classifications);
    expect(map.size).toBe(0);
  });

  it('filters out vulns not in classifications', () => {
    const vulns = [
      makeVulnWithCvss('requests', '9.8', 'breaking'),
      makeVulnWithCvss('pillow', '7.5', 'auto_safe'),
    ];
    const autoSafeOnly = new Set<'auto_safe' | 'breaking' | 'manual'>(['auto_safe']);
    const map = buildMaxCvssMap(vulns, autoSafeOnly);
    expect(map.has('requests')).toBe(false);
    expect(map.get('pillow')).toBe(7.5);
  });

  it('normalises package name to lowercase', () => {
    const vulns = [makeVulnWithCvss('Requests', '7.5')];
    const map = buildMaxCvssMap(vulns, classifications);
    expect(map.has('requests')).toBe(true);
    expect(map.has('Requests')).toBe(false);
  });

  it('multiple packages — each gets their own max score', () => {
    const vulns = [
      makeVulnWithCvss('requests', '5.0'),
      makeVulnWithCvss('pillow', '9.8'),
      makeVulnWithCvss('requests', '7.5'),
    ];
    const map = buildMaxCvssMap(vulns, classifications);
    expect(map.get('requests')).toBe(7.5);
    expect(map.get('pillow')).toBe(9.8);
  });
});

// ── sortSpecsByCvss unit tests ────────────────────────────────────────────────

describe('sortSpecsByCvss — AC4', () => {
  it('sorts specs descending by CVSS score', () => {
    const cvssMap = new Map([['requests', 9.8], ['pillow', 5.0], ['urllib3', 7.5]]);
    const sorted = sortSpecsByCvss(
      ['pillow==9.5.0', 'urllib3==2.0.7', 'requests==2.31.0'],
      cvssMap,
    );
    expect(sorted).toEqual(['requests==2.31.0', 'urllib3==2.0.7', 'pillow==9.5.0']);
  });

  it('packages not in map sort last (treated as CVSS 0)', () => {
    const cvssMap = new Map([['requests', 7.5]]);
    const sorted = sortSpecsByCvss(['unknown==1.0.0', 'requests==2.31.0'], cvssMap);
    expect(sorted[0]).toBe('requests==2.31.0');
    expect(sorted[1]).toBe('unknown==1.0.0');
  });

  it('returns a NEW array (does not mutate input)', () => {
    const cvssMap = new Map([['a', 9.0], ['b', 1.0]]);
    const original = ['b==1.0.0', 'a==2.0.0'];
    const sorted = sortSpecsByCvss(original, cvssMap);
    expect(original).toEqual(['b==1.0.0', 'a==2.0.0']); // unchanged
    expect(sorted).toEqual(['a==2.0.0', 'b==1.0.0']);
  });

  it('stable sort — equal CVSS keeps original relative order', () => {
    const cvssMap = new Map([['a', 7.5], ['b', 7.5], ['c', 9.8]]);
    const sorted = sortSpecsByCvss(['a==1.0.0', 'b==2.0.0', 'c==3.0.0'], cvssMap);
    expect(sorted[0]).toBe('c==3.0.0');
    // a and b have equal CVSS — a came before b, so a should still come before b
    expect(sorted[1]).toBe('a==1.0.0');
    expect(sorted[2]).toBe('b==2.0.0');
  });

  it('empty array returns empty array', () => {
    const sorted = sortSpecsByCvss([], new Map());
    expect(sorted).toEqual([]);
  });

  it('spec without == still works (uses full name for lookup)', () => {
    const cvssMap = new Map([['requests', 5.0], ['pillow', 9.0]]);
    const sorted = sortSpecsByCvss(['requests', 'pillow'], cvssMap);
    expect(sorted).toEqual(['pillow', 'requests']);
  });
});

// ── T10: CVSS-sorted greedy keeps higher-CVSS package on cross-conflict ───────

describe('(T10) CVSS-sorted greedy keeps higher-CVSS package when cross-conflict forces exclusion', () => {
  it('keeps the package with higher CVSS when two packages conflict', async () => {
    // pkgHigh has CVSS 9.8, pkgLow has CVSS 3.0.
    // Without CVSS sorting the order is pkgLow first, pkgHigh second.
    // After CVSS sorting the order is pkgHigh first, pkgLow second.
    // The greedy algorithm picks the first compatible spec; they conflict with each other,
    // so the second one gets excluded. With sorting, pkgHigh is kept.
    const vulns: VulnerabilityEntry[] = [
      { ...makeVulnWithCvss('pkghigh', '9.8'), safeVersion: '2.0.0' },
      { ...makeVulnWithCvss('pkglow', '3.0'), safeVersion: '1.5.0' },
    ];
    const scan: ScanResultJson = {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: 'local',
      ecosystems: {
        pip: {
          vulnerabilities_total: 2,
          auto_safe: 2,
          breaking: 0,
          manual: 0,
          // pkglow listed before pkghigh — without CVSS sort, pkglow would be tried first
          auto_safe_packages: ['pkglow@1.5.0', 'pkghigh@2.0.0'],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: vulns,
        },
      },
      error: null,
    };

    // Mock sequence:
    // 1. pip-audit --version → unavailable
    // 2. batch dry-run [pkghigh, pkglow] (after CVSS sort) → fail (conflict)
    // 3. per-pkg: pkghigh==2.0.0 → pass
    // 4. per-pkg: pkglow==1.5.0 → pass
    // 5. re-batch [pkghigh, pkglow] → fail (cross-conflict)
    // 6. greedy: [pkghigh] → pass (pkghigh added — it was sorted first by CVSS)
    // 7. greedy: [pkghigh, pkglow] → fail (pkglow excluded)
    // 8. pip install [pkghigh] → success
    const runArgsMock = vi.fn()
      .mockResolvedValueOnce(pipAuditUnavailable())          // 1
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'conflict', command: '', dryRun: false }) // 2
      .mockResolvedValueOnce(ok())                           // 3
      .mockResolvedValueOnce(ok())                           // 4
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'ResolutionImpossible', command: '', dryRun: false }) // 5
      .mockResolvedValueOnce(ok())                           // 6
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'ResolutionImpossible', command: '', dryRun: false }) // 7
      .mockResolvedValueOnce(ok('Successfully installed pkghigh-2.0.0')); // 8

    const runner = makeRunner({ runArgs: runArgsMock });
    const result = await runPipUpdater(runner, baseConfig(), scan, '/tmp/project', false, []);

    expect(result.status).toBe('success');

    const calls = runArgsMock.mock.calls as [string, string[], unknown][];
    const installCall = calls.find(
      (c) => c[0] === 'pip' && (c[1] as string[]).includes('install') && !(c[1] as string[]).includes('--dry-run'),
    );
    expect(installCall).toBeDefined();
    // Higher-CVSS package is kept
    expect(installCall![1]).toContain('pkghigh==2.0.0');
    // Lower-CVSS package is excluded due to conflict
    expect(installCall![1]).not.toContain('pkglow==1.5.0');
  });
});

// ── buildPipPackagesUpdated ──────────────────────────────────────────────────

describe('buildPipPackagesUpdated', () => {
  it('maps packages present in installedVersions to name@version', () => {
    const autoSafe = ['requests==2.31.0', 'pillow==9.5.0'];
    const installed = new Map([
      ['requests', '2.31.0'],
      ['pillow', '9.5.0'],
    ]);
    expect(buildPipPackagesUpdated(autoSafe, installed)).toEqual([
      'requests@2.31.0',
      'pillow@9.5.0',
    ]);
  });

  it('excludes packages not in installedVersions (greedy subset scenario)', () => {
    const autoSafe = ['requests==2.31.0', 'djangorestframework==3.14.0'];
    // djangorestframework was excluded by the greedy subset — not installed
    const installed = new Map([['requests', '2.31.0']]);
    const result = buildPipPackagesUpdated(autoSafe, installed);
    expect(result).toEqual(['requests@2.31.0']);
    expect(result).not.toContain('djangorestframework');
    expect(result).not.toContain('djangorestframework@3.14.0');
  });

  it('returns [] when installedVersions is empty', () => {
    const autoSafe = ['requests==2.31.0', 'pillow==9.5.0'];
    expect(buildPipPackagesUpdated(autoSafe, new Map())).toEqual([]);
  });

  it('handles mixed scenario: some packages installed, some excluded', () => {
    const autoSafe = ['requests==2.31.0', 'pillow==9.5.0', 'django==4.2.0'];
    // pillow and django were excluded by the greedy subset
    const installed = new Map([['requests', '2.31.0']]);
    const result = buildPipPackagesUpdated(autoSafe, installed);
    expect(result).toEqual(['requests@2.31.0']);
    expect(result).not.toContain('pillow');
    expect(result).not.toContain('django');
  });

  it('handles @ separator format in scan entries', () => {
    const autoSafe = ['requests@2.31.0', 'pillow@9.5.0'];
    const installed = new Map([
      ['requests', '2.31.0'],
      ['pillow', '9.5.0'],
    ]);
    expect(buildPipPackagesUpdated(autoSafe, installed)).toEqual([
      'requests@2.31.0',
      'pillow@9.5.0',
    ]);
  });

  it('uses the installed version from the map, not the version in the scan entry', () => {
    // The map version reflects what pip actually installed (may differ from scan entry)
    const autoSafe = ['requests==2.28.0'];
    const installed = new Map([['requests', '2.31.0']]);
    expect(buildPipPackagesUpdated(autoSafe, installed)).toEqual(['requests@2.31.0']);
  });

  it('handles package names with extras in scan entries', () => {
    const autoSafe = ['requests[security]==2.31.0'];
    const installed = new Map([['requests', '2.31.0']]);
    expect(buildPipPackagesUpdated(autoSafe, installed)).toEqual(['requests@2.31.0']);
  });

  it('returns [] when autoSafePackages is empty', () => {
    const installed = new Map([['requests', '2.31.0']]);
    expect(buildPipPackagesUpdated([], installed)).toEqual([]);
  });
});
