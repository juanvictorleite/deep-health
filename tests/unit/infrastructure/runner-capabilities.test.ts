/**
 * Regression pins for the declared runner capability contract (ADR 0019):
 * EcosystemContainerCommandRunner.run()/runArgs() must route on typed
 * presence of `container.runShell` / `container.runStreaming` — present or
 * absent — with no duck-typing guard in between.
 */
import { describe, it, expect, vi } from 'vitest';

import type { CommandRunner, CommandResult } from '@core/types/common';
import { EcosystemContainerCommandRunner } from '@infra/ecosystem-runtime/command-runner';
import type { EcosystemRuntimeSpec } from '@infra/ecosystem-runtime/types';
import type { ContainerRunResult, EphemeralContainerRunner } from '@infra/provisioner/types';

function makeSpec(overrides: Partial<EcosystemRuntimeSpec> = {}): EcosystemRuntimeSpec {
  return {
    defaultImage: 'node:lts',
    resolveImage: () => 'node:lts',
    containerBinaries: ['npm'],
    runMode: { kind: 'direct-exec', binary: 'npm' },
    ...overrides,
  };
}

function makeHostRunner(): CommandRunner {
  return {
    dryRun: false,
    environment: 'local',
    run: vi.fn(async (command: string): Promise<CommandResult> => ({
      stdout: 'host', stderr: '', exitCode: 0, command, dryRun: false,
    })),
    runArgs: vi.fn(async (file: string, args: string[]): Promise<CommandResult> => ({
      stdout: 'host', stderr: '', exitCode: 0, command: `${file} ${args.join(' ')}`, dryRun: false,
    })),
  };
}

function makeContainerResult(stdout: string): ContainerRunResult {
  return { exitCode: 0, stdout, stderr: '', };
}

describe('EcosystemContainerCommandRunner — capability-typed routing', () => {
  it('routes a container-binary command to container.run()', async () => {
    const run = vi.fn(async () => makeContainerResult('container-run'));
    const container: EphemeralContainerRunner<string[]> = { run };
    const runner = new EcosystemContainerCommandRunner({
      container, hostRunner: makeHostRunner(), spec: makeSpec(),
    });

    const result = await runner.run('npm install');

    expect(run).toHaveBeenCalledWith(['install']);
    expect(result).toEqual({
      stdout: 'container-run', stderr: '', exitCode: 0, command: 'npm install', dryRun: false,
    });
  });

  it('dispatches to runStreaming when stream=true and the capability is present', async () => {
    const run = vi.fn(async () => makeContainerResult('non-streamed'));
    const runStreaming = vi.fn(async () => makeContainerResult('streamed'));
    const container: EphemeralContainerRunner<string[]> = { run, runStreaming };
    const runner = new EcosystemContainerCommandRunner({
      container, hostRunner: makeHostRunner(), spec: makeSpec(),
    });

    const result = await runner.run('npm install', { stream: true });

    expect(runStreaming).toHaveBeenCalledWith(['install']);
    expect(run).not.toHaveBeenCalled();
    expect(result.stdout).toBe('streamed');
  });

  it('falls back to container.run() when stream=true but runStreaming is absent', async () => {
    const run = vi.fn(async () => makeContainerResult('non-streamed'));
    const container: EphemeralContainerRunner<string[]> = { run };
    const runner = new EcosystemContainerCommandRunner({
      container, hostRunner: makeHostRunner(), spec: makeSpec(),
    });

    const result = await runner.run('npm install', { stream: true });

    expect(run).toHaveBeenCalledWith(['install']);
    expect(result.stdout).toBe('non-streamed');
  });

  it('routes a non-container command through container.runShell() when present', async () => {
    const run = vi.fn(async () => makeContainerResult('unused'));
    const runShell = vi.fn(async () => makeContainerResult('shelled'));
    const container: EphemeralContainerRunner<string[]> = { run, runShell };
    const hostRunner = makeHostRunner();
    const runner = new EcosystemContainerCommandRunner({
      container, hostRunner, spec: makeSpec(),
    });

    const result = await runner.run('node --version');

    expect(runShell).toHaveBeenCalledWith('node --version', { cwd: undefined });
    expect(hostRunner.run).not.toHaveBeenCalled();
    expect(result.stdout).toBe('shelled');
  });

  it('falls through to hostRunner.run() when runShell is absent', async () => {
    const run = vi.fn(async () => makeContainerResult('unused'));
    const container: EphemeralContainerRunner<string[]> = { run };
    const hostRunner = makeHostRunner();
    const runner = new EcosystemContainerCommandRunner({
      container, hostRunner, spec: makeSpec(),
    });

    const result = await runner.run('node --version');

    expect(hostRunner.run).toHaveBeenCalledWith('node --version', undefined);
    expect(result.stdout).toBe('host');
  });

  it('never routes a host-only command (git) through runShell, even when present', async () => {
    const run = vi.fn(async () => makeContainerResult('unused'));
    const runShell = vi.fn(async () => makeContainerResult('shelled'));
    const container: EphemeralContainerRunner<string[]> = { run, runShell };
    const hostRunner = makeHostRunner();
    const runner = new EcosystemContainerCommandRunner({
      container, hostRunner, spec: makeSpec(),
    });

    const result = await runner.run('git status');

    expect(runShell).not.toHaveBeenCalled();
    expect(hostRunner.run).toHaveBeenCalledWith('git status', undefined);
    expect(result.stdout).toBe('host');
  });

  it('runArgs() routes a container-binary invocation to container.run()', async () => {
    const run = vi.fn(async () => makeContainerResult('container-runargs'));
    const container: EphemeralContainerRunner<string[]> = { run };
    const runner = new EcosystemContainerCommandRunner({
      container, hostRunner: makeHostRunner(), spec: makeSpec(),
    });

    const result = await runner.runArgs('npm', ['install', 'left-pad']);

    expect(run).toHaveBeenCalledWith(['install', 'left-pad']);
    expect(result).toEqual({
      stdout: 'container-runargs', stderr: '', exitCode: 0, command: 'npm install left-pad', dryRun: false,
    });
  });

  it('runArgs() routes a non-container-binary through container.runShell() when present', async () => {
    const run = vi.fn(async () => makeContainerResult('unused'));
    const runShell = vi.fn(async () => makeContainerResult('shelled-args'));
    const container: EphemeralContainerRunner<string[]> = { run, runShell };
    const hostRunner = makeHostRunner();
    const runner = new EcosystemContainerCommandRunner({
      container, hostRunner, spec: makeSpec(),
    });

    const result = await runner.runArgs('node', ['--version']);

    expect(runShell).toHaveBeenCalledWith('node --version', { cwd: undefined });
    expect(hostRunner.runArgs).not.toHaveBeenCalled();
    expect(result.stdout).toBe('shelled-args');
  });

  it('runArgs() falls through to hostRunner.runArgs() when runShell is absent', async () => {
    const run = vi.fn(async () => makeContainerResult('unused'));
    const container: EphemeralContainerRunner<string[]> = { run };
    const hostRunner = makeHostRunner();
    const runner = new EcosystemContainerCommandRunner({
      container, hostRunner, spec: makeSpec(),
    });

    const result = await runner.runArgs('node', ['--version']);

    expect(hostRunner.runArgs).toHaveBeenCalledWith('node', ['--version'], undefined);
    expect(result.stdout).toBe('host');
  });

  it('dry-run short-circuits before any capability check, for both run() and runArgs()', async () => {
    const run = vi.fn(async () => makeContainerResult('unused'));
    const runShell = vi.fn(async () => makeContainerResult('unused'));
    const runStreaming = vi.fn(async () => makeContainerResult('unused'));
    const container: EphemeralContainerRunner<string[]> = { run, runShell, runStreaming };
    const runner = new EcosystemContainerCommandRunner({
      container, hostRunner: makeHostRunner(), spec: makeSpec(), dryRun: true,
    });

    const runResult = await runner.run('npm install');
    const runArgsResult = await runner.runArgs('npm', ['install']);

    expect(runResult).toEqual({ stdout: '', stderr: '', exitCode: 0, command: 'npm install', dryRun: true });
    expect(runArgsResult).toEqual({ stdout: '', stderr: '', exitCode: 0, command: 'npm install', dryRun: true });
    expect(run).not.toHaveBeenCalled();
    expect(runShell).not.toHaveBeenCalled();
    expect(runStreaming).not.toHaveBeenCalled();
  });
});
