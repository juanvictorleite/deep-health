/**
 * PT-BR translation coverage for CLI output strings added in slice4:
 * fix, report-saver
 */
import { __, setLocale } from '@core/i18n';
import { describe, it, expect, beforeEach } from 'vitest';


beforeEach(() => {
  setLocale('en');
});

describe('config-not-found translations', () => {
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

  it('translates "SonarQube export save failed" to PT-BR', () => {
    setLocale('pt-br');
    const msg = __('SonarQube export save failed: {{error}}\n', { error: 'disk full' });
    expect(msg).toBe('Falha ao salvar exportação do SonarQube: disk full\n');
  });
});

describe('all slice4 keys fall back to English when locale is EN', () => {
  it('returns English text unchanged for all slice4 keys in EN locale', () => {
    setLocale('en');
    expect(__('Report saved [{{provider}}]: {{url}}\n', { provider: 'local', url: '/r' })).toBe(
      'Report saved [local]: /r\n',
    );
    expect(__('Failed to save report locally: {{msg}}', { msg: 'disk full' })).toBe(
      'Failed to save report locally: disk full',
    );
    expect(__('SonarQube export save failed: {{error}}\n', { error: 'err' })).toBe(
      'SonarQube export save failed: err\n',
    );
  });
});
