/**
 * PT-BR translation coverage for CLI output strings added in slice4:
 * cloud-setup, fix, report-saver, google-drive-auth
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { __, setLocale } from '@core/i18n';

beforeEach(() => {
  setLocale('en');
});

describe('cloud-setup translations', () => {
  it('returns English config-not-found message in EN', () => {
    setLocale('en');
    const msg = __(
      'Config file not found: {{configPath}}\nRun "{{cliName}} init" first.\n',
      { configPath: '/path/to/config.json', cliName: 'osv' },
    );
    expect(msg).toBe('Config file not found: /path/to/config.json\nRun "osv init" first.\n');
  });

  it('returns PT-BR config-not-found message', () => {
    setLocale('pt-br');
    const msg = __(
      'Config file not found: {{configPath}}\nRun "{{cliName}} init" first.\n',
      { configPath: '/path/to/config.json', cliName: 'osv' },
    );
    expect(msg).toBe(
      'Arquivo de configuração não encontrado: /path/to/config.json\nExecute "osv init" primeiro.\n',
    );
  });

  it('translates "Starting Google OAuth 2.0 authorization flow..." to PT-BR', () => {
    setLocale('pt-br');
    expect(__('Starting Google OAuth 2.0 authorization flow...\n')).toBe(
      'Iniciando fluxo de autorização Google OAuth 2.0...\n',
    );
  });

  it('translates OAuth flow failed message to PT-BR', () => {
    setLocale('pt-br');
    expect(__('OAuth flow failed: {{error}}\n', { error: 'timeout' })).toBe(
      'Falha no fluxo OAuth: timeout\n',
    );
  });

  it('translates authenticated-as message to PT-BR with email', () => {
    setLocale('pt-br');
    expect(__('✔ Authenticated as: {{email}}\n', { email: 'user@example.com' })).toBe(
      '✔ Autenticado como: user@example.com\n',
    );
  });

  it('translates Google Drive connected to PT-BR', () => {
    setLocale('pt-br');
    expect(__('✔ Google Drive connected.\n')).toBe('✔ Google Drive conectado.\n');
  });

  it('translates "Fetching Google Drive folders..." to PT-BR', () => {
    setLocale('pt-br');
    expect(__('Fetching Google Drive folders...\n')).toBe('Buscando pastas do Google Drive...\n');
  });

  it('translates "Failed to list folders" to PT-BR', () => {
    setLocale('pt-br');
    expect(__('Failed to list folders: {{error}}\n', { error: 'network error' })).toBe(
      'Falha ao listar pastas: network error\n',
    );
  });

  it('translates no-folders message to PT-BR', () => {
    setLocale('pt-br');
    const msg = __(
      'No folders found in your Google Drive.\nCreate a folder in Google Drive first or enter the folder ID manually.\n',
    );
    expect(msg).toContain('Nenhuma pasta encontrada');
    expect(msg).toContain('manualmente');
  });

  it('translates "Setup cancelled." to PT-BR', () => {
    setLocale('pt-br');
    expect(__('Setup cancelled.\n')).toBe('Configuração cancelada.\n');
  });

  it('translates cloud-storage-configured message to PT-BR with configPath', () => {
    setLocale('pt-br');
    const msg = __(
      '\n✔ Cloud storage configured. Folder ID saved to: {{configPath}}\n',
      { configPath: '/some/config.json' },
    );
    expect(msg).toBe(
      '\n✔ Armazenamento em nuvem configurado. ID da pasta salvo em: /some/config.json\n',
    );
  });
});

describe('fix command translations', () => {
  it('translates --open-pr requires gh message to PT-BR', () => {
    setLocale('pt-br');
    const msg = __(
      '[{{cliName}}] --open-pr requires the GitHub CLI (gh). Install it from https://cli.github.com and run: gh auth login\n',
      { cliName: 'osv' },
    );
    expect(msg).toContain('[osv]');
    expect(msg).toContain('GitHub CLI');
    expect(msg).toContain('https://cli.github.com');
  });

  it('translates "git push failed" error to PT-BR', () => {
    setLocale('pt-br');
    const msg = __('git push failed: {{detail}}', { detail: 'non-fast-forward' });
    expect(msg).toBe('git push falhou: non-fast-forward');
  });

  it('translates "gh pr create failed" error to PT-BR', () => {
    setLocale('pt-br');
    const msg = __('gh pr create failed: {{detail}}', { detail: 'HTTP 422' });
    expect(msg).toBe('gh pr create falhou: HTTP 422');
  });

  it('translates "Pull request created" to PT-BR with URL', () => {
    setLocale('pt-br');
    const msg = __(
      '[{{cliName}}] Pull request created: {{prUrl}}\n',
      { cliName: 'osv', prUrl: 'https://github.com/org/repo/pull/42' },
    );
    expect(msg).toBe('[osv] Pull request criado: https://github.com/org/repo/pull/42\n');
  });
});

describe('report-saver translations', () => {
  it('translates "Cloud storage init failed" (with newline) to PT-BR', () => {
    setLocale('pt-br');
    const msg = __('Cloud storage init failed: {{msg}}\n', { msg: 'auth expired' });
    expect(msg).toBe('Falha ao inicializar armazenamento em nuvem: auth expired\n');
  });

  it('translates "Cloud storage init failed" (no newline) to PT-BR', () => {
    setLocale('pt-br');
    const msg = __('Cloud storage init failed: {{msg}}', { msg: 'auth expired' });
    expect(msg).toBe('Falha ao inicializar armazenamento em nuvem: auth expired');
  });

  it('translates "Report saved" message to PT-BR', () => {
    setLocale('pt-br');
    const msg = __(
      'Report saved [{{provider}}]: {{url}}\n',
      { provider: 'local', url: '/reports/report.md' },
    );
    expect(msg).toBe('Relatório salvo [local]: /reports/report.md\n');
  });

  it('translates "Failed to save report locally" to PT-BR', () => {
    setLocale('pt-br');
    const msg = __('Failed to save report locally: {{msg}}', { msg: 'disk full' });
    expect(msg).toBe('Falha ao salvar relatório localmente: disk full');
  });

  it('translates "Cloud upload failed" to PT-BR', () => {
    setLocale('pt-br');
    const msg = __('Cloud upload failed: {{msg}}\n', { msg: 'network timeout' });
    expect(msg).toBe('Falha no upload para a nuvem: network timeout\n');
  });

  it('translates "SonarQube export save failed" to PT-BR', () => {
    setLocale('pt-br');
    const msg = __('SonarQube export save failed: {{error}}\n', { error: 'disk full' });
    expect(msg).toBe('Falha ao salvar exportação do SonarQube: disk full\n');
  });
});

describe('google-drive-auth translations', () => {
  it('translates "Opening browser for Google OAuth authorization" to PT-BR', () => {
    setLocale('pt-br');
    expect(__('\nOpening browser for Google OAuth authorization...\n')).toBe(
      '\nAbrindo navegador para autorização Google OAuth...\n',
    );
  });

  it('translates "If the browser does not open" message to PT-BR with URL', () => {
    setLocale('pt-br');
    const url = 'https://accounts.google.com/o/oauth2/auth?client_id=123';
    const msg = __(
      '\nIf the browser does not open, visit:\n  {{authUrl}}\n\n',
      { authUrl: url },
    );
    expect(msg).toBe(`\nSe o navegador não abrir, acesse:\n  ${url}\n\n`);
  });
});

describe('all new keys fall back to English when locale is EN', () => {
  it('returns English text unchanged for all new keys in EN locale', () => {
    setLocale('en');
    expect(__('Starting Google OAuth 2.0 authorization flow...\n')).toBe(
      'Starting Google OAuth 2.0 authorization flow...\n',
    );
    expect(__('Setup cancelled.\n')).toBe('Setup cancelled.\n');
    expect(__('Fetching Google Drive folders...\n')).toBe('Fetching Google Drive folders...\n');
    expect(__('\nOpening browser for Google OAuth authorization...\n')).toBe(
      '\nOpening browser for Google OAuth authorization...\n',
    );
    expect(__('Cloud upload failed: {{msg}}\n', { msg: 'err' })).toBe(
      'Cloud upload failed: err\n',
    );
    expect(__('Report saved [{{provider}}]: {{url}}\n', { provider: 'local', url: '/r' })).toBe(
      'Report saved [local]: /r\n',
    );
  });
});
