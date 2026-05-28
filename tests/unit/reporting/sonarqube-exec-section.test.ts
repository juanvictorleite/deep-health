/**
 * Unit tests for src/reporting/sonarqube-exec-section.ts
 * Covers: metricsFilter parameter — default filtering, custom filter,
 * no filter (backward compat), and empty filter.
 */
import { describe, it, expect } from 'vitest';
import { buildSonarQubeExecSection } from '@reporting/sonarqube-exec-section';
import type { ScanResultJson } from '@core/types/scan';
import { DEFAULT_SONAR_REPORT_METRICS } from '@core/types/config';

// Minimal ExecLocale stub
const stubLocale = {
  sonarqube_conditions: 'Conditions',
  sonarqube_issues_by_file: 'Issues by file',
  sonarqube_no_issues: 'No issues',
  sonarqube_issue_count: (n: number) => `${n} issue(s)`,
  sonarqube_quality_gate: (s: string) => `Quality Gate: ${s}`,
  sonarqube_warning: (msg: string) => `Warning: ${msg}`,
  sonarqube_metric_labels: {
    bugs: 'Bugs',
    vulnerabilities: 'Vulnerabilities',
    security_hotspots: 'Security Hotspots',
    coverage: 'Coverage',
    code_smells: 'Code Smells',
    duplicated_lines_density: 'Duplicated Lines (%)',
  } as Record<string, string>,
} as Parameters<typeof buildSonarQubeExecSection>[1];

/** Build a success-status SonarQube ScanResultJson with the given metrics */
function makeSonarResult(metrics: Record<string, string>): ScanResultJson {
  return {
    agent: 'sonarqube',
    status: 'success',
    environment: 'local',
    ecosystems: {},
    error: null,
    metadata: {
      qualityGateStatus: 'OK',
      qualityGatePassed: true,
      qualityGateConditions: [],
      metrics,
      issues: [],
    },
  };
}

const allSixMetrics: Record<string, string> = {
  bugs: '3',
  vulnerabilities: '1',
  security_hotspots: '2',
  coverage: '85.4',
  code_smells: '42',
  duplicated_lines_density: '5.2',
};

describe('buildSonarQubeExecSection() — metricsFilter', () => {
  describe('backward compatibility — no filter (3rd param omitted)', () => {
    it('returns all metrics when metricsFilter is omitted', () => {
      const result = buildSonarQubeExecSection(
        { sonarqube: makeSonarResult(allSixMetrics) },
        stubLocale,
      );
      expect(result.present).toBe(true);
      expect(result.metrics).not.toBeNull();
      // All 6 metrics should be present
      const keys = result.metrics!.map((m) => m.key);
      expect(keys).toContain('Bugs');
      expect(keys).toContain('Code Smells');
      expect(keys).toContain('Duplicated Lines (%)');
      expect(result.metrics).toHaveLength(6);
    });
  });

  describe('default filter (DEFAULT_SONAR_REPORT_METRICS)', () => {
    it('excludes code_smells and duplicated_lines_density when using the default filter', () => {
      const result = buildSonarQubeExecSection(
        { sonarqube: makeSonarResult(allSixMetrics) },
        stubLocale,
        [...DEFAULT_SONAR_REPORT_METRICS],
      );
      expect(result.present).toBe(true);
      expect(result.metrics).not.toBeNull();
      const rawKeys = result.metrics!.map((m) => m.key);
      // default filter has 4 keys: bugs, vulnerabilities, security_hotspots, coverage
      expect(result.metrics).toHaveLength(4);
      expect(rawKeys).toContain('Bugs');
      expect(rawKeys).toContain('Vulnerabilities');
      expect(rawKeys).toContain('Security Hotspots');
      expect(rawKeys).toContain('Coverage');
      // these two should NOT appear
      expect(rawKeys).not.toContain('Code Smells');
      expect(rawKeys).not.toContain('Duplicated Lines (%)');
    });
  });

  describe('custom filter', () => {
    it('includes only the specified metric keys', () => {
      const result = buildSonarQubeExecSection(
        { sonarqube: makeSonarResult(allSixMetrics) },
        stubLocale,
        ['bugs', 'coverage'],
      );
      expect(result.metrics).toHaveLength(2);
      const rawKeys = result.metrics!.map((m) => m.key);
      expect(rawKeys).toContain('Bugs');
      expect(rawKeys).toContain('Coverage');
      expect(rawKeys).not.toContain('Vulnerabilities');
      expect(rawKeys).not.toContain('Code Smells');
    });

    it('returns only matching metrics when filter is a subset', () => {
      const result = buildSonarQubeExecSection(
        { sonarqube: makeSonarResult(allSixMetrics) },
        stubLocale,
        ['security_hotspots', 'duplicated_lines_density'],
      );
      expect(result.metrics).toHaveLength(2);
      const rawKeys = result.metrics!.map((m) => m.key);
      expect(rawKeys).toContain('Security Hotspots');
      expect(rawKeys).toContain('Duplicated Lines (%)');
    });
  });

  describe('empty filter', () => {
    it('returns empty metrics array when filter is []', () => {
      const result = buildSonarQubeExecSection(
        { sonarqube: makeSonarResult(allSixMetrics) },
        stubLocale,
        [],
      );
      expect(result.metrics).not.toBeNull();
      expect(result.metrics).toHaveLength(0);
    });
  });

  describe('filter with keys not in data', () => {
    it('returns empty when filter keys do not match any metric in the result', () => {
      const result = buildSonarQubeExecSection(
        { sonarqube: makeSonarResult(allSixMetrics) },
        stubLocale,
        ['ncloc', 'sqale_index'],
      );
      expect(result.metrics).toHaveLength(0);
    });
  });

  describe('absent engineResults / skipped / error — filter has no effect', () => {
    it('returns present:false when engineResults is undefined', () => {
      const result = buildSonarQubeExecSection(undefined, stubLocale, ['bugs']);
      expect(result.present).toBe(false);
      expect(result.metrics).toBeNull();
    });

    it('returns skipped when sonar status is skipped', () => {
      const skipped: ScanResultJson = {
        agent: 'sonarqube', status: 'skipped', environment: 'local', ecosystems: {}, error: null,
      };
      const result = buildSonarQubeExecSection({ sonarqube: skipped }, stubLocale, ['bugs']);
      expect(result.skipped).toBe(true);
      expect(result.metrics).toBeNull();
    });
  });
});

describe('generateSonarQubeHtmlReport() — metricsFilter', () => {
  // Lazy import inside describe to avoid circular at module-level if needed
  it('filters metrics in the HTML output when metricsFilter is provided', async () => {
    const { generateSonarQubeHtmlReport } = await import('@reporting/sonarqube-report');
    const sonarResult = makeSonarResult(allSixMetrics);
    const html = generateSonarQubeHtmlReport(
      { sonarqube: sonarResult },
      'Acme',
      'Proj',
      'en',
      ['bugs', 'coverage'],
    );
    expect(typeof html).toBe('string');
    // The key text for these two should appear
    expect(html).toContain('bugs');
    expect(html).toContain('coverage');
  });

  it('shows all metrics when metricsFilter is omitted (backward compat)', async () => {
    const { generateSonarQubeHtmlReport } = await import('@reporting/sonarqube-report');
    const sonarResult = makeSonarResult(allSixMetrics);
    const html = generateSonarQubeHtmlReport(
      { sonarqube: sonarResult },
      'Acme',
      'Proj',
      'en',
    );
    expect(typeof html).toBe('string');
    expect(html).toContain('code_smells');
    expect(html).toContain('duplicated_lines_density');
  });

  it('returns null metrics section when metricsFilter is [] (empty)', async () => {
    const { generateSonarQubeHtmlReport } = await import('@reporting/sonarqube-report');
    const sonarResult = makeSonarResult(allSixMetrics);
    const html = generateSonarQubeHtmlReport(
      { sonarqube: sonarResult },
      'Acme',
      'Proj',
      'en',
      [],
    );
    // HTML is generated; metrics section has no rows
    expect(typeof html).toBe('string');
    // The raw metric keys should not appear when filter is empty
    expect(html).not.toContain('>bugs<');
    expect(html).not.toContain('>code_smells<');
  });

  it('excludes code_smells and duplicated_lines_density with default filter', async () => {
    const { generateSonarQubeHtmlReport } = await import('@reporting/sonarqube-report');
    const sonarResult = makeSonarResult(allSixMetrics);
    const html = generateSonarQubeHtmlReport(
      { sonarqube: sonarResult },
      'Acme',
      'Proj',
      'en',
      [...DEFAULT_SONAR_REPORT_METRICS],
    );
    expect(typeof html).toBe('string');
    // code_smells and duplicated_lines_density should not appear as data cells
    expect(html).not.toContain('>code_smells<');
    expect(html).not.toContain('>duplicated_lines_density<');
  });
});
