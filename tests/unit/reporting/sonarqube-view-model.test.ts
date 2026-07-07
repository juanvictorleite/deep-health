/**
 * Unit tests for src/reporting/sonarqube-view-model.ts (ADR 0016).
 *
 * Exercises buildSonarQubeViewModel() directly — quality gate/metrics/issue
 * normalization and skip/error state handling — with no template rendering
 * involved. These are regression pins for the current behavior of
 * generateSonarQubeHtmlReport, buildSonarQubeExecSection and buildSonarQubeExport.
 */
import type { ScanResultJson } from '@core/types/scan';
import { buildSonarQubeViewModel } from '@reporting/sonarqube-view-model';
import { describe, expect, it } from 'vitest';

function makeResult(overrides: Partial<ScanResultJson> = {}): ScanResultJson {
  return {
    agent: 'sonarqube',
    status: 'success',
    environment: 'local',
    ecosystems: {},
    error: null,
    ...overrides,
  };
}

describe('buildSonarQubeViewModel() — absence/skip/error states', () => {
  it('returns state "absent" when engineResults is undefined', () => {
    const vm = buildSonarQubeViewModel({ engineResults: undefined });
    expect(vm.state).toBe('absent');
  });

  it('returns state "absent" when the sonarqube key is missing', () => {
    const vm = buildSonarQubeViewModel({ engineResults: {} });
    expect(vm.state).toBe('absent');
  });

  it('returns state "skipped" when status is skipped', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ status: 'skipped' }) },
    });
    expect(vm.state).toBe('skipped');
  });

  it('returns state "error" with agent, rawStatus and error message on error status', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ status: 'error', error: 'scan failed' }) },
    });
    expect(vm.state).toBe('error');
    if (vm.state !== 'error') throw new Error('expected error state');
    expect(vm.agent).toBe('sonarqube');
    expect(vm.rawStatus).toBe('error');
    expect(vm.error).toBe('scan failed');
  });

  it('preserves a null error message verbatim on error status (no fallback text applied here)', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ status: 'error', error: null }) },
    });
    if (vm.state !== 'error') throw new Error('expected error state');
    expect(vm.error).toBeNull();
  });
});

describe('buildSonarQubeViewModel() — success state with no metadata', () => {
  it('normalizes all fields to empty/null when metadata is absent', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ status: 'success' }) },
    });
    expect(vm.state).toBe('success');
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.qualityGate).toBeNull();
    expect(vm.metrics).toBeNull();
    expect(vm.rawMetrics).toBeNull();
    expect(vm.issueGroups).toEqual([]);
    expect(vm.totalIssues).toBe(0);
    expect(vm.hasIssues).toBe(false);
    expect(vm.noIssues).toBe(false);
    expect(vm.issuesWithFile).toBeNull();
  });
});

describe('buildSonarQubeViewModel() — quality gate normalization', () => {
  it('is null when qualityGateStatus is absent', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ metadata: { qualityGateStatus: undefined as unknown as string, qualityGatePassed: false } }) },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.qualityGate).toBeNull();
  });

  it.each([
    ['OK', true],
    ['ERROR', false],
    ['WARN', false],
  ])('carries raw status %s and passed=%s verbatim', (status, passed) => {
    const vm = buildSonarQubeViewModel({
      engineResults: {
        sonarqube: makeResult({
          metadata: { qualityGateStatus: status, qualityGatePassed: passed },
        }),
      },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.qualityGate?.status).toBe(status);
    expect(vm.qualityGate?.passed).toBe(passed);
  });

  it('preserves an undefined qualityGatePassed rather than defaulting it', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: {
        sonarqube: makeResult({
          metadata: { qualityGateStatus: 'OK', qualityGatePassed: undefined as unknown as boolean },
        }),
      },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.qualityGate?.passed).toBeUndefined();
  });
});

describe('buildSonarQubeViewModel() — condition normalization', () => {
  it.each([
    ['OK', '✅', true],
    ['ERROR', '❌', false],
    ['WARN', '⚠️', false],
  ])('condition status %s maps to icon %s and isOk=%s', (status, icon, isOk) => {
    const vm = buildSonarQubeViewModel({
      engineResults: {
        sonarqube: makeResult({
          metadata: {
            qualityGateStatus: 'OK',
            qualityGatePassed: true,
            qualityGateConditions: [{ status, metricKey: 'coverage', comparator: 'LT' }],
          },
        }),
      },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    const condition = vm.qualityGate?.conditions[0];
    expect(condition?.statusIcon).toBe(icon);
    expect(condition?.isOk).toBe(isOk);
  });

  it('falls back to "—" for missing errorThreshold and actualValue', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: {
        sonarqube: makeResult({
          metadata: {
            qualityGateStatus: 'ERROR',
            qualityGatePassed: false,
            qualityGateConditions: [{ status: 'ERROR', metricKey: 'bugs', comparator: 'GT' }],
          },
        }),
      },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.qualityGate?.conditions[0]).toMatchObject({ errorThreshold: '—', actualValue: '—' });
  });

  it('exposes the untouched raw conditions array alongside the normalized view', () => {
    const rawCondition = { status: 'OK', metricKey: 'coverage', comparator: 'LT', errorThreshold: '80', actualValue: '90' };
    const vm = buildSonarQubeViewModel({
      engineResults: {
        sonarqube: makeResult({
          metadata: { qualityGateStatus: 'OK', qualityGatePassed: true, qualityGateConditions: [rawCondition] },
        }),
      },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.qualityGate?.rawConditions).toEqual([rawCondition]);
  });

  it('defaults to an empty conditions array when qualityGateConditions is absent', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ metadata: { qualityGateStatus: 'OK', qualityGatePassed: true } }) },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.qualityGate?.conditions).toEqual([]);
    expect(vm.qualityGate?.rawConditions).toEqual([]);
  });
});

describe('buildSonarQubeViewModel() — metrics normalization', () => {
  const allMetrics = { bugs: '3', coverage: '85.4', code_smells: '42' };

  it('includes all metrics with raw keys when metricsFilter is omitted', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ metadata: { qualityGateStatus: 'OK', qualityGatePassed: true, metrics: allMetrics } }) },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.metrics).toEqual([
      { key: 'bugs', value: '3' },
      { key: 'coverage', value: '85.4' },
      { key: 'code_smells', value: '42' },
    ]);
  });

  it('filters metrics by metricsFilter, preserving raw keys', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ metadata: { qualityGateStatus: 'OK', qualityGatePassed: true, metrics: allMetrics } }) },
      metricsFilter: ['bugs'],
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.metrics).toEqual([{ key: 'bugs', value: '3' }]);
  });

  it('returns an empty array when metricsFilter is []', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ metadata: { qualityGateStatus: 'OK', qualityGatePassed: true, metrics: allMetrics } }) },
      metricsFilter: [],
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.metrics).toEqual([]);
  });

  it('exposes the untouched rawMetrics map, ignoring metricsFilter (export needs the full map)', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ metadata: { qualityGateStatus: 'OK', qualityGatePassed: true, metrics: allMetrics } }) },
      metricsFilter: ['bugs'],
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.rawMetrics).toEqual(allMetrics);
  });

  it('rawMetrics is null when metadata.metrics is absent', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ metadata: { qualityGateStatus: 'OK', qualityGatePassed: true } }) },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.rawMetrics).toBeNull();
  });
});

describe('buildSonarQubeViewModel() — issue grouping and severity normalization', () => {
  it('groups issues by file, extracting the path after the first colon in component', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: {
        sonarqube: makeResult({
          metadata: {
            qualityGateStatus: 'OK',
            qualityGatePassed: true,
            issues: [
              { key: 'k1', rule: 'r1', severity: 'MAJOR', component: 'my-project:src/a.ts', message: 'm1', type: 'BUG', status: 'OPEN', line: 10 },
              { key: 'k2', rule: 'r2', severity: 'MINOR', component: 'src/b.ts', message: 'm2', type: 'CODE_SMELL', status: 'OPEN' },
            ],
          },
        }),
      },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.issueGroups).toHaveLength(2);
    expect(vm.issueGroups[0]).toMatchObject({ file: 'src/a.ts' });
    expect(vm.issueGroups[1]).toMatchObject({ file: 'src/b.ts' });
  });

  it('formats a defined line as a string and falls back to "—" when line is absent', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: {
        sonarqube: makeResult({
          metadata: {
            qualityGateStatus: 'OK',
            qualityGatePassed: true,
            issues: [
              { key: 'k1', rule: 'r1', severity: 'MAJOR', component: 'src/a.ts', message: 'm1', type: 'BUG', status: 'OPEN', line: 42 },
              { key: 'k2', rule: 'r2', severity: 'MAJOR', component: 'src/c.ts', message: 'm2', type: 'BUG', status: 'OPEN' },
            ],
          },
        }),
      },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.issueGroups[0]?.issues[0]?.line).toBe('42');
    expect(vm.issueGroups[1]?.issues[0]?.line).toBe('—');
  });

  it.each([
    ['BLOCKER', 'critical', '🔴'],
    ['CRITICAL', 'critical', '🔴'],
    ['MAJOR', 'major', '🟠'],
    ['MINOR', 'minor', '🟡'],
    ['INFO', 'info', '🔵'],
    ['UNKNOWN', 'unknown', '⚪'],
  ])('severity %s maps to class %s and icon %s', (severity, cssClass, icon) => {
    const vm = buildSonarQubeViewModel({
      engineResults: {
        sonarqube: makeResult({
          metadata: {
            qualityGateStatus: 'OK',
            qualityGatePassed: true,
            issues: [{ key: 'k1', rule: 'r1', severity, component: 'src/a.ts', message: 'm1', type: 'BUG', status: 'OPEN' }],
          },
        }),
      },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    const issue = vm.issueGroups[0]?.issues[0];
    expect(issue?.severityClass).toBe(cssClass);
    expect(issue?.severityIcon).toBe(icon);
  });

  it('totalIssues, hasIssues and noIssues reflect a non-empty issues array', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: {
        sonarqube: makeResult({
          metadata: {
            qualityGateStatus: 'OK',
            qualityGatePassed: true,
            issues: [{ key: 'k1', rule: 'r1', severity: 'MAJOR', component: 'src/a.ts', message: 'm1', type: 'BUG', status: 'OPEN' }],
          },
        }),
      },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.totalIssues).toBe(1);
    expect(vm.hasIssues).toBe(true);
    expect(vm.noIssues).toBe(false);
  });

  it('noIssues is true only when issues is defined and empty (not when issues is entirely absent)', () => {
    const withEmptyIssues = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ metadata: { qualityGateStatus: 'OK', qualityGatePassed: true, issues: [] } }) },
    });
    const withAbsentIssues = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ metadata: { qualityGateStatus: 'OK', qualityGatePassed: true } }) },
    });
    if (withEmptyIssues.state !== 'success' || withAbsentIssues.state !== 'success') throw new Error('expected success state');
    expect(withEmptyIssues.noIssues).toBe(true);
    expect(withEmptyIssues.hasIssues).toBe(false);
    expect(withAbsentIssues.noIssues).toBe(false);
    expect(withAbsentIssues.hasIssues).toBe(false);
  });

  it('exposes issuesWithFile as the untouched raw issue plus a derived file field, for the export surface', () => {
    const rawIssue = { key: 'k1', rule: 'r1', severity: 'MAJOR', component: 'my-project:src/a.ts', message: 'm1', type: 'BUG', status: 'OPEN', line: 7 };
    const vm = buildSonarQubeViewModel({
      engineResults: {
        sonarqube: makeResult({
          metadata: { qualityGateStatus: 'OK', qualityGatePassed: true, issues: [rawIssue] },
        }),
      },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.issuesWithFile).toEqual([{ ...rawIssue, file: 'src/a.ts' }]);
  });

  it('issuesWithFile is null when metadata.issues is absent', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ metadata: { qualityGateStatus: 'OK', qualityGatePassed: true } }) },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.issuesWithFile).toBeNull();
  });
});

describe('buildSonarQubeViewModel() — error field passthrough on success state', () => {
  it('carries a stray error string through on a success status (export surface passes it through verbatim)', () => {
    const vm = buildSonarQubeViewModel({
      engineResults: { sonarqube: makeResult({ status: 'success', error: 'residual warning' }) },
    });
    if (vm.state !== 'success') throw new Error('expected success state');
    expect(vm.error).toBe('residual warning');
  });
});
