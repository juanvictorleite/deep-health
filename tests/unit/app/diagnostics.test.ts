
import { formatCliError } from '@app/diagnostics';
import { ConfigLoadError, GateValidationError, PhaseError } from '@core/errors';
import { CLI_NAME } from '@infra/brand';
import { describe, it, expect } from 'vitest';

describe('formatCliError', () => {
  describe('ConfigLoadError', () => {
    it('returns exitCode 3', () => {
      const err = new ConfigLoadError('Cannot read config', '/some/path');
      const result = formatCliError(err);
      expect(result.exitCode).toBe(3);
    });

    it('prefixes message with "Configuration error:"', () => {
      const err = new ConfigLoadError('Cannot read config: /foo/bar.yml', '/foo/bar.yml');
      const result = formatCliError(err);
      expect(result.message).toBe('Configuration error: Cannot read config: /foo/bar.yml');
    });

    it('preserves the full error message including hints', () => {
      const msg =
        'Cannot read config file: /foo/bar.yml\n  Hint: Run "security-scan init" to generate a starter config.';
      const err = new ConfigLoadError(msg, '/foo/bar.yml');
      const result = formatCliError(err);
      expect(result.message).toContain('security-scan init');
    });

    describe('hints for "Cannot read" messages', () => {
      it('emits hints when message contains "Cannot read"', () => {
        const err = new ConfigLoadError('Cannot read config file: /proj/config.json', '/proj/config.json');
        const result = formatCliError(err);
        expect(result.hints).toBeDefined();
        expect(result.hints).toHaveLength(2);
      });

      it('first hint suggests the init command', () => {
        const err = new ConfigLoadError('Cannot read config', '/some/path');
        const result = formatCliError(err);
        expect(result.hints?.[0]).toContain(`${CLI_NAME} init`);
      });

      it('second hint suggests --help', () => {
        const err = new ConfigLoadError('Cannot read config', '/some/path');
        const result = formatCliError(err);
        expect(result.hints?.[1]).toContain(`${CLI_NAME} --help`);
      });

      it('does not emit hints when message does not contain "Cannot read"', () => {
        const err = new ConfigLoadError('Malformed JSON at line 5', '/proj/config.json');
        const result = formatCliError(err);
        expect(result.hints).toBeUndefined();
      });

      it('hints contain CLI_NAME interpolated correctly', () => {
        const err = new ConfigLoadError('Cannot read config file', '/path');
        const result = formatCliError(err);
        expect(result.hints?.[0]).toMatch(new RegExp(CLI_NAME));
        expect(result.hints?.[1]).toMatch(new RegExp(CLI_NAME));
      });
    });
  });

  describe('GateValidationError', () => {
    it('returns exitCode 2', () => {
      const err = new GateValidationError('gate failed', 'A', ['err1', 'err2']);
      const result = formatCliError(err);
      expect(result.exitCode).toBe(2);
    });

    it('formats gate "A" as "Scan validation" in message', () => {
      const err = new GateValidationError('gate failed', 'A', ['err1']);
      const result = formatCliError(err);
      expect(result.message).toMatch(/Scan validation/);
    });

    it('does not include raw gate letter "A" as gate identifier in the message', () => {
      const err = new GateValidationError('gate failed', 'A', ['err1']);
      const result = formatCliError(err);
      // Should say "Scan validation" not "Gate A" or "Ecosystem A"
      expect(result.message).not.toMatch(/Gate A/);
      expect(result.message).not.toMatch(/Ecosystem A/);
    });

    it('formats non-A gate as "Ecosystem {gate} validation" in message', () => {
      const err = new GateValidationError('gate failed', 'npm', ['vuln found']);
      const result = formatCliError(err);
      expect(result.message).toMatch(/Ecosystem npm validation/);
    });

    it('formats composer gate as "Ecosystem composer validation"', () => {
      const err = new GateValidationError('gate failed', 'composer', ['err']);
      const result = formatCliError(err);
      expect(result.message).toMatch(/Ecosystem composer validation/);
    });

    it('includes all error lines', () => {
      const err = new GateValidationError('gate failed', 'A', ['error one', 'error two']);
      const result = formatCliError(err);
      expect(result.message).toContain('  - error one');
      expect(result.message).toContain('  - error two');
    });

    it('handles empty errors array gracefully', () => {
      const err = new GateValidationError('gate failed', 'A', []);
      const result = formatCliError(err);
      expect(result.exitCode).toBe(2);
      expect(result.message).toMatch(/Scan validation/);
    });

    describe('hints for GateValidationError', () => {
      it('always emits hints', () => {
        const err = new GateValidationError('gate failed', 'A', []);
        const result = formatCliError(err);
        expect(result.hints).toBeDefined();
        expect((result.hints?.length ?? 0)).toBeGreaterThan(0);
      });

      it('first hint mentions unexpected output', () => {
        const err = new GateValidationError('gate failed', 'A', []);
        const result = formatCliError(err);
        expect(result.hints?.[0]).toContain('scanner produced unexpected output');
      });

      it('second hint suggests scan --verbose', () => {
        const err = new GateValidationError('gate failed', 'npm', []);
        const result = formatCliError(err);
        expect(result.hints?.[1]).toContain(`${CLI_NAME} scan --verbose`);
      });

      it('third hint suggests fix --dry-run', () => {
        const err = new GateValidationError('gate failed', 'npm', []);
        const result = formatCliError(err);
        expect(result.hints?.[2]).toContain(`${CLI_NAME} fix --dry-run`);
      });

      it('emits exactly 3 hint lines', () => {
        const err = new GateValidationError('gate failed', 'A', ['e1']);
        const result = formatCliError(err);
        expect(result.hints).toHaveLength(3);
      });
    });
  });

  describe('PhaseError', () => {
    it('returns exitCode 2', () => {
      const err = new PhaseError('scan failed', 'scan');
      const result = formatCliError(err);
      expect(result.exitCode).toBe(2);
    });

    it('includes phase name and message', () => {
      const err = new PhaseError('OSV scanner not found', 'scan');
      const result = formatCliError(err);
      expect(result.message).toBe('Phase "scan" failed: OSV scanner not found');
    });

    describe('OOM / killed hints', () => {
      it('suggests Docker memory when message contains "exit code 137"', () => {
        const err = new PhaseError('Process exited with exit code 137', 'ecosystem-fix');
        const result = formatCliError(err);
        expect(result.hints?.some((h) => h.toLowerCase().includes('memory'))).toBe(true);
      });

      it('suggests Docker memory when message contains "killed" (case-insensitive)', () => {
        const err = new PhaseError('Container was Killed by OOM killer', 'scan');
        const result = formatCliError(err);
        expect(result.hints?.some((h) => h.toLowerCase().includes('memory'))).toBe(true);
      });

      it('emits 2 hint lines for OOM errors', () => {
        const err = new PhaseError('exit code 137', 'scan');
        const result = formatCliError(err);
        expect(result.hints).toHaveLength(2);
      });

      it('OOM hints mention Docker Desktop settings', () => {
        const err = new PhaseError('exit code 137 during build', 'scan');
        const result = formatCliError(err);
        expect(result.hints?.some((h) => h.includes('Docker'))).toBe(true);
      });
    });

    describe('ecosystem-fix phase hints', () => {
      it('suggests --phases flag for ecosystem-fix phase (non-OOM)', () => {
        const err = new PhaseError('npm install failed', 'ecosystem-fix');
        const result = formatCliError(err);
        expect(result.hints?.some((h) => h.includes('--phases'))).toBe(true);
      });

      it('includes CLI_NAME in --phases hint', () => {
        const err = new PhaseError('connection refused', 'ecosystem-fix');
        const result = formatCliError(err);
        expect(result.hints?.some((h) => h.includes(CLI_NAME))).toBe(true);
      });

      it('emits 2 hint lines for ecosystem-fix phase', () => {
        const err = new PhaseError('some error', 'ecosystem-fix');
        const result = formatCliError(err);
        expect(result.hints).toHaveLength(2);
      });
    });

    describe('generic phase hints (fallback)', () => {
      it('suggests --verbose for generic phases', () => {
        const err = new PhaseError('unexpected failure', 'scan');
        const result = formatCliError(err);
        expect(result.hints?.some((h) => h.includes('--verbose'))).toBe(true);
      });

      it('includes CLI_NAME in generic hint', () => {
        const err = new PhaseError('unexpected failure', 'report');
        const result = formatCliError(err);
        expect(result.hints?.some((h) => h.includes(CLI_NAME))).toBe(true);
      });

      it('emits exactly 1 hint line for generic phase errors', () => {
        const err = new PhaseError('unexpected failure', 'report');
        const result = formatCliError(err);
        expect(result.hints).toHaveLength(1);
      });
    });

    it('OOM detection takes priority over ecosystem-fix phase hint', () => {
      // ecosystem-fix phase + OOM message → should produce OOM hints (Docker memory)
      const err = new PhaseError('exit code 137', 'ecosystem-fix');
      const result = formatCliError(err);
      expect(result.hints?.some((h) => h.toLowerCase().includes('memory'))).toBe(true);
      expect(result.hints?.some((h) => h.includes('--phases'))).toBe(false);
    });
  });

  describe('unexpected / generic errors', () => {
    it('returns exitCode 2 for a plain Error', () => {
      const err = new Error('something exploded');
      const result = formatCliError(err);
      expect(result.exitCode).toBe(2);
    });

    it('includes the error message for a plain Error', () => {
      const err = new Error('something exploded');
      const result = formatCliError(err);
      expect(result.message).toBe('Unexpected error: something exploded');
    });

    it('returns exitCode 2 for a non-Error throw', () => {
      const result = formatCliError('a string was thrown');
      expect(result.exitCode).toBe(2);
    });

    it('stringifies non-Error throws', () => {
      const result = formatCliError('a string was thrown');
      expect(result.message).toBe('Unexpected error: a string was thrown');
    });

    it('handles null throw', () => {
      const result = formatCliError(null);
      expect(result.exitCode).toBe(2);
      expect(result.message).toBe('Unexpected error: null');
    });

    it('does not include hints for generic errors', () => {
      const result = formatCliError(new Error('boom'));
      expect(result.hints).toBeUndefined();
    });
  });

  describe('purity — no side effects', () => {
    it('does not call process.exit', () => {
      const origExit = process.exit;
      let exitCalled = false;
      // @ts-expect-error stub
      process.exit = () => { exitCalled = true; };
      try {
        formatCliError(new ConfigLoadError('x', '/x'));
        expect(exitCalled).toBe(false);
      } finally {
        process.exit = origExit;
      }
    });

    it('does not write to process.stderr', () => {
      const writes: string[] = [];
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      };
      try {
        formatCliError(new ConfigLoadError('Cannot read config', '/path'));
        formatCliError(new GateValidationError('g', 'A', ['e']));
        formatCliError(new PhaseError('p', 'scan'));
        expect(writes).toHaveLength(0);
      } finally {
        process.stderr.write = origWrite;
      }
    });
  });

  describe('CliErrorResult shape', () => {
    it('ConfigLoadError without "Cannot read" has no hints key set', () => {
      const result = formatCliError(new ConfigLoadError('Malformed JSON', '/p'));
      expect('hints' in result).toBe(false);
    });

    it('ConfigLoadError with "Cannot read" has hints array', () => {
      const result = formatCliError(new ConfigLoadError('Cannot read config file', '/p'));
      expect(Array.isArray(result.hints)).toBe(true);
    });

    it('GateValidationError always has hints array', () => {
      const result = formatCliError(new GateValidationError('g', 'A', []));
      expect(Array.isArray(result.hints)).toBe(true);
    });

    it('PhaseError always has hints array', () => {
      const result = formatCliError(new PhaseError('p', 'scan'));
      expect(Array.isArray(result.hints)).toBe(true);
    });

    it('unexpected errors have no hints key', () => {
      const result = formatCliError(new Error('boom'));
      expect('hints' in result).toBe(false);
    });
  });
});
