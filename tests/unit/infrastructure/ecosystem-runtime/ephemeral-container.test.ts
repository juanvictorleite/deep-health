/**
 * Tests for EphemeralEcosystemContainer — specifically entrypointOverride injection
 * into `docker run` args, and general _buildDockerArgs correctness for both RunModes.
 *
 * Covers the regression case: --entrypoint "" must be injected when entrypointOverride=""
 * (for project-built images) so the image ENTRYPOINT cannot shadow the ecosystem CLI.
 *
 * Also covers the pull timeout path in _ensureImagePresent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@infra/utils/docker-platform', () => ({
  needsHostGateway: () => false,
  resolvePlatform: (p: string | undefined) => p,
}));

vi.mock('@infra/utils/retry', () => ({
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  isDockerTransientError: () => false,
}));

vi.mock('@infra/ecosystem-runtime/child-process-tracker', () => ({
  trackChildProcess: vi.fn(),
  trackKillable: vi.fn(),
  execFileTracked: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(), spawn: vi.fn() };
});

import { CLI_NAME } from '@infra/brand';
import { execFileTracked } from '@infra/ecosystem-runtime/child-process-tracker';
import { EphemeralEcosystemContainer } from '@infra/ecosystem-runtime/ephemeral-container';
import type { RunMode } from '@infra/ecosystem-runtime/types';
import { withRetry } from '@infra/utils/retry';

import { execFile } from 'node:child_process';

const mockExecFileTracked = vi.mocked(execFileTracked);
const mockWithRetry = vi.mocked(withRetry);
const mockExecFile = vi.mocked(execFile);

function makeContainer(opts: {
  runMode?: RunMode;
  image?: string;
  entrypointOverride?: string;
}) {
  return new EphemeralEcosystemContainer({
    runMode: opts.runMode ?? { kind: 'direct-exec', binary: 'npm' },
    projectDir: '/project',
    image: opts.image ?? 'node:20',
    logPrefix: 'npm',
    entrypointOverride: opts.entrypointOverride,
  });
}

describe('EphemeralEcosystemContainer — _buildDockerArgs', () => {
  // ─── entrypointOverride propagation ────────────────────────────────────────

  it('injects --entrypoint "" into docker run args when entrypointOverride is set to ""', () => {
    const container = makeContainer({ entrypointOverride: '' });
    const args = container._buildDockerArgs(['install']);

    const entrypointIdx = args.indexOf('--entrypoint');
    expect(entrypointIdx).toBeGreaterThan(-1);
    expect(args[entrypointIdx + 1]).toBe('');
  });

  it('does NOT inject --entrypoint when entrypointOverride is undefined', () => {
    const container = makeContainer({ entrypointOverride: undefined });
    const args = container._buildDockerArgs(['install']);
    expect(args).not.toContain('--entrypoint');
  });

  it('injects --entrypoint with a custom value when entrypointOverride is a non-empty string', () => {
    const container = makeContainer({ entrypointOverride: '/custom/entrypoint' });
    const args = container._buildDockerArgs(['run']);
    const idx = args.indexOf('--entrypoint');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/custom/entrypoint');
  });

  // ─── --entrypoint appears BEFORE the image name ───────────────────────────

  it('places --entrypoint before the image name in the arg list', () => {
    const container = makeContainer({ image: `${CLI_NAME}-project/npm:abc123`, entrypointOverride: '' });
    const args = container._buildDockerArgs(['ci']);

    const entrypointIdx = args.indexOf('--entrypoint');
    const imageIdx = args.indexOf(`${CLI_NAME}-project/npm:abc123`);
    expect(entrypointIdx).toBeGreaterThan(-1);
    expect(imageIdx).toBeGreaterThan(-1);
    expect(entrypointIdx).toBeLessThan(imageIdx);
  });

  // ─── direct-exec without preamble ─────────────────────────────────────────

  it('produces correct args for direct-exec without preamble', () => {
    const container = makeContainer({
      runMode: { kind: 'direct-exec', binary: 'npm' },
      image: 'node:20',
    });
    const args = container._buildDockerArgs(['install', '--frozen-lockfile']);

    expect(args[0]).toBe('run');
    expect(args[1]).toBe('--rm');
    expect(args).toContain('node:20');
    expect(args).toContain('npm');
    expect(args).toContain('install');
    expect(args).toContain('--frozen-lockfile');
  });

  // ─── direct-exec with preamble ────────────────────────────────────────────

  it('wraps argv in sh -lc with preamble for direct-exec with preamble', () => {
    const container = makeContainer({
      runMode: {
        kind: 'direct-exec',
        binary: 'npm',
        preamble: () => 'apt-get install -y libvips',
      },
      image: 'node:20',
    });
    const args = container._buildDockerArgs(['install']);

    expect(args).toContain('sh');
    expect(args).toContain('-lc');
    const shCmd = args[args.indexOf('-lc') + 1];
    expect(shCmd).toContain('apt-get install -y libvips');
    expect(shCmd).toContain('exec "$@"');
  });

  // ─── shell-wrap without preamble ──────────────────────────────────────────

  it('joins tokens in sh -lc for shell-wrap without preamble', () => {
    const container = makeContainer({
      runMode: { kind: 'shell-wrap' },
      image: 'composer:2',
    });
    const args = container._buildDockerArgs(['install', '--no-interaction']);

    expect(args).toContain('sh');
    expect(args).toContain('-lc');
    const shCmd = args[args.indexOf('-lc') + 1];
    expect(shCmd).toBe('install --no-interaction');
  });

  // ─── shell-wrap with preamble ─────────────────────────────────────────────

  it('prepends preamble before joined tokens in shell-wrap with preamble', () => {
    const container = makeContainer({
      runMode: {
        kind: 'shell-wrap',
        preamble: () => 'curl -sS https://getcomposer.org/installer | php',
      },
      image: 'php:8.2-cli',
    });
    const args = container._buildDockerArgs(['install']);

    const shCmd = args[args.indexOf('-lc') + 1];
    expect(shCmd).toContain('curl -sS https://getcomposer.org/installer | php');
    expect(shCmd).toContain('install');
  });

  // ─── Security: --cap-drop=ALL and --security-opt ──────────────────────────

  it('always includes --cap-drop=ALL and --security-opt no-new-privileges', () => {
    const container = makeContainer({});
    const args = container._buildDockerArgs(['install']);
    expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('--security-opt');
    expect(args).toContain('no-new-privileges');
  });

  // ─── Volume mount ─────────────────────────────────────────────────────────

  it('mounts projectDir at /project with --workdir /project', () => {
    const container = makeContainer({});
    const args = container._buildDockerArgs(['install']);
    expect(args).toContain('--volume');
    const volIdx = args.indexOf('--volume');
    expect(args[volIdx + 1]).toContain('/project:/project');
    expect(args).toContain('--workdir');
    expect(args[args.indexOf('--workdir') + 1]).toBe('/project');
  });

  // ─── readonly mount ─────────────────────────────────────────────────────────

  it('mounts the project directory read-only (":ro") when readonly is set', () => {
    const container = new EphemeralEcosystemContainer({
      runMode: { kind: 'direct-exec', binary: 'osv-scanner' },
      projectDir: '/project',
      image: 'osv-scanner:latest',
      logPrefix: 'osv',
      readonly: true,
    });
    const args = container._buildDockerArgs(['scan']);
    const volIdx = args.indexOf('--volume');
    expect(args[volIdx + 1]).toBe('/project:/project:ro');
  });
});

describe('EphemeralEcosystemContainer — run() and runShell()', () => {
  function makeRunner() {
    return new EphemeralEcosystemContainer({
      runMode: { kind: 'direct-exec', binary: 'npm' },
      projectDir: '/project',
      image: 'node:20',
      logPrefix: 'npm',
    });
  }

  beforeEach(() => {
    // _ensureImagePresent: docker image inspect always succeeds (image cached, no pull).
    mockExecFile.mockImplementation((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, stdout?: string, stderr?: string) => void;
      cb(null, '[]', '');
      return {} as never;
    });
  });

  afterEach(() => {
    mockExecFileTracked.mockReset();
  });

  describe('run() — inner catch fallback defaults', () => {
    it('uses the rejection message for stderr when code and stderr are absent', async () => {
      mockExecFileTracked.mockRejectedValueOnce({ message: 'connection reset' });
      const result = await makeRunner().run(['install']);
      expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'connection reset' });
    });

    it('falls back to a generated message when the rejection carries no code, stdout, stderr, or message', async () => {
      mockExecFileTracked.mockRejectedValueOnce('');
      const result = await makeRunner().run(['install']);
      expect(result).toEqual({ exitCode: 1, stdout: '', stderr: '' });
    });
  });

  describe('run() — outer catch fallback defaults (malformed withRetry rejection)', () => {
    it('maps a bare rejection with no fields to safe ContainerRunResult defaults', async () => {
      mockWithRetry.mockRejectedValueOnce({});
      const result = await makeRunner().run(['install']);
      expect(result).toEqual({ exitCode: 1, stdout: '', stderr: '[object Object]' });
    });

    it('uses the message field when the rejection carries no exitCode/stdout/stderr', async () => {
      mockWithRetry.mockRejectedValueOnce({ message: 'retry pool exhausted' });
      const result = await makeRunner().run(['install']);
      expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'retry pool exhausted' });
    });
  });

  describe('runShell()', () => {
    it('returns exitCode 0 with stdout/stderr on success', async () => {
      mockExecFileTracked.mockResolvedValueOnce({ stdout: 'shell output', stderr: '' });
      const result = await makeRunner().runShell('echo hi');
      expect(result).toEqual({ exitCode: 0, stdout: 'shell output', stderr: '' });
    });

    it('mounts the provided cwd instead of projectDir', async () => {
      mockExecFileTracked.mockResolvedValueOnce({ stdout: '', stderr: '' });
      await makeRunner().runShell('pwd', { cwd: '/custom/dir' });
      const dockerArgs = mockExecFileTracked.mock.calls[0]![1] as string[];
      expect(dockerArgs.join(' ')).toContain('/custom/dir:/project');
    });

    it('maps a retry-exhausted failure with fully-populated fields to ContainerRunResult', async () => {
      mockExecFileTracked.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 3, stdout: 'partial', stderr: 'oops' }));
      const result = await makeRunner().runShell('false');
      expect(result).toEqual({ exitCode: 3, stdout: 'partial', stderr: 'oops' });
    });

    it('falls back to exitCode 1 and empty fields when the rejection carries no code/stdout/stderr/message', async () => {
      mockExecFileTracked.mockRejectedValueOnce('');
      const result = await makeRunner().runShell('false');
      expect(result).toEqual({ exitCode: 1, stdout: '', stderr: '' });
    });

    it('maps a bare withRetry rejection with no fields to safe ContainerRunResult defaults', async () => {
      mockWithRetry.mockRejectedValueOnce({});
      const result = await makeRunner().runShell('false');
      expect(result).toEqual({ exitCode: 1, stdout: '', stderr: '[object Object]' });
    });

    it('uses the message field when the withRetry rejection carries no exitCode/stdout/stderr', async () => {
      mockWithRetry.mockRejectedValueOnce({ message: 'retry pool exhausted' });
      const result = await makeRunner().runShell('false');
      expect(result).toEqual({ exitCode: 1, stdout: '', stderr: 'retry pool exhausted' });
    });
  });
});

describe('EphemeralEcosystemContainer — pull timeout', () => {
  let spawnStreamingMock: ReturnType<typeof vi.fn>;
  let execFileMock: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    spawnStreamingMock = vi.fn();
    execFileMock = vi.fn();
    warnSpy = vi.fn();

    vi.doMock('@infra/utils/spawn-streaming', () => ({
      spawnStreaming: spawnStreamingMock,
    }));

    vi.doMock('@infra/utils/logger', () => ({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnSpy,
        error: vi.fn(),
        tagged: vi.fn(),
        phase: vi.fn(),
        skip: vi.fn(),
        header: vi.fn(),
      },
    }));

    vi.doMock('@infra/utils/docker-platform', () => ({
      needsHostGateway: () => false,
      resolvePlatform: (p: string | undefined) => p,
    }));

    vi.doMock('@infra/utils/retry', () => ({
      withRetry: async (fn: () => Promise<unknown>) => fn(),
      isDockerTransientError: () => false,
    }));

    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        execFile: execFileMock,
        spawn: vi.fn(),
      };
    });

    vi.doMock('node:util', () => ({
      promisify: (_fn: unknown) => {
        // promisify of execFile — return a function that calls execFileMock as promise
        return (...args: unknown[]) =>
          new Promise((resolve, reject) => {
            execFileMock(...args, (err: unknown, result: unknown) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function makePullTestContext() {
    // docker image inspect fails → image not cached → pull happens
    execFileMock.mockImplementation(
      (_file: unknown, _args: unknown, callback: (err: Error | null, result?: unknown) => void) => {
        callback(new Error('image not found'));
      },
    );

    const { EphemeralEcosystemContainer: Container } = await import(
      '@infra/ecosystem-runtime/ephemeral-container'
    );
    const { logger } = await import('@infra/utils/logger');

    const container = new Container({
      runMode: { kind: 'direct-exec', binary: 'npm' },
      projectDir: '/project',
      image: 'node:20',
      logPrefix: 'npm',
    });

    return { container, logger };
  }

  it('passes timeoutMs to spawnStreaming during docker pull', async () => {
    const { container } = await makePullTestContext();

    spawnStreamingMock.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    });

    // run() itself may reject since execFile is mocked — only spawnStreaming's call matters here
    await container.run(['--version']).catch(() => {});

    expect(spawnStreamingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        file: 'docker',
        args: ['pull', 'node:20'],
        timeoutMs: 300_000,
      }),
    );
  });

  it('logs a warning when docker pull times out', async () => {
    const { container, logger } = await makePullTestContext();

    spawnStreamingMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'Timed out after 300000ms',
      timedOut: true,
    });

    await container.run(['--version']).catch(() => {});

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Docker pull timed out'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('node:20'),
    );
  });

  it('does NOT log a warning when docker pull succeeds (timedOut=false)', async () => {
    const { container, logger } = await makePullTestContext();

    spawnStreamingMock.mockResolvedValue({
      exitCode: 0,
      stdout: 'Digest: sha256:abc',
      stderr: '',
      timedOut: false,
    });

    await container.run(['--version']).catch(() => {});

    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Docker pull timed out'),
    );
  });
});
