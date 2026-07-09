import { EventEmitter } from 'node:events';

import { describe, it, expect, vi } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@infra/ecosystem-runtime/child-process-tracker', () => ({
  trackKillable: vi.fn(),
}));

vi.mock('@infra/utils/docker-platform', () => ({
  needsHostGateway: () => false,
  resolvePlatform: (p: string | undefined) => p,
}));

vi.mock('@infra/utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

import { execa } from 'execa';

import { DockerSonarScannerRunner } from '@infra/provisioner/docker-sonar-scanner';

const mockExeca = vi.mocked(execa);

function makeRunner(): DockerSonarScannerRunner {
  return new DockerSonarScannerRunner({ projectDir: '/app', sonarHostUrl: 'http://localhost:9000' });
}

function makeFakeSubprocess(resolvedValue: { exitCode?: number; stdout?: string; stderr?: string }) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const subprocess = Promise.resolve(resolvedValue) as unknown as Promise<unknown> & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  subprocess.stdout = stdout;
  subprocess.stderr = stderr;
  return subprocess;
}

describe('DockerSonarScannerRunner.run() — onLine stream forwarding', () => {
  it('forwards complete lines from both stdout and stderr, suppressing blank lines', async () => {
    const subprocess = makeFakeSubprocess({ exitCode: 0, stdout: 'line one\n\nline two\n', stderr: 'err line\n' });
    mockExeca.mockReturnValue(subprocess as never);

    const runner = makeRunner();
    const lines: string[] = [];
    const resultPromise = runner.run(['-Dsonar.projectKey=test'], (line) => lines.push(line));

    subprocess.stdout.emit('data', Buffer.from('line one\n\nline two\n'));
    subprocess.stdout.emit('end');
    subprocess.stderr.emit('data', Buffer.from('err line\n'));
    subprocess.stderr.emit('end');

    await resultPromise;

    expect(lines).toEqual(['line one', 'line two', 'err line']);
  });

  it('flushes a trailing partial line (no terminating newline) on stream end', async () => {
    const subprocess = makeFakeSubprocess({ exitCode: 0, stdout: '', stderr: '' });
    mockExeca.mockReturnValue(subprocess as never);

    const runner = makeRunner();
    const lines: string[] = [];
    const resultPromise = runner.run([], (line) => lines.push(line));

    subprocess.stdout.emit('data', Buffer.from('partial without newline'));
    subprocess.stdout.emit('end');
    subprocess.stderr.emit('end');

    await resultPromise;

    expect(lines).toEqual(['partial without newline']);
  });

  it('does not forward anything to onLine when no callback is provided', async () => {
    const subprocess = makeFakeSubprocess({ exitCode: 0, stdout: 'ignored\n', stderr: '' });
    mockExeca.mockReturnValue(subprocess as never);

    const runner = makeRunner();
    const result = await runner.run([]);

    expect(result.exitCode).toBe(0);
  });
});

describe('DockerSonarScannerRunner.run() — result field defaults', () => {
  it('defaults exitCode to 0 when execa resolves without an exitCode field', async () => {
    mockExeca.mockReturnValue(makeFakeSubprocess({ stdout: 'ok', stderr: '' }) as never);
    const result = await makeRunner().run([]);
    expect(result.exitCode).toBe(0);
  });

  it('defaults stdout and stderr to empty strings when execa resolves without them', async () => {
    mockExeca.mockReturnValue(makeFakeSubprocess({ exitCode: 0 }) as never);
    const result = await makeRunner().run([]);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('uses the thrown error message for stderr when the rejection has no stderr field', async () => {
    mockExeca.mockRejectedValueOnce(Object.assign(new Error('spawn docker ENOENT'), {}));
    const result = await makeRunner().run([]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('spawn docker ENOENT');
  });

  it('falls back to String(err) for stderr when the rejection has neither stderr nor message', async () => {
    mockExeca.mockRejectedValueOnce({});
    const result = await makeRunner().run([]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('[object Object]');
  });
});
