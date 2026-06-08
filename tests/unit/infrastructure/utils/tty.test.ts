import { isCI, isInteractive, assertInteractive } from '@infra/utils/tty';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';


// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Saves and restores a subset of process.env keys across a test.
 * Also handles process.stdin.isTTY which is normally read-only.
 */
const CI_VARS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BITBUCKET_BUILD_NUMBER',
  'JENKINS_URL',
  'CIRCLECI',
  'TRAVIS',
] as const;

function clearCiEnv(): void {
  for (const v of CI_VARS) {
    delete process.env[v];
  }
}

function setStdinTTY(value: true | undefined): void {
  // process.stdin.isTTY is a non-writable property in Node; use Object.defineProperty.
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

// ─── isCI() ──────────────────────────────────────────────────────────────────

describe('isCI()', () => {
  beforeEach(() => {
    clearCiEnv();
  });

  afterEach(() => {
    clearCiEnv();
  });

  it('returns false when no CI env vars are set', () => {
    expect(isCI()).toBe(false);
  });

  it('returns true when CI=true', () => {
    process.env['CI'] = 'true';
    expect(isCI()).toBe(true);
  });

  it('returns true when CI=1', () => {
    process.env['CI'] = '1';
    expect(isCI()).toBe(true);
  });

  it('returns false when CI=0 (falsy value)', () => {
    process.env['CI'] = '0';
    expect(isCI()).toBe(false);
  });

  it('returns false when CI=false (falsy value)', () => {
    process.env['CI'] = 'false';
    expect(isCI()).toBe(false);
  });

  it('returns false when CI="" (empty string)', () => {
    process.env['CI'] = '';
    expect(isCI()).toBe(false);
  });

  it('returns true when GITHUB_ACTIONS is set', () => {
    process.env['GITHUB_ACTIONS'] = 'true';
    expect(isCI()).toBe(true);
  });

  it('returns true when GITLAB_CI is set', () => {
    process.env['GITLAB_CI'] = 'true';
    expect(isCI()).toBe(true);
  });

  it('returns true when BITBUCKET_BUILD_NUMBER is set', () => {
    process.env['BITBUCKET_BUILD_NUMBER'] = '42';
    expect(isCI()).toBe(true);
  });

  it('returns true when JENKINS_URL is set', () => {
    process.env['JENKINS_URL'] = 'http://jenkins.example.com';
    expect(isCI()).toBe(true);
  });

  it('returns true when CIRCLECI is set', () => {
    process.env['CIRCLECI'] = 'true';
    expect(isCI()).toBe(true);
  });

  it('returns true when TRAVIS is set', () => {
    process.env['TRAVIS'] = 'true';
    expect(isCI()).toBe(true);
  });

  it('returns true when multiple CI vars are set simultaneously', () => {
    process.env['CI'] = 'true';
    process.env['GITHUB_ACTIONS'] = 'true';
    expect(isCI()).toBe(true);
  });
});

// ─── isInteractive() ─────────────────────────────────────────────────────────

describe('isInteractive()', () => {
  beforeEach(() => {
    clearCiEnv();
  });

  afterEach(() => {
    clearCiEnv();
    // Reset isTTY to its original undefined (non-TTY) state after each test
    setStdinTTY(undefined);
  });

  it('returns true when stdin.isTTY is true and no CI vars are set', () => {
    setStdinTTY(true);
    expect(isInteractive()).toBe(true);
  });

  it('returns false when stdin.isTTY is undefined (piped/non-TTY)', () => {
    setStdinTTY(undefined);
    expect(isInteractive()).toBe(false);
  });

  it('returns false when stdin is TTY but CI=true (CI takes precedence)', () => {
    setStdinTTY(true);
    process.env['CI'] = 'true';
    expect(isInteractive()).toBe(false);
  });

  it('returns false when stdin is TTY but GITHUB_ACTIONS is set', () => {
    setStdinTTY(true);
    process.env['GITHUB_ACTIONS'] = 'true';
    expect(isInteractive()).toBe(false);
  });

  it('returns false when stdin is not a TTY and not in CI', () => {
    setStdinTTY(undefined);
    expect(isInteractive()).toBe(false);
  });
});

// ─── assertInteractive() ─────────────────────────────────────────────────────

describe('assertInteractive()', () => {
  beforeEach(() => {
    clearCiEnv();
  });

  afterEach(() => {
    clearCiEnv();
    setStdinTTY(undefined);
  });

  it('does not throw when environment is interactive (TTY, not CI)', () => {
    setStdinTTY(true);
    expect(() => assertInteractive('init')).not.toThrow();
  });

  it('throws when stdin is not a TTY', () => {
    setStdinTTY(undefined);
    expect(() => assertInteractive('init')).toThrow(
      'Interactive prompt required but no TTY detected.',
    );
  });

  it('throws when running in CI even if stdin appears to be TTY', () => {
    setStdinTTY(true);
    process.env['CI'] = 'true';
    expect(() => assertInteractive('init')).toThrow(
      'Interactive prompt required but no TTY detected.',
    );
  });

  it('includes the command name and --non-interactive hint in the error message', () => {
    setStdinTTY(undefined);
    expect(() => assertInteractive('init')).toThrow(/security-scan init --non-interactive/);
  });

  it('includes the correct command name for other commands', () => {
    setStdinTTY(undefined);
    expect(() => assertInteractive('setup')).toThrow(/security-scan setup --non-interactive/);
  });

  it('throws an Error instance (not a string)', () => {
    setStdinTTY(undefined);
    let caught: unknown;
    try {
      assertInteractive('init');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it('does not call process.exit — caller is responsible for handling the error', () => {
    // If assertInteractive called process.exit directly, the test process would exit.
    // We assert it throws instead, giving the caller control.
    setStdinTTY(undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      expect(() => assertInteractive('init')).toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });
});
