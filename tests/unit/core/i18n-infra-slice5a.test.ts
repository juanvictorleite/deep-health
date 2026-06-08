/**
 * PT-BR translation coverage for infrastructure strings added in slice5a:
 * config/loader, osv-commands, retry
 */
import { __, setLocale } from '@core/i18n';
import { describe, it, expect, beforeEach } from 'vitest';


beforeEach(() => {
  setLocale('en');
});

describe('config/loader translations', () => {
  it('returns English scanners-ecosystem-unsupported message with ecosystem in EN', () => {
    setLocale('en');
    const msg = __(
      "Config field 'scanners.{{ecosystem}}' is no longer supported. Move ecosystem runner config to the 'runner' field inside the matching ecosystems[] entry. See docs/adr/0004-ecosystem-runner-config-and-build-context-hardening.md for the rationale.",
      { ecosystem: 'npm' },
    );
    expect(msg).toContain("scanners.npm");
    expect(msg).toContain('is no longer supported');
  });

  it('returns PT-BR scanners-ecosystem-unsupported message with ecosystem', () => {
    setLocale('pt-br');
    const msg = __(
      "Config field 'scanners.{{ecosystem}}' is no longer supported. Move ecosystem runner config to the 'runner' field inside the matching ecosystems[] entry. See docs/adr/0004-ecosystem-runner-config-and-build-context-hardening.md for the rationale.",
      { ecosystem: 'npm' },
    );
    expect(msg).toContain('npm');
    expect(msg).not.toContain('is no longer supported');
  });

  it('returns English runners-block-unsupported message in EN', () => {
    setLocale('en');
    const msg = __(
      "The top-level 'runners' block is no longer supported. Move each runner config (npm, pip, composer) to the 'runner' field inside the matching ecosystems[] entry. Example: ecosystems: [{ id: 'npm', runner: { language_version: '20' } }].",
    );
    expect(msg).toContain("top-level 'runners' block");
    expect(msg).toContain('is no longer supported');
  });

  it('returns PT-BR runners-block-unsupported message', () => {
    setLocale('pt-br');
    const msg = __(
      "The top-level 'runners' block is no longer supported. Move each runner config (npm, pip, composer) to the 'runner' field inside the matching ecosystems[] entry. Example: ecosystems: [{ id: 'npm', runner: { language_version: '20' } }].",
    );
    expect(msg).not.toContain("top-level 'runners' block is no longer supported");
    expect(msg.length).toBeGreaterThan(0);
  });

  it('returns English ecosystem-runner-mode-unsupported message with id and value in EN', () => {
    setLocale('en');
    const msg = __(
      "Config field 'ecosystems[{{id}}].runner.mode' (value: '{{value}}') is no longer supported. Docker is now the only runtime mode. Remove the 'mode' field from your config. See docs/adr/0001-docker-only-runtime.md for the rationale.",
      { id: 'npm', value: 'local' },
    );
    expect(msg).toContain("ecosystems[npm].runner.mode");
    expect(msg).toContain("value: 'local'");
    expect(msg).toContain('Docker is now the only runtime mode');
  });

  it('returns PT-BR ecosystem-runner-mode-unsupported message with id and value', () => {
    setLocale('pt-br');
    const msg = __(
      "Config field 'ecosystems[{{id}}].runner.mode' (value: '{{value}}') is no longer supported. Docker is now the only runtime mode. Remove the 'mode' field from your config. See docs/adr/0001-docker-only-runtime.md for the rationale.",
      { id: 'npm', value: 'local' },
    );
    expect(msg).toContain('npm');
    expect(msg).toContain('local');
    expect(msg).not.toContain('Docker is now the only runtime mode');
  });
});

describe('osv-commands translations', () => {
  it('returns English absolute-path error in EN', () => {
    setLocale('en');
    const msg = __('scan.paths: "{{path}}" must be relative (no leading /)', { path: '/etc/passwd' });
    expect(msg).toBe('scan.paths: "/etc/passwd" must be relative (no leading /)');
  });

  it('returns PT-BR absolute-path error', () => {
    setLocale('pt-br');
    const msg = __('scan.paths: "{{path}}" must be relative (no leading /)', { path: '/etc/passwd' });
    expect(msg).toContain('/etc/passwd');
    expect(msg).not.toContain('must be relative');
  });

  it('returns English dotdot-segment error in EN', () => {
    setLocale('en');
    const msg = __('scan.paths: "{{path}}" must not contain .. segments', { path: '../escape' });
    expect(msg).toBe('scan.paths: "../escape" must not contain .. segments');
  });

  it('returns PT-BR dotdot-segment error', () => {
    setLocale('pt-br');
    const msg = __('scan.paths: "{{path}}" must not contain .. segments', { path: '../escape' });
    expect(msg).toContain('../escape');
    expect(msg).not.toContain('must not contain');
  });

  it('returns English glob-not-supported error in EN', () => {
    setLocale('en');
    const msg = __('scan.paths: "{{path}}" — glob patterns not supported, use a directory path ending with / (e.g. "app/")', { path: 'src/*' });
    expect(msg).toContain('src/*');
    expect(msg).toContain('glob patterns not supported');
  });

  it('returns PT-BR glob-not-supported error', () => {
    setLocale('pt-br');
    const msg = __('scan.paths: "{{path}}" — glob patterns not supported, use a directory path ending with / (e.g. "app/")', { path: 'src/*' });
    expect(msg).toContain('src/*');
    expect(msg).not.toContain('glob patterns not supported');
  });
});

describe('retry translations', () => {
  it('returns English retry-attempt-failed message in EN', () => {
    setLocale('en');
    const msg = __(
      '[retry] Attempt {{attempt}} failed: {{message}}. Retrying in {{delay}}ms ({{attempt}}/{{maxAttempts}})...',
      { attempt: 1, message: 'network error', delay: 1000, maxAttempts: 3 },
    );
    expect(msg).toBe('[retry] Attempt 1 failed: network error. Retrying in 1000ms (1/3)...');
  });

  it('returns PT-BR retry-attempt-failed message', () => {
    setLocale('pt-br');
    const msg = __(
      '[retry] Attempt {{attempt}} failed: {{message}}. Retrying in {{delay}}ms ({{attempt}}/{{maxAttempts}})...',
      { attempt: 2, message: 'timeout', delay: 2000, maxAttempts: 3 },
    );
    expect(msg).toContain('2');
    expect(msg).toContain('timeout');
    expect(msg).toContain('2000');
    expect(msg).not.toContain('Attempt 2 failed');
  });
});

describe('all slice5a keys fall back to English when locale is EN', () => {
  it('returns English text unchanged for all infrastructure keys', () => {
    setLocale('en');
    expect(__('scan.paths: "{{path}}" must be relative (no leading /)', { path: '/x' })).toBe('scan.paths: "/x" must be relative (no leading /)');
    expect(__(
      '[retry] Attempt {{attempt}} failed: {{message}}. Retrying in {{delay}}ms ({{attempt}}/{{maxAttempts}})...',
      { attempt: 1, message: 'err', delay: 500, maxAttempts: 3 },
    )).toBe('[retry] Attempt 1 failed: err. Retrying in 500ms (1/3)...');
  });
});
