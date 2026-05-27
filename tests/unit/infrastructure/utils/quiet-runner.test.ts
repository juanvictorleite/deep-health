/**
 * Tests for src/infrastructure/utils/quiet-runner.ts
 * Covers AC5: stream stripping, onLine preservation, passthrough, and property proxying.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CommandRunner, CommandResult } from '@core/types/common';
import { createQuietRunner } from '@infra/utils/quiet-runner';

function makeResult(command: string): CommandResult {
  return { stdout: '', stderr: '', exitCode: 0, command, dryRun: false };
}

function makeMockRunner(overrides: Partial<CommandRunner> = {}): CommandRunner {
  return {
    dryRun: false,
    environment: 'local',
    run: vi.fn().mockResolvedValue(makeResult('cmd')),
    runArgs: vi.fn().mockResolvedValue(makeResult('file')),
    ...overrides,
  } as unknown as CommandRunner;
}

describe('createQuietRunner()', () => {
  describe('run()', () => {
    it('strips stream:true from options', async () => {
      const inner = makeMockRunner();
      const quiet = createQuietRunner(inner);

      await quiet.run('npm ci', { cwd: '/tmp', stream: true });

      expect(inner.run).toHaveBeenCalledWith('npm ci', { cwd: '/tmp' });
    });

    it('strips stream:true but preserves onLine callback', async () => {
      const inner = makeMockRunner();
      const quiet = createQuietRunner(inner);
      const onLine = vi.fn();

      await quiet.run('npm audit', { stream: true, onLine });

      expect(inner.run).toHaveBeenCalledWith('npm audit', { onLine });
    });

    it('passes through options unchanged when stream is false', async () => {
      const inner = makeMockRunner();
      const quiet = createQuietRunner(inner);

      await quiet.run('npm ls', { cwd: '/tmp', stream: false });

      expect(inner.run).toHaveBeenCalledWith('npm ls', { cwd: '/tmp', stream: false });
    });

    it('passes through options unchanged when stream is absent', async () => {
      const inner = makeMockRunner();
      const quiet = createQuietRunner(inner);

      await quiet.run('npm ls', { cwd: '/tmp', timeout: 5000 });

      expect(inner.run).toHaveBeenCalledWith('npm ls', { cwd: '/tmp', timeout: 5000 });
    });

    it('passes through when options are undefined', async () => {
      const inner = makeMockRunner();
      const quiet = createQuietRunner(inner);

      await quiet.run('npm ls');

      expect(inner.run).toHaveBeenCalledWith('npm ls', undefined);
    });
  });

  describe('runArgs()', () => {
    it('strips stream:true from options', async () => {
      const inner = makeMockRunner();
      const quiet = createQuietRunner(inner);

      await quiet.runArgs('npm', ['ci'], { cwd: '/app', stream: true });

      expect(inner.runArgs).toHaveBeenCalledWith('npm', ['ci'], { cwd: '/app' });
    });

    it('strips stream:true but preserves onLine callback', async () => {
      const inner = makeMockRunner();
      const quiet = createQuietRunner(inner);
      const onLine = vi.fn();

      await quiet.runArgs('npm', ['audit'], { stream: true, onLine });

      expect(inner.runArgs).toHaveBeenCalledWith('npm', ['audit'], { onLine });
    });

    it('passes through options unchanged when stream is false', async () => {
      const inner = makeMockRunner();
      const quiet = createQuietRunner(inner);

      await quiet.runArgs('npm', ['ls'], { cwd: '/app', stream: false });

      expect(inner.runArgs).toHaveBeenCalledWith('npm', ['ls'], { cwd: '/app', stream: false });
    });
  });

  describe('proxied properties', () => {
    it('proxies dryRun from inner runner', () => {
      const inner = makeMockRunner({ dryRun: true });
      const quiet = createQuietRunner(inner);

      expect(quiet.dryRun).toBe(true);
    });

    it('proxies dryRun=false from inner runner', () => {
      const inner = makeMockRunner({ dryRun: false });
      const quiet = createQuietRunner(inner);

      expect(quiet.dryRun).toBe(false);
    });

    it('proxies environment from inner runner', () => {
      const inner = makeMockRunner({ environment: 'docker' });
      const quiet = createQuietRunner(inner);

      expect(quiet.environment).toBe('docker');
    });

    it('reflects inner dryRun changes dynamically', () => {
      const innerObj = { dryRun: false, environment: 'local' as const, run: vi.fn(), runArgs: vi.fn() };
      const quiet = createQuietRunner(innerObj);

      expect(quiet.dryRun).toBe(false);
      innerObj.dryRun = true;
      expect(quiet.dryRun).toBe(true);
    });
  });
});
