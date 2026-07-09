import { PassThrough } from 'node:stream';

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));


import { EnvironmentError } from '@core/errors';
import { LocalExecutor } from '@infra/executor/local-executor';
import { execa } from 'execa';

const mockExeca = vi.mocked(execa);

/**
 * Builds a fake execa subprocess: a Promise (resolving with `result`) that
 * also exposes `.stdout`/`.stderr` PassThrough streams, matching execa's
 * real shape (an awaitable that is also a StreamablePipes). The promise only
 * resolves once both streams have ended, mirroring how a real child process
 * only exits after its stdio streams close — this removes any race between
 * stream data delivery and the awaited resolution in the test.
 */
function createStreamableSubprocess(result: Record<string, unknown>) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutEnded = false;
  let stderrEnded = false;
  const promise = new Promise((resolve) => {
    const tryResolve = () => {
      if (stdoutEnded && stderrEnded) resolve(result);
    };
    stdout.on('end', () => {
      stdoutEnded = true;
      tryResolve();
    });
    stderr.on('end', () => {
      stderrEnded = true;
      tryResolve();
    });
  }) as Promise<unknown> & { stdout: PassThrough; stderr: PassThrough };
  promise.stdout = stdout;
  promise.stderr = stderr;
  return promise;
}

describe('LocalExecutor.run()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns dry-run result when dryRun=true', async () => {
    const executor = new LocalExecutor({ dryRun: true });
    const result = await executor.run('npm install');
    expect(result.dryRun).toBe(true);
    expect(result.stdout).toBe('');
    expect(execa).not.toHaveBeenCalled();
  });

  it('returns success result when command succeeds', async () => {
    mockExeca.mockResolvedValue({ stdout: 'output', stderr: '', exitCode: 0 } as any);
    const executor = new LocalExecutor();
    const result = await executor.run('echo hello');
    expect(result.stdout).toBe('output');
    expect(result.exitCode).toBe(0);
    expect(result.dryRun).toBe(false);
  });

  it('uses stream stdio when options.stream=true', async () => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    const executor = new LocalExecutor();
    await executor.run('npm install', { stream: true });
    expect(mockExeca).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      stdout: expect.any(Array),
    }));
  });

  it('passes env options when provided', async () => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    const executor = new LocalExecutor();
    await executor.run('cmd', { env: { FOO: 'bar' } });
    expect(mockExeca).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      env: expect.objectContaining({ FOO: 'bar' }),
    }));
  });

  it('throws EnvironmentError when ENOENT error occurs (direct code)', async () => {
    const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    mockExeca.mockRejectedValue(err);
    const executor = new LocalExecutor();
    await expect(executor.run('nonexistent-cmd')).rejects.toBeInstanceOf(EnvironmentError);
  });

  it('throws EnvironmentError when ENOENT is on err.cause', async () => {
    const cause = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const err = new Error('spawn failed');
    (err as any).cause = cause;
    mockExeca.mockRejectedValue(err);
    const executor = new LocalExecutor();
    await expect(executor.run('nonexistent-cmd')).rejects.toBeInstanceOf(EnvironmentError);
  });

  it('returns error result for non-ENOENT error', async () => {
    mockExeca.mockRejectedValue(new Error('permission denied'));
    const executor = new LocalExecutor();
    const result = await executor.run('restricted-cmd');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('permission denied');
  });

  it('returns error result for non-Error thrown value', async () => {
    mockExeca.mockRejectedValue('string error');
    const executor = new LocalExecutor();
    const result = await executor.run('cmd');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('string error');
  });

  it('falls back to empty strings and exitCode=1 when execa result fields are undefined', async () => {
    mockExeca.mockResolvedValue({} as any);
    const executor = new LocalExecutor();
    const result = await executor.run('cmd');
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(1);
  });
});

describe('LocalExecutor.runArgs()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns dry-run result when dryRun=true', async () => {
    const executor = new LocalExecutor({ dryRun: true });
    const result = await executor.runArgs('npm', ['install']);
    expect(result.dryRun).toBe(true);
    expect(execa).not.toHaveBeenCalled();
  });

  it('returns success result when command succeeds', async () => {
    mockExeca.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 } as any);
    const executor = new LocalExecutor();
    const result = await executor.runArgs('npm', ['install']);
    expect(result.stdout).toBe('ok');
    expect(result.exitCode).toBe(0);
  });

  it('throws EnvironmentError for ENOENT in runArgs', async () => {
    const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    mockExeca.mockRejectedValue(err);
    const executor = new LocalExecutor();
    await expect(executor.runArgs('nonexistent', ['arg'])).rejects.toBeInstanceOf(EnvironmentError);
  });

  it('throws EnvironmentError when ENOENT on cause in runArgs', async () => {
    const cause = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const err = new Error('spawn failed');
    (err as any).cause = cause;
    mockExeca.mockRejectedValue(err);
    const executor = new LocalExecutor();
    await expect(executor.runArgs('nonexistent', ['arg'])).rejects.toBeInstanceOf(EnvironmentError);
  });

  it('returns error result for non-ENOENT error in runArgs', async () => {
    mockExeca.mockRejectedValue(new Error('access denied'));
    const executor = new LocalExecutor();
    const result = await executor.runArgs('cmd', ['arg']);
    expect(result.exitCode).toBe(1);
  });

  it('falls back to empty strings and exitCode=1 when runArgs execa result fields are undefined', async () => {
    mockExeca.mockResolvedValue({} as any);
    const executor = new LocalExecutor();
    const result = await executor.runArgs('npm', ['install']);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(1);
  });

  it('uses String(err) when runArgs catches a non-Error value', async () => {
    mockExeca.mockRejectedValue('runArgs string error');
    const executor = new LocalExecutor();
    const result = await executor.runArgs('cmd', ['arg']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('runArgs string error');
  });

  it('uses process.env when options.env is absent', async () => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    const executor = new LocalExecutor();
    const result = await executor.runArgs('npm', ['install'], {});
    expect(result.exitCode).toBe(0);
  });

  it('returns dryRun result with the joined command and never spawns execa', async () => {
    const executor = new LocalExecutor({ dryRun: true });
    const result = await executor.runArgs('npm', ['install', '--save-dev']);
    expect(result).toMatchObject({
      dryRun: true,
      command: 'npm install --save-dev',
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
    expect(execa).not.toHaveBeenCalled();
  });
});

describe('LocalExecutor stdio resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves stdio to pipe+inherit when stream=true and no onLine callback is given', async () => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    const executor = new LocalExecutor();
    await executor.run('npm install', { stream: true });
    expect(mockExeca).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ stdout: ['pipe', 'inherit'], stderr: ['pipe', 'inherit'] }),
    );
  });

  it('resolves stdio to plain pipe when stream=true but an onLine callback is given', async () => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    const executor = new LocalExecutor();
    await executor.run('npm install', { stream: true, onLine: () => {} });
    expect(mockExeca).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ stdout: 'pipe', stderr: 'pipe' }),
    );
  });

  it('resolves stdio to plain pipe when stream is not set', async () => {
    mockExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    const executor = new LocalExecutor();
    await executor.run('npm install');
    expect(mockExeca).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ stdout: 'pipe', stderr: 'pipe' }),
    );
  });
});

describe('LocalExecutor.run() onLine streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards complete lines to onLine as chunks arrive, even when a chunk splits a line mid-way', async () => {
    const subprocess = createStreamableSubprocess({ stdout: '', stderr: '', exitCode: 0 });
    mockExeca.mockReturnValue(subprocess as any);
    const lines: string[] = [];
    const executor = new LocalExecutor();

    const runPromise = executor.run('tail -f build.log', { onLine: (line) => lines.push(line) });
    subprocess.stdout.write('line1\nli');
    subprocess.stdout.write('ne2\n');
    subprocess.stdout.end();
    subprocess.stderr.end();
    await runPromise;

    expect(lines).toEqual(['line1', 'line2']);
  });

  it('flushes a trailing unterminated buffer to onLine when the stream ends', async () => {
    const subprocess = createStreamableSubprocess({ stdout: '', stderr: '', exitCode: 0 });
    mockExeca.mockReturnValue(subprocess as any);
    const lines: string[] = [];
    const executor = new LocalExecutor();

    const runPromise = executor.run('tail -f build.log', { onLine: (line) => lines.push(line) });
    subprocess.stdout.write('complete\nincomplete tail');
    subprocess.stdout.end();
    subprocess.stderr.end();
    await runPromise;

    expect(lines).toEqual(['complete', 'incomplete tail']);
  });

  it('forwards stderr lines to onLine alongside stdout lines', async () => {
    const subprocess = createStreamableSubprocess({ stdout: '', stderr: '', exitCode: 0 });
    mockExeca.mockReturnValue(subprocess as any);
    const lines: string[] = [];
    const executor = new LocalExecutor();

    const runPromise = executor.run('build', { onLine: (line) => lines.push(line) });
    subprocess.stdout.write('stdout line\n');
    subprocess.stderr.write('stderr line\n');
    subprocess.stdout.end();
    subprocess.stderr.end();
    await runPromise;

    expect(lines.sort()).toEqual(['stderr line', 'stdout line']);
  });

  it('does not call onLine for blank lines', async () => {
    const subprocess = createStreamableSubprocess({ stdout: '', stderr: '', exitCode: 0 });
    mockExeca.mockReturnValue(subprocess as any);
    const lines: string[] = [];
    const executor = new LocalExecutor();

    const runPromise = executor.run('build', { onLine: (line) => lines.push(line) });
    subprocess.stdout.write('real line\n\n   \n');
    subprocess.stdout.end();
    subprocess.stderr.end();
    await runPromise;

    expect(lines).toEqual(['real line']);
  });
});
