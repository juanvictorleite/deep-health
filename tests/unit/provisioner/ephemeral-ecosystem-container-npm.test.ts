import { EventEmitter } from 'node:events';

import { EphemeralEcosystemContainer } from '@infra/ecosystem-runtime/ephemeral-container';
import { NPM_DEFAULT_IMAGE } from '@infra/provisioner/image-resolvers';
import { setLogLevel } from '@infra/utils/logger';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';


vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('@infra/utils/docker-platform', () => ({
  needsHostGateway: vi.fn().mockReturnValue(false),
  resolvePlatform: vi.fn().mockReturnValue(undefined),
}));

import { spawn } from 'node:child_process';

const mockSpawn = vi.mocked(spawn);

function makeMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function makeNpmContainer(projectDir = '/tmp/project') {
  return new EphemeralEcosystemContainer({
    runMode: { kind: 'direct-exec', binary: 'npm' },
    projectDir,
    image: NPM_DEFAULT_IMAGE,
    logPrefix: 'npm',
  });
}

describe('EphemeralEcosystemContainer runStreaming (npm mode)', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setLogLevel('info');
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    setLogLevel('error');
  });

  it('streams stdout/stderr as info logs and returns captured output', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as never);

    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('installing dependencies\nstep 2\n'));
      child.stderr.emit('data', Buffer.from('npm WARN deprecated x\n'));
      child.emit('close', 3);
    });

    const runner = makeNpmContainer();
    const result = await runner.runStreaming(['ci']);

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain('installing dependencies');
    expect(result.stderr).toContain('npm WARN deprecated x');

    const writes = stderrSpy.mock.calls.map((c) => String(c[0]).replace(/\x1B\[[0-9;]*m/g, ''));
    expect(writes.some((line) => line.includes('[npm] installing dependencies'))).toBe(true);
    expect(writes.some((line) => line.includes('[npm] npm WARN deprecated x'))).toBe(true);
  });

  it('returns spawn error diagnostics when docker process fails to start', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as never);

    queueMicrotask(() => {
      child.emit('error', new Error('spawn docker ENOENT'));
    });

    const runner = makeNpmContainer();
    const result = await runner.runStreaming(['install']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('spawn docker ENOENT');
  });
});

import { execFile } from 'node:child_process';
const mockExecFile = vi.mocked(execFile);

describe('EphemeralEcosystemContainer.run() (npm mode)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns exitCode 0 with stdout/stderr on success', async () => {
    (mockExecFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_file: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) => {
        cb(null, 'ok', '');
      },
    );
    const runner = makeNpmContainer('/project');
    const result = await runner.run(['install']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
  });

  it('returns non-zero exitCode and stderr when docker exits with error', async () => {
    const err = Object.assign(new Error('docker failed'), { code: 2, stdout: '', stderr: 'permission denied' });
    let callCount = 0;
    (mockExecFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_file: string, _args: string[], cb: Function) => {
        callCount++;
        if (callCount === 1) {
          // First call is _ensureImagePresent's docker image inspect — succeed so no pull is attempted
          cb(null, '[]', '');
        } else {
          cb(err);
        }
      },
    );
    const runner = makeNpmContainer('/project');
    const result = await runner.run(['install']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('permission denied');
  });
});
