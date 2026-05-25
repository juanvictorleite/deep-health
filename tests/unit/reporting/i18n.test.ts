/**
 * Tests for src/reporting/i18n — getLocale, buildLocale
 * Covers all branches in loader.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getLocale } from '@reporting/i18n/index';
import { buildLocale } from '@reporting/i18n/loader';
import { setLocale } from '@core/i18n';

beforeEach(() => {
  setLocale('en');
});

afterEach(() => {
  setLocale('en');
});

describe('getLocale()', () => {
  let savedLang: string | undefined;
  let savedLcAll: string | undefined;
  let savedLcMessages: string | undefined;
  let savedLanguage: string | undefined;

  beforeEach(() => {
    // Pin system locale to pt-BR so the default-parameter test is deterministic
    savedLang = process.env['LANG'];
    savedLcAll = process.env['LC_ALL'];
    savedLcMessages = process.env['LC_MESSAGES'];
    savedLanguage = process.env['LANGUAGE'];
    delete process.env['LC_ALL'];
    delete process.env['LC_MESSAGES'];
    delete process.env['LANGUAGE'];
    process.env['LANG'] = 'pt_BR.UTF-8';
  });

  afterEach(() => {
    // Restore original env
    if (savedLang === undefined) delete process.env['LANG'];
    else process.env['LANG'] = savedLang;
    if (savedLcAll === undefined) delete process.env['LC_ALL'];
    else process.env['LC_ALL'] = savedLcAll;
    if (savedLcMessages === undefined) delete process.env['LC_MESSAGES'];
    else process.env['LC_MESSAGES'] = savedLcMessages;
    if (savedLanguage === undefined) delete process.env['LANGUAGE'];
    else process.env['LANGUAGE'] = savedLanguage;
  });

  it('returns pt-br locale by default when system locale is pt-br', () => {
    const locale = getLocale();
    expect(locale).toBeDefined();
    expect(locale.months).toHaveLength(12);
  });

  it('returns en locale when requested', () => {
    const locale = getLocale('en');
    expect(locale).toBeDefined();
    expect(typeof locale.exec.report_title).toBe('string');
  });

  it('returns pt-br locale when explicitly requested', () => {
    const locale = getLocale('pt-br');
    expect(locale).toBeDefined();
  });

  it('returns PT-BR translations for pt-br locale', () => {
    const locale = getLocale('pt-br');
    expect(locale.exec.report_title).toBe('Relatório de Segurança');
    expect(locale.months[0]).toBe('Janeiro');
  });

  it('returns English text for en locale', () => {
    const locale = getLocale('en');
    expect(locale.exec.report_title).toBe('Security Report');
    expect(locale.months[0]).toBe('January');
  });

  it('restores previous locale after getLocale() returns', () => {
    setLocale('en');
    getLocale('pt-br');
    // After getLocale, the active locale should be restored to 'en'
    import('@core/i18n').then(({ getActiveLocale }) => {
      expect(getActiveLocale()).toBe('en');
    });
  });
});

describe('buildLocale() — English locale', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('returns a Locale with 12 months', () => {
    const locale = buildLocale();
    expect(locale.months).toHaveLength(12);
  });

  it('months are English names', () => {
    const locale = buildLocale();
    expect(locale.months[0]).toBe('January');
    expect(locale.months[11]).toBe('December');
  });

  it('pkg_count uses singular template when pkgCount=1', () => {
    const locale = buildLocale();
    const result = locale.pkg_count(1, 1, 'npm');
    expect(result).toContain('1');
    expect(result).toContain('npm');
    expect(result).toContain('package');
    // should NOT contain "packages"
    expect(result).not.toMatch(/packages[^)]/);
  });

  it('pkg_count uses plural template when pkgCount>1', () => {
    const locale = buildLocale();
    const result = locale.pkg_count(3, 2, 'npm');
    expect(result).toContain('3');
    expect(result).toContain('2');
    expect(result).toContain('packages');
  });

  it('pkg_count appends names suffix when names is provided', () => {
    const locale = buildLocale();
    const result = locale.pkg_count(1, 1, 'npm', 'lodash');
    expect(result).toContain(': lodash');
  });

  it('pkg_count has no suffix when names is omitted', () => {
    const locale = buildLocale();
    const result = locale.pkg_count(1, 1, 'npm');
    expect(result).not.toContain(': ');
  });

  it('reason.major_bump interpolates version', () => {
    const locale = buildLocale();
    expect(locale.reason.major_bump('2.0.0')).toContain('2.0.0');
  });

  it('reason.protected_constraint interpolates constraint', () => {
    const locale = buildLocale();
    expect(locale.reason.protected_constraint('^1.0.0')).toContain('^1.0.0');
  });

  it('reason.no_safe_version is a string', () => {
    const locale = buildLocale();
    expect(typeof locale.reason.no_safe_version).toBe('string');
    expect(locale.reason.no_safe_version).toBe('No upstream fix available');
  });

  it('reason.major_bump_generic is a string', () => {
    const locale = buildLocale();
    expect(typeof locale.reason.major_bump_generic).toBe('string');
  });

  it('status fields are strings', () => {
    const locale = buildLocale();
    expect(locale.status.no_fix).toBe('pending (no fix available)');
    expect(locale.status.needs_auth).toBe('pending (authorization required)');
    expect(locale.status.pending).toBe('pending');
  });

  it('exec.scan_summary interpolates total and ecoLabels', () => {
    const locale = buildLocale();
    const result = locale.exec.scan_summary(5, 'npm, composer');
    expect(result).toContain('5');
    expect(result).toContain('npm, composer');
  });

  it('exec.scan_after_summary_generic interpolates total and ecoLabels', () => {
    const locale = buildLocale();
    const result = locale.exec.scan_after_summary_generic(2, 'npm');
    expect(result).toContain('2');
    expect(result).toContain('npm');
  });

  it('exec.ecosystem_evidence_title interpolates ecoLabel', () => {
    const locale = buildLocale();
    const result = locale.exec.ecosystem_evidence_title('npm');
    expect(result).toContain('npm');
  });

  it('exec.fixed_version interpolates version', () => {
    const locale = buildLocale();
    expect(locale.exec.fixed_version('1.2.3')).toContain('1.2.3');
  });

  it('exec.sonarqube_quality_gate interpolates status', () => {
    const locale = buildLocale();
    expect(locale.exec.sonarqube_quality_gate('OK')).toContain('OK');
  });

  it('exec.sonarqube_issue_count interpolates n', () => {
    const locale = buildLocale();
    expect(locale.exec.sonarqube_issue_count(7)).toContain('7');
  });

  it('exec.sonarqube_warning interpolates message', () => {
    const locale = buildLocale();
    expect(locale.exec.sonarqube_warning('scan failed')).toContain('scan failed');
  });

  it('exec.advisor_header interpolates name', () => {
    const locale = buildLocale();
    expect(locale.exec.advisor_header('npm-audit')).toContain('npm-audit');
  });

  it('exec.advisor_output interpolates output', () => {
    const locale = buildLocale();
    expect(locale.exec.advisor_output('some output')).toContain('some output');
  });

  it('exec.validation_verified interpolates label and detail', () => {
    const locale = buildLocale();
    expect(locale.exec.validation_verified('tests', 'passed')).toContain('tests');
    expect(locale.exec.validation_verified('tests', 'passed')).toContain('passed');
  });

  it('exec.sonarqube_metric_labels contains expected keys', () => {
    const locale = buildLocale();
    expect(locale.exec.sonarqube_metric_labels).toBeDefined();
    expect(locale.exec.sonarqube_metric_labels!['alert_status']).toBe('Quality Gate Status');
    expect(locale.exec.sonarqube_metric_labels!['bugs']).toBe('Bugs');
  });

  it('exec static string fields are populated', () => {
    const locale = buildLocale();
    expect(locale.exec.report_title).toBe('Security Report');
    expect(locale.exec.label_client).toBe('Client');
    expect(locale.exec.label_project).toBe('Project');
    expect(locale.exec.sonarqube_report_qg_passed).toBe('PASSED');
    expect(locale.exec.sonarqube_report_qg_failed).toBe('FAILED');
  });
});

describe('buildLocale() — PT-BR locale', () => {
  beforeEach(() => {
    setLocale('pt-br');
  });

  it('returns a Locale with 12 Portuguese month names', () => {
    const locale = buildLocale();
    expect(locale.months).toHaveLength(12);
    expect(locale.months[0]).toBe('Janeiro');
    expect(locale.months[11]).toBe('Dezembro');
  });

  it('exec.report_title is translated', () => {
    const locale = buildLocale();
    expect(locale.exec.report_title).toBe('Relatório de Segurança');
  });

  it('reason.no_safe_version is translated', () => {
    const locale = buildLocale();
    expect(locale.reason.no_safe_version).toBe('Sem correção disponível upstream');
  });

  it('status.no_fix is translated', () => {
    const locale = buildLocale();
    expect(locale.status.no_fix).toBe('pendente (sem correção disponível)');
  });

  it('pkg_count singular template is translated', () => {
    const locale = buildLocale();
    const result = locale.pkg_count(1, 1, 'npm');
    expect(result).toContain('pacote');
  });

  it('pkg_count plural template is translated', () => {
    const locale = buildLocale();
    const result = locale.pkg_count(3, 2, 'npm');
    expect(result).toContain('pacotes');
  });

  it('exec.fixed_version is translated and interpolates version', () => {
    const locale = buildLocale();
    const result = locale.exec.fixed_version('2.0.0');
    expect(result).toContain('corrigido');
    expect(result).toContain('2.0.0');
  });

  it('exec.sonarqube_metric_labels contains translated keys', () => {
    const locale = buildLocale();
    expect(locale.exec.sonarqube_metric_labels!['alert_status']).toBe('Status do Quality Gate');
    expect(locale.exec.sonarqube_metric_labels!['coverage']).toBe('Cobertura');
  });

  it('exec.sonarqube_report_qg_passed is translated', () => {
    const locale = buildLocale();
    expect(locale.exec.sonarqube_report_qg_passed).toBe('APROVADO');
  });

  it('exec.sonarqube_report_qg_failed is translated', () => {
    const locale = buildLocale();
    expect(locale.exec.sonarqube_report_qg_failed).toBe('REPROVADO');
  });
});
