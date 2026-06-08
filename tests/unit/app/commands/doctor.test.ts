/**
 * Tests for the doctor command.
 *
 * Covers:
 *   AC1 — command exists with --cwd and --config flags
 *   AC2 — checks run in order: Node.js, Docker, OSV Scanner, gh CLI, Config, SonarQube token
 *   AC3 — output format: pass=checkmark (green), fail=cross (red) + hint, warn=warning (yellow) + hint
 *   AC4 — exit code 0 when all required pass, 1 when any required fails
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock execa before importing anything that uses it
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock fs/promises for config check
vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
}));

import { access } from 'node:fs/promises';

import {
  checkNodeVersion,
  checkDocker,
  checkOsvScanner,
  checkGhCli,
  checkConfig,
  checkSonarToken,
  formatDoctorResults,
  runDoctorCommand,
  type DoctorCheck,
} from '@app/commands/doctor';
import { execa } from 'execa';

const mockExeca = vi.mocked(execa);
const mockAccess = vi.mocked(access);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeExecaResult(exitCode: number, stdout = '', stderr = '') {
  return { exitCode, stdout, stderr, all: stdout || stderr } as ReturnType<typeof execa>;
}

// ─── checkNodeVersion ─────────────────────────────────────────────────────────

describe('checkNodeVersion', () => {
  it('returns pass with the current Node.js version', () => {
    const result = checkNodeVersion();
    expect(result.status).toBe('pass');
    expect(result.required).toBe(true);
    expect(result.name).toBe('Node.js');
    expect(result.detail).toBe(`v${process.versions.node}`);
  });
});

// ─── checkDocker ─────────────────────────────────────────────────────────────

describe('checkDocker', () => {
  it('returns pass with version when docker info succeeds', async () => {
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, '27.3.1'));

    const result = await checkDocker();
    expect(result.status).toBe('pass');
    expect(result.required).toBe(true);
    expect(result.name).toBe('Docker');
    expect(result.detail).toBe('v27.3.1');
    expect(mockExeca).toHaveBeenCalledWith(
      'docker',
      ['info', '--format', '{{.ServerVersion}}'],
      expect.objectContaining({ reject: false }),
    );
  });

  it('returns pass without detail when docker info succeeds but output is empty', async () => {
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, ''));

    const result = await checkDocker();
    expect(result.status).toBe('pass');
    expect(result.detail).toBeUndefined();
  });

  it('returns fail with hint when docker info fails', async () => {
    mockExeca.mockResolvedValueOnce(makeExecaResult(1, '', 'Cannot connect to Docker daemon'));

    const result = await checkDocker();
    expect(result.status).toBe('fail');
    expect(result.required).toBe(true);
    expect(result.hint).toBeTruthy();
  });
});

// ─── checkOsvScanner ─────────────────────────────────────────────────────────

describe('checkOsvScanner', () => {
  it('returns pass with version line when osv-scanner is found', async () => {
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'osv-scanner version 1.9.0'));

    const result = await checkOsvScanner();
    expect(result.status).toBe('pass');
    expect(result.required).toBe(true);
    expect(result.name).toBe('OSV Scanner');
    expect(result.detail).toBe('osv-scanner version 1.9.0');
    expect(mockExeca).toHaveBeenCalledWith(
      'osv-scanner',
      ['--version'],
      expect.objectContaining({ reject: false }),
    );
  });

  it('returns fail with hint when osv-scanner is not found', async () => {
    mockExeca.mockResolvedValueOnce(makeExecaResult(127, '', 'command not found'));

    const result = await checkOsvScanner();
    expect(result.status).toBe('fail');
    expect(result.hint).toMatch(/osv-scanner/i);
  });
});

// ─── checkGhCli ──────────────────────────────────────────────────────────────

describe('checkGhCli', () => {
  it('returns pass with first version line when gh is found', async () => {
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'gh version 2.52.0 (2024-06-03)\nhttps://github.com/cli/cli/releases/tag/v2.52.0'));

    const result = await checkGhCli();
    expect(result.status).toBe('pass');
    expect(result.required).toBe(false);
    expect(result.name).toBe('gh CLI');
    expect(result.detail).toBe('gh version 2.52.0 (2024-06-03)');
  });

  it('returns warn (not fail) when gh CLI is not found', async () => {
    mockExeca.mockResolvedValueOnce(makeExecaResult(127, '', 'command not found'));

    const result = await checkGhCli();
    expect(result.status).toBe('warn');
    expect(result.required).toBe(false);
    expect(result.hint).toMatch(/gh/i);
  });
});

// ─── checkConfig ─────────────────────────────────────────────────────────────

describe('checkConfig', () => {
  it('returns pass with absolute path when config file exists', async () => {
    mockAccess.mockResolvedValueOnce(undefined);

    const result = await checkConfig('/project', 'security-scan.config.json');
    expect(result.status).toBe('pass');
    expect(result.required).toBe(true);
    expect(result.name).toBe('Config file');
    expect(result.detail).toContain('security-scan.config.json');
  });

  it('returns fail with hint when config file does not exist', async () => {
    mockAccess.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await checkConfig('/project', 'security-scan.config.json');
    expect(result.status).toBe('fail');
    expect(result.hint).toMatch(/init/);
  });
});

// ─── checkSonarToken ─────────────────────────────────────────────────────────

describe('checkSonarToken', () => {
  it('returns pass when SONAR_TOKEN is set', () => {
    const original = process.env.SONAR_TOKEN;
    process.env.SONAR_TOKEN = 'my-secret-token';

    const result = checkSonarToken();
    expect(result.status).toBe('pass');
    expect(result.required).toBe(false);
    expect(result.name).toBe('SonarQube token');
    expect(result.detail).toBe('(set)');

    process.env.SONAR_TOKEN = original;
  });

  it('returns warn when SONAR_TOKEN is not set', () => {
    const original = process.env.SONAR_TOKEN;
    delete process.env.SONAR_TOKEN;

    const result = checkSonarToken();
    expect(result.status).toBe('warn');
    expect(result.required).toBe(false);
    expect(result.hint).toMatch(/SONAR_TOKEN/);

    process.env.SONAR_TOKEN = original;
  });
});

// ─── formatDoctorResults ──────────────────────────────────────────────────────

describe('formatDoctorResults', () => {
  const passCheck: DoctorCheck = {
    name: 'Node.js',
    required: true,
    status: 'pass',
    detail: 'v26.0.0',
  };
  const failCheck: DoctorCheck = {
    name: 'Docker',
    required: true,
    status: 'fail',
    hint: 'Start the Docker daemon and try again.',
  };
  const warnCheck: DoctorCheck = {
    name: 'gh CLI',
    required: false,
    status: 'warn',
    hint: 'Install gh CLI to enable --open-pr: https://cli.github.com/',
  };

  it('includes checkmark icon for passing checks', () => {
    const output = formatDoctorResults([passCheck]);
    expect(output).toContain('✔');
    expect(output).toContain('Node.js');
  });

  it('includes cross icon and hint for failing required checks', () => {
    const output = formatDoctorResults([failCheck]);
    expect(output).toContain('✘');
    expect(output).toContain('Docker');
    expect(output).toContain('Start the Docker daemon');
  });

  it('includes warning icon and hint for optional warning checks', () => {
    const output = formatDoctorResults([warnCheck]);
    expect(output).toContain('⚠');
    expect(output).toContain('gh CLI');
  });

  it('shows correct summary when all required checks pass', () => {
    const output = formatDoctorResults([passCheck]);
    expect(output).toContain('1/1');
  });

  it('shows correct summary with partial failures', () => {
    const output = formatDoctorResults([passCheck, failCheck]);
    expect(output).toContain('1/2');
  });

  it('shows warning count in summary when optional checks warn', () => {
    const output = formatDoctorResults([passCheck, warnCheck]);
    expect(output).toContain('1');
    // Should mention optional warnings
    expect(output).toMatch(/optional/i);
  });

  it('does not show warning summary when no optional warnings', () => {
    const optionalPass: DoctorCheck = {
      name: 'gh CLI',
      required: false,
      status: 'pass',
      detail: 'gh version 2.52.0',
    };
    const output = formatDoctorResults([passCheck, optionalPass]);
    expect(output).not.toMatch(/optional/i);
  });

  it('includes indented hint line for fail status', () => {
    const output = formatDoctorResults([failCheck]);
    expect(output).toMatch(/Hint.*Start the Docker/s);
  });

  it('includes indented hint line for warn status', () => {
    const output = formatDoctorResults([warnCheck]);
    expect(output).toMatch(/Hint.*Install gh/s);
  });

  it('shows pass detail in dim style after the check name', () => {
    const output = formatDoctorResults([passCheck]);
    expect(output).toContain('v26.0.0');
  });
});

// ─── runDoctorCommand ─────────────────────────────────────────────────────────

describe('runDoctorCommand', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('returns exit code 0 when all required checks pass', async () => {
    // Docker pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, '27.3.1'));
    // OSV Scanner pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'osv-scanner version 1.9.0'));
    // gh CLI pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'gh version 2.52.0'));
    // Config exists
    mockAccess.mockResolvedValueOnce(undefined);
    // SONAR_TOKEN set
    process.env.SONAR_TOKEN = 'test-token';

    const exitCode = await runDoctorCommand({ cwd: '/project', config: 'security-scan.config.json' });

    expect(exitCode).toBe(0);
    expect(writeSpy).toHaveBeenCalled();

    delete process.env.SONAR_TOKEN;
  });

  it('returns exit code 1 when a required check fails', async () => {
    // Docker fail
    mockExeca.mockResolvedValueOnce(makeExecaResult(1, '', 'Cannot connect'));
    // OSV Scanner pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'osv-scanner version 1.9.0'));
    // gh CLI pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'gh version 2.52.0'));
    // Config exists
    mockAccess.mockResolvedValueOnce(undefined);

    const exitCode = await runDoctorCommand({ cwd: '/project', config: 'security-scan.config.json' });

    expect(exitCode).toBe(1);
  });

  it('returns exit code 0 even when optional checks warn', async () => {
    // Docker pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, '27.3.1'));
    // OSV Scanner pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'osv-scanner version 1.9.0'));
    // gh CLI warn (not found)
    mockExeca.mockResolvedValueOnce(makeExecaResult(127, '', 'not found'));
    // Config exists
    mockAccess.mockResolvedValueOnce(undefined);
    // SONAR_TOKEN not set
    delete process.env.SONAR_TOKEN;

    const exitCode = await runDoctorCommand({ cwd: '/project', config: 'security-scan.config.json' });

    expect(exitCode).toBe(0);
  });

  it('returns exit code 1 when config file is missing (required)', async () => {
    // Docker pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, '27.3.1'));
    // OSV Scanner pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'osv-scanner version 1.9.0'));
    // gh CLI pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'gh version 2.52.0'));
    // Config missing
    mockAccess.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const exitCode = await runDoctorCommand({ cwd: '/project', config: 'security-scan.config.json' });

    expect(exitCode).toBe(1);
  });

  it('writes formatted output to stdout', async () => {
    // Docker pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, '27.3.1'));
    // OSV Scanner pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'osv-scanner version 1.9.0'));
    // gh CLI pass
    mockExeca.mockResolvedValueOnce(makeExecaResult(0, 'gh version 2.52.0'));
    // Config exists
    mockAccess.mockResolvedValueOnce(undefined);

    await runDoctorCommand({ cwd: '/project', config: 'security-scan.config.json' });

    const written = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('Node.js');
    expect(written).toContain('Docker');
    expect(written).toContain('OSV Scanner');
    expect(written).toContain('gh CLI');
  });
});
