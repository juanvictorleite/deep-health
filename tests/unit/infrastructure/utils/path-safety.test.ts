
import { ConfigLoadError } from '@core/errors';
import { assertLockfilePathWithinCwd } from '@infra/utils/path-safety';
import { describe, it, expect } from 'vitest';

const CWD = '/project';

describe('assertLockfilePathWithinCwd', () => {
  // ── Valid paths ──────────────────────────────────────────────────────────────

  describe('valid paths (AC2)', () => {
    it('returns a simple root-level lockfile unchanged', () => {
      expect(assertLockfilePathWithinCwd('package-lock.json', CWD)).toBe('package-lock.json');
    });

    it('returns a nested monorepo lockfile unchanged', () => {
      expect(assertLockfilePathWithinCwd('app/package-lock.json', CWD)).toBe('app/package-lock.json');
    });

    it('returns composer.lock unchanged', () => {
      expect(assertLockfilePathWithinCwd('composer.lock', CWD)).toBe('composer.lock');
    });

    it('returns a deeply nested path unchanged', () => {
      expect(assertLockfilePathWithinCwd('packages/api/package-lock.json', CWD)).toBe(
        'packages/api/package-lock.json',
      );
    });

    it('handles a path with a safe same-directory dot segment', () => {
      // './package-lock.json' resolves to /project/package-lock.json — still inside
      expect(assertLockfilePathWithinCwd('./package-lock.json', CWD)).toBe('./package-lock.json');
    });
  });

  // ── Traversal rejection (AC1 + AC3) ─────────────────────────────────────────

  describe('path traversal rejection (AC1, AC3)', () => {
    it('rejects a simple "../" traversal', () => {
      expect(() => assertLockfilePathWithinCwd('../../etc/passwd', CWD)).toThrow(ConfigLoadError);
    });

    it('rejects a traversal that escapes cwd by one level', () => {
      expect(() => assertLockfilePathWithinCwd('../sibling/package-lock.json', CWD)).toThrow(
        ConfigLoadError,
      );
    });

    it('includes the offending path in the error message', () => {
      let caught: unknown;
      try {
        assertLockfilePathWithinCwd('../../etc/passwd', CWD);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConfigLoadError);
      const err = caught as ConfigLoadError;
      expect(err.message).toContain('../../etc/passwd');
      expect(err.message).toContain('project directory');
    });
  });

  // ── Absolute path rejection (AC1 + AC3) ─────────────────────────────────────

  describe('absolute path rejection (AC1, AC3)', () => {
    it('rejects an absolute unix path', () => {
      expect(() => assertLockfilePathWithinCwd('/etc/passwd', CWD)).toThrow(ConfigLoadError);
    });

    it('rejects a root-only absolute path', () => {
      expect(() => assertLockfilePathWithinCwd('/package-lock.json', CWD)).toThrow(ConfigLoadError);
    });

    it('includes "absolute" in the error message for absolute paths', () => {
      let caught: unknown;
      try {
        assertLockfilePathWithinCwd('/etc/passwd', CWD);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConfigLoadError);
      expect((caught as ConfigLoadError).message).toContain('absolute');
    });
  });

  // ── Empty / whitespace rejection (AC3) ──────────────────────────────────────

  describe('empty / whitespace rejection (AC3)', () => {
    it('rejects an empty string', () => {
      expect(() => assertLockfilePathWithinCwd('', CWD)).toThrow(ConfigLoadError);
    });

    it('rejects a whitespace-only string', () => {
      expect(() => assertLockfilePathWithinCwd('   ', CWD)).toThrow(ConfigLoadError);
    });

    it('includes a clear "empty" message for empty paths', () => {
      let caught: unknown;
      try {
        assertLockfilePathWithinCwd('', CWD);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConfigLoadError);
      expect((caught as ConfigLoadError).message).toContain('empty');
    });
  });
});
