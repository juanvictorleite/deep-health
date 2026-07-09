/**
 * Tests for src/infrastructure/utils/git-commit.ts
 * Covers createBranchAndCommit's full contract via a fake CommandRunner
 * (pattern shared with tests/unit/app/fix-command-branches.test.ts) and
 * buildBranchName's timestamp formatting.
 */
import { describe, it, expect, vi } from 'vitest';

import type { CommandResult, CommandRunner } from '@core/types/common';

vi.mock('@infra/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), tagged: vi.fn() },
}));

import { buildBranchName, createBranchAndCommit } from '@infra/utils/git-commit';

interface ScriptedResponse {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

function makeScriptedRunner(responses: Record<string, ScriptedResponse>): {
  runner: CommandRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runArgs = vi.fn(
    async (_file: string, args: string[]): Promise<CommandResult> => {
      calls.push(args);
      const key = args.join(' ');
      const response = responses[key] ?? { exitCode: 0 };
      return {
        exitCode: response.exitCode,
        stdout: response.stdout ?? '',
        stderr: response.stderr ?? '',
        command: key,
        dryRun: false,
      };
    },
  );
  const runner: CommandRunner = {
    runArgs,
    run: vi.fn(),
    dryRun: false,
    environment: 'local',
  };
  return { runner, calls };
}

describe('createBranchAndCommit() — checkout -b failure', () => {
  it.each([
    { label: 'reports the stderr detail when present', stderr: 'fatal: branch already exists', stdout: '', expected: 'fatal: branch already exists' },
    { label: 'falls back to stdout when stderr is empty', stderr: '', stdout: 'branch creation refused', expected: 'branch creation refused' },
  ])('$label', async ({ stderr, stdout, expected }) => {
    const { runner, calls } = makeScriptedRunner({
      'checkout -b my-branch': { exitCode: 1, stderr, stdout },
    });

    await expect(
      createBranchAndCommit(runner, '/repo', 'main', 'my-branch', 'fix: msg', async () => 0),
    ).rejects.toThrow(expected);

    expect(calls).toEqual([['checkout', '-b', 'my-branch']]);
  });
});

describe('createBranchAndCommit() — fn() returns a non-zero exit code', () => {
  describe.each([
    { label: 'rolls back and tolerates a successful branch delete', deleteExitCode: 0 },
    { label: 'rolls back and tolerates a failed branch delete', deleteExitCode: 1 },
  ])('$label', ({ deleteExitCode }) => {
    it('checks out originalBranch, deletes the fix branch, and returns committed:false with the pipeline exit code', async () => {
      const { runner, calls } = makeScriptedRunner({
        'checkout -b nonzero-branch': { exitCode: 0 },
        'checkout main': { exitCode: 0 },
        'branch -D nonzero-branch': { exitCode: deleteExitCode },
      });

      const result = await createBranchAndCommit(
        runner,
        '/repo',
        'main',
        'nonzero-branch',
        'fix: msg',
        async () => 2,
      );

      expect(result).toEqual({ branch: 'nonzero-branch', committed: false, exitCode: 2 });
      expect(calls).toContainEqual(['checkout', 'main']);
      expect(calls).toContainEqual(['branch', '-D', 'nonzero-branch']);
      expect(calls.some((args) => args[0] === 'add')).toBe(false);
    });
  });

  it('skips rollback entirely when originalBranch is null', async () => {
    const { runner, calls } = makeScriptedRunner({
      'checkout -b nonzero-branch': { exitCode: 0 },
    });

    const result = await createBranchAndCommit(
      runner,
      '/repo',
      null,
      'nonzero-branch',
      'fix: msg',
      async () => 3,
    );

    expect(result).toEqual({ branch: 'nonzero-branch', committed: false, exitCode: 3 });
    expect(calls).toEqual([['checkout', '-b', 'nonzero-branch']]);
  });
});

describe('createBranchAndCommit() — fn() throws', () => {
  describe.each([
    { label: 'rolls back and tolerates a successful branch delete', deleteExitCode: 0 },
    { label: 'rolls back and tolerates a failed branch delete', deleteExitCode: 1 },
  ])('$label', ({ deleteExitCode }) => {
    it('checks out originalBranch, deletes the fix branch, and re-throws the original error', async () => {
      const { runner, calls } = makeScriptedRunner({
        'checkout -b thrown-branch': { exitCode: 0 },
        'checkout main': { exitCode: 0 },
        'branch -D thrown-branch': { exitCode: deleteExitCode },
      });
      const boom = new Error('pipeline exploded');

      await expect(
        createBranchAndCommit(runner, '/repo', 'main', 'thrown-branch', 'fix: msg', async () => {
          throw boom;
        }),
      ).rejects.toThrow('pipeline exploded');

      expect(calls).toContainEqual(['checkout', 'main']);
      expect(calls).toContainEqual(['branch', '-D', 'thrown-branch']);
    });
  });

  it('re-throws without attempting rollback when originalBranch is null', async () => {
    const { runner, calls } = makeScriptedRunner({
      'checkout -b thrown-branch': { exitCode: 0 },
    });
    const boom = new Error('pipeline exploded');

    await expect(
      createBranchAndCommit(runner, '/repo', null, 'thrown-branch', 'fix: msg', async () => {
        throw boom;
      }),
    ).rejects.toThrow('pipeline exploded');

    expect(calls).toEqual([['checkout', '-b', 'thrown-branch']]);
  });
});

describe('createBranchAndCommit() — commit reports nothing to commit', () => {
  it.each([
    { label: '"nothing to commit"', message: 'nothing to commit, working tree clean' },
    { label: '"nothing added to commit"', message: 'nothing added to commit but untracked files present' },
  ])('returns committed:false with exitCode 0 for $label without throwing', async ({ message }) => {
    const { runner } = makeScriptedRunner({
      'checkout -b clean-branch': { exitCode: 0 },
      'add -A': { exitCode: 0 },
      'commit -m fix: msg': { exitCode: 1, stdout: message },
    });

    const result = await createBranchAndCommit(
      runner,
      '/repo',
      'main',
      'clean-branch',
      'fix: msg',
      async () => 0,
    );

    expect(result).toEqual({ branch: 'clean-branch', committed: false, exitCode: 0 });
  });
});

describe('createBranchAndCommit() — commit fails for another reason', () => {
  it('throws with the stderr detail', async () => {
    const { runner } = makeScriptedRunner({
      'checkout -b broken-branch': { exitCode: 0 },
      'add -A': { exitCode: 0 },
      'commit -m fix: msg': { exitCode: 1, stderr: 'fatal: unable to write new index file' },
    });

    await expect(
      createBranchAndCommit(runner, '/repo', 'main', 'broken-branch', 'fix: msg', async () => 0),
    ).rejects.toThrow('fatal: unable to write new index file');
  });

  it('falls back to stdout when stderr is empty', async () => {
    const { runner } = makeScriptedRunner({
      'checkout -b broken-branch': { exitCode: 0 },
      'add -A': { exitCode: 0 },
      'commit -m fix: msg': { exitCode: 1, stdout: 'hook rejected the commit' },
    });

    await expect(
      createBranchAndCommit(runner, '/repo', 'main', 'broken-branch', 'fix: msg', async () => 0),
    ).rejects.toThrow('hook rejected the commit');
  });
});

describe('createBranchAndCommit() — success path', () => {
  it('stages all changes, commits, and returns committed:true', async () => {
    const { runner, calls } = makeScriptedRunner({
      'checkout -b good-branch': { exitCode: 0 },
      'add -A': { exitCode: 0 },
      'commit -m fix: msg': { exitCode: 0 },
    });

    const result = await createBranchAndCommit(
      runner,
      '/repo',
      'main',
      'good-branch',
      'fix: msg',
      async () => 0,
    );

    expect(result).toEqual({ branch: 'good-branch', committed: true, exitCode: 0 });
    expect(calls).toEqual([
      ['checkout', '-b', 'good-branch'],
      ['add', '-A'],
      ['commit', '-m', 'fix: msg'],
    ]);
  });
});

describe('buildBranchName()', () => {
  it('returns the prefix followed by a hyphenated ISO timestamp with no milliseconds', () => {
    const name = buildBranchName('fix/security-scan-');

    expect(name.startsWith('fix/security-scan-')).toBe(true);
    const suffix = name.slice('fix/security-scan-'.length);
    expect(suffix).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    expect(suffix).not.toContain(':');
    expect(suffix).not.toContain('.');
  });
});
