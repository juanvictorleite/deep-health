/**
 * Tests for the TTY guard in runInitCommand.
 * Covers AC4: when no TTY and --non-interactive is not passed, the command
 * writes a clear error to stderr and exits with code 1.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Module mocks must come before imports ────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  access: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  mkdir: vi.fn(),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

vi.mock('@infra/config/generator', () => ({
  generateConfigJson: vi.fn(() => '{}'),
  normalizeSonarProjectKey: vi.fn((name: string) => name),
}));

vi.mock('@infra/config/schema-export', () => ({
  generateJsonSchema: vi.fn(() => ({ type: 'object' })),
}));

vi.mock('@infra/utils/prompt', () => ({
  prompt: vi.fn(),
}));

vi.mock('@infra/utils/inquirer-prompts', () => ({
  confirmPrompt: vi.fn(),
  selectPrompt: vi.fn(),
  checkboxPrompt: vi.fn(),
}));

vi.mock('@infra/utils/detect-ecosystems', () => ({
  discoverProject: vi.fn().mockResolvedValue({ ecosystems: [], dockerfiles: [] }),
}));

vi.mock('@infra/utils/detect-scripts', () => ({
  detectProjectScripts: vi.fn().mockResolvedValue([]),
}));

// ─── TTY utility mock — the seam we test ─────────────────────────────────────

vi.mock('@infra/utils/tty', () => ({
  isCI: vi.fn(),
  isInteractive: vi.fn(),
  assertInteractive: vi.fn(),
}));

import { isInteractive } from '@infra/utils/tty';
import { runInitCommand } from '@app/commands/init';

const mockIsInteractive = vi.mocked(isInteractive);

/**
 * Sentinel error thrown by the mocked process.exit to halt execution.
 * Real process.exit() never returns; this mimics that by throwing.
 */
class ProcessExitError extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runInitCommand() — TTY guard (AC4)', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    // Make exit throw so execution actually stops — mimics real process.exit behaviour
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new ProcessExitError(code ?? 0);
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits with code 1 and writes error to stderr when not interactive and --non-interactive not passed', async () => {
    mockIsInteractive.mockReturnValue(false);

    await expect(runInitCommand({ cwd: '/repo', force: true })).rejects.toThrow(
      ProcessExitError,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrOutput).toContain('Interactive prompt required but no TTY detected');
    expect(stderrOutput).toContain('--non-interactive');
  });

  it('includes the CLI name and init command in the error message', async () => {
    mockIsInteractive.mockReturnValue(false);

    await expect(runInitCommand({ cwd: '/repo', force: true })).rejects.toThrow(
      ProcessExitError,
    );
    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrOutput).toContain('security-scan init --non-interactive');
  });

  it('does NOT consult isInteractive when --non-interactive is passed', async () => {
    // nonInteractive flag bypasses the TTY check entirely
    mockIsInteractive.mockReturnValue(false);

    // With non-interactive mode and fully-mocked ecosystem discovery the command completes.
    // We don't care whether it fully succeeds — only that isInteractive was never called.
    try {
      await runInitCommand({ cwd: '/repo', force: true, nonInteractive: true });
    } catch {
      // Downstream errors (unrelated to the TTY guard) are acceptable here
    }

    expect(mockIsInteractive).not.toHaveBeenCalled();
  });

  it('does NOT call process.exit when environment is interactive', async () => {
    mockIsInteractive.mockReturnValue(true);

    // In interactive mode the prompts would be invoked — mock them minimally
    const { selectPrompt, checkboxPrompt, confirmPrompt } = await import('@infra/utils/inquirer-prompts');
    vi.mocked(selectPrompt).mockImplementation(
      (_msg: string, choices: Array<{ name: string; value: string }>) =>
        Promise.resolve(choices[0]!.value),
    );
    vi.mocked(checkboxPrompt).mockResolvedValue([]);
    vi.mocked(confirmPrompt).mockResolvedValue(false);
    const { prompt } = await import('@infra/utils/prompt');
    vi.mocked(prompt).mockImplementation((_q: string, def?: string) => Promise.resolve(def ?? ''));

    try {
      await runInitCommand({ cwd: '/repo', force: true });
    } catch (e) {
      // A ProcessExitError here means process.exit was called — re-throw so the test fails
      if (e instanceof ProcessExitError) throw e;
      // Other errors from deep in the init flow are acceptable
    }

    expect(mockIsInteractive).toHaveBeenCalled();
    // process.exit must not have been called (it would throw ProcessExitError)
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
