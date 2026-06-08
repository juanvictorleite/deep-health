/**
 * PT-BR translation coverage for infrastructure strings added in slice5a:
 * google-drive, google-drive-auth, factory, config/loader, osv-commands, retry
 */
import { __, setLocale } from '@core/i18n';
import { describe, it, expect, beforeEach } from 'vitest';


beforeEach(() => {
  setLocale('en');
});

describe('google-drive translations', () => {
  it('returns English googleapis-not-installed upload message in EN', () => {
    setLocale('en');
    const msg = __('Google Drive upload requires the "googleapis" package, which is not installed. Install it with: npm install googleapis');
    expect(msg).toContain('googleapis');
    expect(msg).toContain('npm install googleapis');
  });

  it('returns PT-BR googleapis-not-installed upload message', () => {
    setLocale('pt-br');
    const msg = __('Google Drive upload requires the "googleapis" package, which is not installed. Install it with: npm install googleapis');
    expect(msg).toContain('googleapis');
    expect(msg).toContain('npm install googleapis');
    expect(msg).not.toBe('Google Drive upload requires the "googleapis" package, which is not installed. Install it with: npm install googleapis');
  });

  it('returns English tokens-not-found message with cliName in EN', () => {
    setLocale('en');
    const msg = __("Google Drive tokens not found. Run '{{cliName}} cloud-setup' first to connect Google Drive.", { cliName: 'osv' });
    expect(msg).toBe("Google Drive tokens not found. Run 'osv cloud-setup' first to connect Google Drive.");
  });

  it('returns PT-BR tokens-not-found message with cliName', () => {
    setLocale('pt-br');
    const msg = __("Google Drive tokens not found. Run '{{cliName}} cloud-setup' first to connect Google Drive.", { cliName: 'osv' });
    expect(msg).toContain('osv cloud-setup');
    expect(msg).not.toContain('tokens not found');
  });
});

describe('google-drive-auth translations', () => {
  it('returns English OAuth-credentials-not-configured message in EN', () => {
    setLocale('en');
    const msg = __(
      'Google OAuth credentials are not configured.\n' +
      'Set the following environment variables before running cloud-setup:\n' +
      '  DEEP_HEALTH_GOOGLE_CLIENT_ID=<your-client-id>\n' +
      '  DEEP_HEALTH_GOOGLE_CLIENT_SECRET=<your-client-secret>\n' +
      'Create OAuth 2.0 credentials (Desktop app) at:\n' +
      '  https://console.cloud.google.com/apis/credentials',
    );
    expect(msg).toContain('Google OAuth credentials are not configured');
    expect(msg).toContain('DEEP_HEALTH_GOOGLE_CLIENT_ID');
  });

  it('returns PT-BR OAuth-credentials-not-configured message', () => {
    setLocale('pt-br');
    const msg = __(
      'Google OAuth credentials are not configured.\n' +
      'Set the following environment variables before running cloud-setup:\n' +
      '  DEEP_HEALTH_GOOGLE_CLIENT_ID=<your-client-id>\n' +
      '  DEEP_HEALTH_GOOGLE_CLIENT_SECRET=<your-client-secret>\n' +
      'Create OAuth 2.0 credentials (Desktop app) at:\n' +
      '  https://console.cloud.google.com/apis/credentials',
    );
    expect(msg).not.toContain('Google OAuth credentials are not configured');
    expect(msg).toContain('DEEP_HEALTH_GOOGLE_CLIENT_ID');
  });

  it('returns English OAuth-flow-googleapis-missing message in EN', () => {
    setLocale('en');
    const msg = __('Google Drive OAuth flow requires the "googleapis" package, which is not installed. Install it with: npm install googleapis');
    expect(msg).toContain('OAuth flow');
    expect(msg).toContain('npm install googleapis');
  });

  it('returns PT-BR OAuth-flow-googleapis-missing message', () => {
    setLocale('pt-br');
    const msg = __('Google Drive OAuth flow requires the "googleapis" package, which is not installed. Install it with: npm install googleapis');
    expect(msg).not.toContain('OAuth flow requires');
    expect(msg).toContain('npm install googleapis');
  });

  it('returns English failed-to-start-server message in EN', () => {
    setLocale('en');
    expect(__('Failed to start local OAuth callback server')).toBe('Failed to start local OAuth callback server');
  });

  it('returns PT-BR failed-to-start-server message', () => {
    setLocale('pt-br');
    const msg = __('Failed to start local OAuth callback server');
    expect(msg).not.toBe('Failed to start local OAuth callback server');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('returns English OAuth-timeout message in EN', () => {
    setLocale('en');
    expect(__('OAuth timeout: authorization not completed in 5 minutes')).toBe(
      'OAuth timeout: authorization not completed in 5 minutes',
    );
  });

  it('returns PT-BR OAuth-timeout message', () => {
    setLocale('pt-br');
    const msg = __('OAuth timeout: authorization not completed in 5 minutes');
    expect(msg).not.toBe('OAuth timeout: authorization not completed in 5 minutes');
    expect(msg).toContain('5 minutos');
  });

  it('returns English Authorization-failed HTML text with error in EN', () => {
    setLocale('en');
    const msg = __('Authorization failed: {{error}}', { error: 'access_denied' });
    expect(msg).toBe('Authorization failed: access_denied');
  });

  it('returns PT-BR Authorization-failed HTML text with error', () => {
    setLocale('pt-br');
    const msg = __('Authorization failed: {{error}}', { error: 'access_denied' });
    expect(msg).toContain('access_denied');
    expect(msg).not.toContain('Authorization failed');
  });

  it('returns English "You can close this tab." in EN', () => {
    setLocale('en');
    expect(__('You can close this tab.')).toBe('You can close this tab.');
  });

  it('returns PT-BR "You can close this tab."', () => {
    setLocale('pt-br');
    const msg = __('You can close this tab.');
    expect(msg).not.toBe('You can close this tab.');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('returns English OAuth-authorization-failed error message with error in EN', () => {
    setLocale('en');
    const msg = __('OAuth authorization failed: {{error}}', { error: 'access_denied' });
    expect(msg).toBe('OAuth authorization failed: access_denied');
  });

  it('returns PT-BR OAuth-authorization-failed error message with error', () => {
    setLocale('pt-br');
    const msg = __('OAuth authorization failed: {{error}}', { error: 'access_denied' });
    expect(msg).toContain('access_denied');
    expect(msg).not.toContain('OAuth authorization failed');
  });

  it('returns English "Invalid state parameter" in EN', () => {
    setLocale('en');
    expect(__('Invalid state parameter')).toBe('Invalid state parameter');
  });

  it('returns PT-BR "Invalid state parameter"', () => {
    setLocale('pt-br');
    const msg = __('Invalid state parameter');
    expect(msg).not.toBe('Invalid state parameter');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('returns English OAuth-state-mismatch message in EN', () => {
    setLocale('en');
    expect(__('OAuth state mismatch — possible CSRF attack')).toBe('OAuth state mismatch — possible CSRF attack');
  });

  it('returns PT-BR OAuth-state-mismatch message', () => {
    setLocale('pt-br');
    const msg = __('OAuth state mismatch — possible CSRF attack');
    expect(msg).not.toBe('OAuth state mismatch — possible CSRF attack');
    expect(msg).toContain('CSRF');
  });

  it('returns English "No authorization code received" in EN', () => {
    setLocale('en');
    expect(__('No authorization code received')).toBe('No authorization code received');
  });

  it('returns PT-BR "No authorization code received"', () => {
    setLocale('pt-br');
    const msg = __('No authorization code received');
    expect(msg).not.toBe('No authorization code received');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('returns English "No authorization code in OAuth callback" in EN', () => {
    setLocale('en');
    expect(__('No authorization code in OAuth callback')).toBe('No authorization code in OAuth callback');
  });

  it('returns PT-BR "No authorization code in OAuth callback"', () => {
    setLocale('pt-br');
    const msg = __('No authorization code in OAuth callback');
    expect(msg).not.toBe('No authorization code in OAuth callback');
    expect(msg.length).toBeGreaterThan(0);
  });
});

describe('factory translations', () => {
  it('returns English unknown-provider message with provider in EN', () => {
    setLocale('en');
    const msg = __('Unknown cloud storage provider: {{provider}}', { provider: 'ftp' });
    expect(msg).toBe('Unknown cloud storage provider: ftp');
  });

  it('returns PT-BR unknown-provider message with provider', () => {
    setLocale('pt-br');
    const msg = __('Unknown cloud storage provider: {{provider}}', { provider: 'ftp' });
    expect(msg).toContain('ftp');
    expect(msg).not.toContain('Unknown cloud storage provider');
  });
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

describe('all new slice5a keys fall back to English when locale is EN', () => {
  it('returns English text unchanged for all new infrastructure keys', () => {
    setLocale('en');
    expect(__('Failed to start local OAuth callback server')).toBe('Failed to start local OAuth callback server');
    expect(__('OAuth timeout: authorization not completed in 5 minutes')).toBe('OAuth timeout: authorization not completed in 5 minutes');
    expect(__('OAuth state mismatch — possible CSRF attack')).toBe('OAuth state mismatch — possible CSRF attack');
    expect(__('No authorization code in OAuth callback')).toBe('No authorization code in OAuth callback');
    expect(__('Unknown cloud storage provider: {{provider}}', { provider: 's3' })).toBe('Unknown cloud storage provider: s3');
    expect(__('scan.paths: "{{path}}" must be relative (no leading /)', { path: '/x' })).toBe('scan.paths: "/x" must be relative (no leading /)');
    expect(__(
      '[retry] Attempt {{attempt}} failed: {{message}}. Retrying in {{delay}}ms ({{attempt}}/{{maxAttempts}})...',
      { attempt: 1, message: 'err', delay: 500, maxAttempts: 3 },
    )).toBe('[retry] Attempt 1 failed: err. Retrying in 500ms (1/3)...');
  });
});
