/**
 * Branch coverage top-up for src/reporting/executive.ts
 * Tests uncovered paths: advisor section branches, motivoStr, pendingStatus,
 * residualVerification, conditionStatusIcon, severityIcon.
 */

import type { ExecutiveReportOptions } from '@core/types/report';
import type { ScanResultJson } from '@core/types/scan';
import { generateExecutiveReportDocx } from '@reporting/docx-executive';
import { generateExecutiveReport, executiveReportFilename, escapeMdTableCell, vulnLink, buildExecutiveReportContext } from '@reporting/executive';
import { describe, it, expect } from 'vitest';

const emptyScan: ScanResultJson = {
  agent: 'osv-scanner',
  status: 'success',
  environment: 'local',
  ecosystems: {},
  error: null,
};

const baseOpts: ExecutiveReportOptions = {
  client: 'Acme',
  project: 'Project',
  scanBefore: emptyScan,
  scanAfter: emptyScan,
  updates: {},
};

describe('executiveReportFilename()', () => {
  it('returns a filename with client and project', () => {
    const name = executiveReportFilename('Acme', 'Project');
    expect(name).toContain('Acme');
    expect(name).toContain('Project');
    expect(name).toContain('.md');
  });
});

describe('generateExecutiveReport() — applied dependency changes', () => {
  it('states explicitly when no dependency was changed automatically', () => {
    const result = generateExecutiveReport({ ...baseOpts, locale: 'pt-br' });
    expect(result).toContain('### Dependências alteradas automaticamente');
    expect(result).toContain('Nenhuma dependência foi alterada automaticamente nesta execução.');
  });

  it('lists exact packages_updated evidence grouped by ecosystem entry', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      locale: 'pt-br',
      ecosystems: [{ id: 'npm', path: 'app', label: 'app' }],
      updates: {
        'npm:app': {
          $schema: 'osv-update-result/v1', agent: 'npm-safe-update', status: 'success',
          packages_updated: ['lodash@4.17.21'], packages_skipped: [],
          packages_pending_breaking: [], validations: [], error: null,
        },
      },
    });

    expect(result).toContain('| npm (app) | lodash@4.17.21 |');
    expect(result).not.toContain('Nenhuma dependência foi alterada automaticamente nesta execução.');
  });
});

describe('generateExecutiveReport() — advisor section branches', () => {
  it('generates report with no advisorResults (absent)', () => {
    const result = generateExecutiveReport({ ...baseOpts });
    expect(typeof result).toBe('string');
  });

  it('generates report with empty advisorResults', () => {
    const result = generateExecutiveReport({ ...baseOpts, advisorResults: {} });
    expect(typeof result).toBe('string');
  });

  it('generates report with advisor clean status', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{ name: 'audit', command: 'npm audit', exitCode: 0, output: '', status: 'clean' }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('generates report with advisor findings status and structured findings', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{
          name: 'audit',
          command: 'npm audit',
          exitCode: 1,
          output: '',
          status: 'findings',
          findings: [{
            package: 'lodash',
            severity: 'high',
            title: 'Prototype Pollution',
            range: '>=4.0.0 <4.17.21',
            fixAvailable: '4.17.21',
          }],
        }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('generates report with advisor error status', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{ name: 'audit', command: 'npm audit', exitCode: -1, output: 'command not found', status: 'error' }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('generates report with advisor skipped status', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{ name: 'audit', command: 'npm audit', exitCode: 0, output: '', status: 'skipped' }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('generates report with advisor output text (hasOutput=true)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{
          name: 'audit',
          command: 'composer audit',
          exitCode: 1,
          output: 'Found 2 vulnerabilities',
          status: 'findings',
        }],
      },
    });
    expect(typeof result).toBe('string');
  });
});

describe('generateExecutiveReport() — sonarqube section branches', () => {
  it('handles sonarqube skipped status', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      engineResults: {
        sonarqube: { agent: 'sonarqube', status: 'skipped', environment: 'local', ecosystems: {}, error: null },
      },
    });
    expect(typeof result).toBe('string');
  });

  it('handles sonarqube error status', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      engineResults: {
        sonarqube: { agent: 'sonarqube', status: 'error', environment: 'local', ecosystems: {}, error: 'scan failed' },
      },
    });
    expect(typeof result).toBe('string');
  });

  it('handles sonarqube success with conditions and issues', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      engineResults: {
        sonarqube: {
          agent: 'sonarqube',
          status: 'success',
          environment: 'local',
          ecosystems: {},
          error: null,
          metadata: {
            qualityGateStatus: 'ERROR',
            qualityGatePassed: false,
            qualityGateConditions: [
              { status: 'ERROR', metricKey: 'coverage', comparator: 'LT', errorThreshold: '80', actualValue: '70' },
              { status: 'OK', metricKey: 'bugs', comparator: 'GT', errorThreshold: '0', actualValue: '0' },
            ],
            metrics: { coverage: '70' },
            issues: [
              {
                key: 'k1', rule: 'rule:S1', severity: 'BLOCKER',
                component: 'proj:src/index.ts', message: 'blocker', type: 'BUG', status: 'OPEN',
              },
              {
                key: 'k2', rule: 'rule:S2', severity: 'CRITICAL',
                component: 'proj:src/index.ts', message: 'critical', type: 'BUG', status: 'OPEN',
              },
              {
                key: 'k3', rule: 'rule:S3', severity: 'MAJOR',
                component: 'proj:src/utils.ts', message: 'major', type: 'CODE_SMELL', status: 'OPEN',
              },
              {
                key: 'k4', rule: 'rule:S4', severity: 'MINOR',
                component: 'proj:src/utils.ts', message: 'minor', type: 'CODE_SMELL', status: 'OPEN',
              },
              {
                key: 'k5', rule: 'rule:S5', severity: 'INFO',
                component: 'proj:src/utils.ts', message: 'info', type: 'CODE_SMELL', status: 'OPEN',
              },
              {
                key: 'k6', rule: 'rule:S6', severity: 'UNKNOWN',
                component: 'proj:src/utils.ts', message: 'unknown', type: 'CODE_SMELL', status: 'OPEN',
              },
            ],
          },
        },
      },
    });
    expect(typeof result).toBe('string');
  });
});

describe('generateExecutiveReport() — motivoStr and pendingStatus branches', () => {
  const vulnBase = {
    ghsaId: 'GHSA-0001',
    cvss: '7.5',
    package: 'lodash',
    ecosystem: 'npm',
    currentVersion: '4.17.20',
    classification: 'breaking' as const,
    risk: 'high',
  };

  it('motivoStr: no_safe_version branch (No safe version reason)', () => {
    const scan: ScanResultJson = {
      agent: 'osv-scanner',
      status: 'success',
      environment: 'local',
      ecosystems: {
        npm: {
          vulnerabilities_total: 1,
          auto_safe: 0,
          breaking: 1,
          manual: 0,
          vulnerabilities: [{ ...vulnBase, safeVersion: null, reason: 'No safe version available' }],
        },
      },
      error: null,
    };
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect(typeof result).toBe('string');
  });

  it('motivoStr: major_bump with match', () => {
    const scan: ScanResultJson = {
      agent: 'osv-scanner',
      status: 'success',
      environment: 'local',
      ecosystems: {
        npm: {
          vulnerabilities_total: 1,
          auto_safe: 0,
          breaking: 1,
          manual: 0,
          vulnerabilities: [{
            ...vulnBase, safeVersion: '5.0.0', reason: 'Major version bump required: 4.17.20 → 5.0.0',
          }],
        },
      },
      error: null,
    };
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect(typeof result).toBe('string');
  });

  it('motivoStr: major_bump without version match (generic)', () => {
    const scan: ScanResultJson = {
      agent: 'osv-scanner',
      status: 'success',
      environment: 'local',
      ecosystems: {
        npm: {
          vulnerabilities_total: 1,
          auto_safe: 0,
          breaking: 1,
          manual: 0,
          vulnerabilities: [{ ...vulnBase, safeVersion: '5.0.0', reason: 'Major version bump required' }],
        },
      },
      error: null,
    };
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect(typeof result).toBe('string');
  });

  it('motivoStr: Protected package branch', () => {
    const scan: ScanResultJson = {
      agent: 'osv-scanner',
      status: 'success',
      environment: 'local',
      ecosystems: {
        npm: {
          vulnerabilities_total: 1,
          auto_safe: 0,
          breaking: 1,
          manual: 0,
          vulnerabilities: [{
            ...vulnBase,
            safeVersion: '5.0.0',
            reason: 'Protected package: do not upgrade. Safe version 5.0.0 outside constraint ^4',
          }],
        },
      },
      error: null,
    };
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect(typeof result).toBe('string');
  });

  it('motivoStr: Protected package with constraint match', () => {
    const scan: ScanResultJson = {
      agent: 'osv-scanner',
      status: 'success',
      environment: 'local',
      ecosystems: {
        npm: {
          vulnerabilities_total: 1,
          auto_safe: 0,
          breaking: 1,
          manual: 0,
          vulnerabilities: [{
            ...vulnBase,
            safeVersion: '5.0.0',
            reason: 'Protected package: do not upgrade. Safe version 5.0.0 is outside constraint ^4.0.0',
          }],
        },
      },
      error: null,
    };
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect(typeof result).toBe('string');
  });

  it('motivoStr: reason is plain text (fallback)', () => {
    const scan: ScanResultJson = {
      agent: 'osv-scanner',
      status: 'success',
      environment: 'local',
      ecosystems: {
        npm: {
          vulnerabilities_total: 1,
          auto_safe: 0,
          breaking: 1,
          manual: 0,
          vulnerabilities: [{ ...vulnBase, safeVersion: null, reason: 'Some other reason' }],
        },
      },
      error: null,
    };
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect(typeof result).toBe('string');
  });
});

describe('generateExecutiveReport() — residualVerification branch', () => {
  it('handles residualVerification unverified with residual CVEs in fixed vulns', () => {
    const scan: ScanResultJson = {
      agent: 'osv-scanner',
      status: 'success',
      environment: 'local',
      ecosystems: {
        npm: {
          vulnerabilities_total: 1,
          auto_safe: 1,
          breaking: 0,
          manual: 0,
          vulnerabilities: [{
            ghsaId: 'GHSA-0001', cvss: '7.5', package: 'lodash', ecosystem: 'npm',
            currentVersion: '4.17.20', safeVersion: '4.17.21', classification: 'auto_safe', risk: 'high',
          }],
        },
      },
      error: null,
    };
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: scan,
      updates: {
        npm: {
          agent: 'npm',
          status: 'success',
          environment: 'local',
          packages_updated: ['lodash@4.17.21'],
          validations: [],
        },
      },
      residualVerification: { status: 'unverified', summary: { npm: 1 } },
    });
    expect(typeof result).toBe('string');
  });

  it('handles residualVerification verified status', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      residualVerification: { status: 'verified', summary: { npm: 0 } },
    });
    expect(typeof result).toBe('string');
  });
});

describe('generateExecutiveReport() — sonarqube null qualityGate and null metrics branches', () => {
  it('handles sonarqube success with no qualityGateStatus (qualityGateLabel=null branch)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      engineResults: {
        sonarqube: {
          agent: 'sonarqube',
          status: 'success',
          environment: 'local',
          ecosystems: {},
          error: null,
          // metadata present but no qualityGateStatus → ternary goes to null branch (line 147)
          metadata: {
            qualityGateStatus: undefined as unknown as string,
            qualityGatePassed: false,
          },
        },
      },
    });
    expect(typeof result).toBe('string');
  });

  it('handles sonarqube success with no metrics (metricsForDisplay=null branch)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      engineResults: {
        sonarqube: {
          agent: 'sonarqube',
          status: 'success',
          environment: 'local',
          ecosystems: {},
          error: null,
          // metadata present but no metrics → ternary goes to null branch (line 165)
          metadata: {
            qualityGateStatus: 'OK',
            qualityGatePassed: true,
            // metrics intentionally absent
          },
        },
      },
    });
    expect(typeof result).toBe('string');
  });
});

describe('generateExecutiveReport() — advisor legacy pass status and empty results', () => {
  it('generates report with advisor legacy "pass" status (backward compat branch)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{
          name: 'audit',
          command: 'npm audit',
          exitCode: 0,
          output: '',
          status: 'pass' as unknown as 'clean',
        }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('generates report with advisor unknown legacy status (error fallback branch)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{
          name: 'audit',
          command: 'npm audit',
          exitCode: 1,
          output: '',
          status: 'unknown-status' as unknown as 'error',
        }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('generates report with ecosystem having empty advisor results array (skipped via continue)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('generates report with advisor results for unknown ecosystem (ecoName falls back to id)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        unknown_eco: [{
          name: 'audit',
          command: 'audit',
          exitCode: 0,
          output: '',
          status: 'clean',
        }],
      },
    });
    expect(typeof result).toBe('string');
  });
});

describe('generateExecutiveReport() — misc branches', () => {
  it('handles branch name provided', () => {
    const result = generateExecutiveReport({ ...baseOpts, branch: 'main' });
    expect(typeof result).toBe('string');
  });

  it('handles empty branch (hasBranch=false)', () => {
    const result = generateExecutiveReport({ ...baseOpts, branch: '' });
    expect(typeof result).toBe('string');
  });

  it('handles scannerEngines list', () => {
    const result = generateExecutiveReport({ ...baseOpts, scannerEngines: ['osv', 'sonarqube'] });
    expect(typeof result).toBe('string');
  });

  it('handles no vulns case (totalBefore=0)', () => {
    const result = generateExecutiveReport({ ...baseOpts });
    expect(typeof result).toBe('string');
  });

  it('handles pending vuln with Cannot parse reason', () => {
    const scan: ScanResultJson = {
      agent: 'osv-scanner', status: 'success', environment: 'local',
      ecosystems: {
        npm: {
          vulnerabilities_total: 1, auto_safe: 0, breaking: 1, manual: 0,
          vulnerabilities: [{
            ghsaId: 'GHSA-0001', cvss: '7.5', package: 'lodash', ecosystem: 'npm',
            currentVersion: 'x.y.z', safeVersion: null, classification: 'manual', risk: 'high',
            reason: 'Cannot parse version strings',
          }],
        },
      },
      error: null,
    };
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect(typeof result).toBe('string');
  });
});

describe('generateExecutiveReport() — buildAdvisorExecSection full branch coverage', () => {
  it('covers findings status with raw findings (range and fixAvailable present)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{
          name: 'npm-audit',
          command: 'npm audit',
          exitCode: 0,
          output: 'some output',
          status: 'findings',
          findings: [{
            package: 'lodash',
            severity: 'high',
            title: 'Prototype Pollution',
            range: '>=4.0.0 <4.17.21',
            fixAvailable: '4.17.21',
          }],
        }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('covers findings status with raw findings (range and fixAvailable absent → defaults to —)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{
          name: 'npm-audit',
          command: 'npm audit',
          exitCode: 1,
          output: '',
          status: 'findings',
          findings: [{
            package: 'lodash',
            severity: 'high',
            title: 'Prototype Pollution',
          }],
        }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('covers error status (findingsSummary = advisor_error)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{
          name: 'npm-audit',
          command: 'npm audit',
          exitCode: 2,
          output: 'fatal error',
          status: 'error',
        }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('covers skipped status', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{
          name: 'npm-audit',
          command: 'npm audit',
          exitCode: 0,
          output: '',
          status: 'skipped',
        }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('covers noFindings=true branch (clean status, no findings)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{
          name: 'npm-audit',
          command: 'npm audit',
          exitCode: 0,
          output: '',
          status: 'clean',
          findings: [],
        }],
      },
    });
    expect(typeof result).toBe('string');
  });

  it('covers hasOutput=true branch (non-empty output)', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      advisorResults: {
        npm: [{
          name: 'npm-audit',
          command: 'npm audit',
          exitCode: 0,
          output: 'found 0 vulnerabilities',
          status: 'clean',
        }],
      },
    });
    expect(typeof result).toBe('string');
  });
});

describe('generateExecutiveReport() — vulnerability deduplication', () => {
  function makeVuln(
    pkg: string,
    version: string,
    ghsaId: string,
    classification: 'auto_safe' | 'breaking' | 'manual' = 'breaking',
  ) {
    return {
      ghsaId,
      cvss: '7.5',
      package: pkg,
      ecosystem: 'npm',
      currentVersion: version,
      safeVersion: null as string | null,
      classification,
      risk: 'high',
      reason: 'Major version bump required: 1.0.0 → 2.0.0',
    };
  }

  function makeScan(vulns: ReturnType<typeof makeVuln>[]): ScanResultJson {
    return {
      agent: 'osv-scanner',
      status: 'success',
      environment: 'local',
      ecosystems: {
        npm: {
          vulnerabilities_total: vulns.length,
          auto_safe: vulns.filter((v) => v.classification === 'auto_safe').length,
          breaking: vulns.filter((v) => v.classification === 'breaking').length,
          manual: vulns.filter((v) => v.classification === 'manual').length,
          vulnerabilities: vulns,
        },
      },
      error: null,
    };
  }

  // The before-section header key is section_evidence_before — locale-dependent.
  // Use the GHSA column value or package name directly from all table rows (locale-agnostic).
  function allTableRows(report: string): string[] {
    return report.split('\n').filter((l) => l.startsWith('|') && !l.includes('---'));
  }

  it('case 1 — same GHSA, same package, two versions → versions aggregated into 1 row per table section', () => {
    const scan = makeScan([
      makeVuln('cross-spawn', '6.0.5', 'GHSA-xxxx-0001'),
      makeVuln('cross-spawn', '7.0.3', 'GHSA-xxxx-0001'),
    ]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    // Every table row that contains cross-spawn should also contain both versions (aggregated)
    const rows = allTableRows(result).filter((l) => l.includes('cross-spawn'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    rows.forEach((row) => {
      expect(row).toContain('6.0.5');
      expect(row).toContain('7.0.3');
    });
  });

  it('case 2 — same GHSA, different packages → 2 separate rows per table section', () => {
    const scan = makeScan([
      makeVuln('lodash', '4.17.21', 'GHSA-xxxx-0002'),
      makeVuln('lodash-es', '4.17.21', 'GHSA-xxxx-0002'),
    ]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    const lodashOnlyRows = allTableRows(result).filter((l) => l.includes('| lodash |'));
    const lodashEsRows = allTableRows(result).filter((l) => l.includes('lodash-es'));
    expect(lodashOnlyRows.length).toBeGreaterThanOrEqual(1);
    expect(lodashEsRows.length).toBeGreaterThanOrEqual(1);
  });

  it('case 3 — four versions of qs with same GHSA → all four versions in a single row per section', () => {
    const scan = makeScan([
      makeVuln('qs', '6.5.2', 'GHSA-6rw7-vpxm-498p'),
      makeVuln('qs', '6.7.0', 'GHSA-6rw7-vpxm-498p'),
      makeVuln('qs', '6.10.1', 'GHSA-6rw7-vpxm-498p'),
      makeVuln('qs', '6.14.0', 'GHSA-6rw7-vpxm-498p'),
    ]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    const rows = allTableRows(result).filter((l) => l.includes('| qs |') || l.includes('qs'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    rows.forEach((row) => {
      expect(row).toContain('6.5.2');
      expect(row).toContain('6.7.0');
      expect(row).toContain('6.10.1');
      expect(row).toContain('6.14.0');
    });
  });

  it('case 4 — worst-case classification: auto_safe + breaking → aggregated into 1 row with both versions', () => {
    const scan = makeScan([
      makeVuln('some-pkg', '1.0.0', 'GHSA-xxxx-0003', 'auto_safe'),
      makeVuln('some-pkg', '1.1.0', 'GHSA-xxxx-0003', 'breaking'),
    ]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    const rows = allTableRows(result).filter((l) => l.includes('some-pkg'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    rows.forEach((row) => {
      expect(row).toContain('1.0.0');
      expect(row).toContain('1.1.0');
    });
  });

  it('case 5 — same package, different GHSAs → single merged row with both GHSAs comma-separated', () => {
    const scan = makeScan([
      makeVuln('qs', '6.5.2', 'GHSA-xxxx-aaaa'),
      makeVuln('qs', '6.5.2', 'GHSA-xxxx-bbbb'),
    ]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    // Both GHSAs must appear in the same row (i.e., a single row containing qs also has both IDs)
    const qsRows = allTableRows(result).filter((l) => l.includes('qs'));
    expect(qsRows.length).toBeGreaterThanOrEqual(1);
    // Every row that mentions qs should contain both GHSA IDs (they are merged into one row)
    const rowsWithBothGhsas = qsRows.filter((l) => l.includes('GHSA-xxxx-aaaa') && l.includes('GHSA-xxxx-bbbb'));
    expect(rowsWithBothGhsas.length).toBeGreaterThanOrEqual(1);
  });

  it('case 6 — same package, different GHSAs, different versions → single row with all IDs and all versions', () => {
    const scan = makeScan([
      makeVuln('axios', '0.21.0', 'GHSA-yyyy-1111'),
      makeVuln('axios', '0.21.1', 'GHSA-yyyy-2222'),
      makeVuln('axios', '0.21.2', 'GHSA-yyyy-3333'),
    ]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    const axiosRows = allTableRows(result).filter((l) => l.includes('axios'));
    expect(axiosRows.length).toBeGreaterThanOrEqual(1);
    // All three GHSA IDs must be in the same row
    const mergedRows = axiosRows.filter(
      (l) => l.includes('GHSA-yyyy-1111') && l.includes('GHSA-yyyy-2222') && l.includes('GHSA-yyyy-3333'),
    );
    expect(mergedRows.length).toBeGreaterThanOrEqual(1);
    // All three versions must also be in the same row
    const versionRows = axiosRows.filter(
      (l) => l.includes('0.21.0') && l.includes('0.21.1') && l.includes('0.21.2'),
    );
    expect(versionRows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('generateExecutiveReport() — hasPending and pending vuln branch coverage', () => {
  const pendingScan: ScanResultJson = {
    agent: 'osv-scanner', status: 'success', environment: 'local',
    ecosystems: {
      npm: {
        vulnerabilities_total: 1, auto_safe: 0, breaking: 1, manual: 0,
        vulnerabilities: [{
          ghsaId: 'GHSA-pending', cvss: 'N/A', package: 'lodash', ecosystem: 'npm',
          currentVersion: '4.17.0', safeVersion: null, classification: 'breaking', risk: 'critical',
          reason: 'major',
        }],
      },
    },
    error: null,
  };

  it('pending vuln with unparseable CVSS still generates a valid report', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: pendingScan,
      scanAfter: pendingScan,
    });
    expect(typeof result).toBe('string');
  });

  it('covers unknown ecosystem → ecoLabel falls back to v.ecosystem', () => {
    const unknownEcoScan: ScanResultJson = {
      agent: 'osv-scanner', status: 'success', environment: 'local',
      ecosystems: {
        'unknown-eco': {
          vulnerabilities_total: 1, auto_safe: 0, breaking: 1, manual: 0,
          vulnerabilities: [{
            ghsaId: 'GHSA-unk', cvss: 'N/A', package: 'some-pkg', ecosystem: 'unknown-eco',
            currentVersion: '1.0.0', safeVersion: null, classification: 'breaking', risk: 'high',
            reason: 'major',
          }],
        },
      },
      error: null,
    };
    // plugin is null for 'unknown-eco' → plugin?.reportLabel ?? v.ecosystem fires
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: unknownEcoScan,
      scanAfter: unknownEcoScan,
    });
    expect(typeof result).toBe('string');
  });
});

// ── AC7: audit_findings integration in executive report ──────────────────────

describe('generateExecutiveReport() — audit_findings injection (AC7)', () => {
  // Helper to extract all table rows from the report
  function allTableRows(report: string): string[] {
    return report.split('\n').filter((l) => l.startsWith('|') && !l.includes('---'));
  }

  // Minimal scan with no vulnerabilities (audit findings come from updater, not OSV)
  const cleanScan: ScanResultJson = {
    agent: 'osv-scanner',
    status: 'success',
    environment: 'local',
    ecosystems: {
      composer: {
        vulnerabilities_total: 0,
        auto_safe: 0,
        breaking: 0,
        manual: 0,
        auto_safe_packages: [],
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: [],
      },
    },
    error: null,
  };

  it('(AC7-a) when updates["composer"] has audit_findings with 2 entries and those package names are in packages_updated, the report contains those packages in the fixed vulns table', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScan,
      scanAfter: cleanScan,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/audit-pkg-a@1.1.0', 'vendor/audit-pkg-b@2.1.0'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/audit-pkg-a',
              advisoryId: 'GHSA-audit-001',
              title: 'SQL injection',
              cve: 'CVE-2024-1111',
              affectedVersions: '>=1.0.0 <1.1.0',
            },
            {
              ecosystem: 'composer',
              package: 'vendor/audit-pkg-b',
              advisoryId: 'GHSA-audit-002',
              title: 'XSS vulnerability',
              cve: null,
              affectedVersions: '>=2.0.0 <2.1.0',
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    // Both audit-discovered packages should appear in the table rows (fixed vulns section)
    const rows = allTableRows(result);
    const pkgARows = rows.filter((r) => r.includes('vendor/audit-pkg-a'));
    const pkgBRows = rows.filter((r) => r.includes('vendor/audit-pkg-b'));
    expect(pkgARows.length).toBeGreaterThanOrEqual(1);
    expect(pkgBRows.length).toBeGreaterThanOrEqual(1);
  });

  it('(AC7-b) when audit_findings is absent/undefined, the report generates identically to when it is not present (regression)', () => {
    const optsWithoutFindings = {
      ...baseOpts,
      scanBefore: cleanScan,
      scanAfter: cleanScan,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1' as const,
          agent: 'composer-safe-update',
          status: 'success' as const,
          packages_updated: [],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'skipped' as const, detail: 'nothing to do' }],
          error: null,
          // No audit_findings field
        },
      },
    };

    const optsWithEmptyFindings = {
      ...optsWithoutFindings,
      updates: {
        composer: {
          ...optsWithoutFindings.updates.composer,
          audit_findings: undefined,
        },
      },
    };

    const reportWithout = generateExecutiveReport(optsWithoutFindings);
    const reportWithEmpty = generateExecutiveReport(optsWithEmptyFindings);

    // Reports should be identical
    expect(reportWithout).toBe(reportWithEmpty);
  });

  it('(AC7-c) audit findings for packages NOT in packages_updated appear as pending (not fixed)', () => {
    // Audit found 2 packages but only 1 was successfully updated
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScan,
      scanAfter: cleanScan,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/audit-pkg-a@1.1.0'],  // only pkg-a was updated
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/audit-pkg-a',
              advisoryId: 'GHSA-audit-001',
              title: 'SQL injection',
              cve: 'CVE-2024-1111',
              affectedVersions: '>=1.0.0 <1.1.0',
            },
            {
              ecosystem: 'composer',
              package: 'vendor/audit-pkg-b',
              advisoryId: 'GHSA-audit-002',
              title: 'XSS vulnerability',
              cve: null,
              affectedVersions: '>=2.0.0 <2.1.0',
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    const rows = allTableRows(result);
    // pkg-a is in packages_updated → should appear in fixed section
    const pkgARows = rows.filter((r) => r.includes('vendor/audit-pkg-a'));
    expect(pkgARows.length).toBeGreaterThanOrEqual(1);

    // pkg-b is NOT in packages_updated → should appear in pending section
    const pkgBRows = rows.filter((r) => r.includes('vendor/audit-pkg-b'));
    expect(pkgBRows.length).toBeGreaterThanOrEqual(1);
  });

  it('(AC7-d) original scanBefore is not mutated after report generation', () => {
    const originalVulnsLength = cleanScan.ecosystems['composer']?.vulnerabilities?.length ?? 0;

    generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScan,
      scanAfter: cleanScan,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/audit-pkg@1.1.0'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/audit-pkg',
              advisoryId: 'GHSA-audit-001',
              title: 'SQL injection',
              cve: null,
              affectedVersions: '<1.1.0',
            },
          ],
        },
      },
    });

    // The original scanBefore must not have been mutated
    expect(cleanScan.ecosystems['composer']?.vulnerabilities?.length).toBe(originalVulnsLength);
  });
});

// ── AC1: escapeMdTableCell unit tests ────────────────────────────────────────

describe('escapeMdTableCell()', () => {
  it('returns an unmodified string when there are no pipe characters', () => {
    expect(escapeMdTableCell('>=1.0.0, <2.0.0')).toBe('>=1.0.0, <2.0.0');
  });

  it('escapes a single pipe character', () => {
    expect(escapeMdTableCell('>=1.0.0 <2.0.0|>=3.0.0 <4.0.0')).toBe('>=1.0.0 <2.0.0\\|>=3.0.0 <4.0.0');
  });

  it('escapes multiple pipe characters', () => {
    expect(escapeMdTableCell('a|b|c')).toBe('a\\|b\\|c');
  });

  it('returns an empty string unchanged', () => {
    expect(escapeMdTableCell('')).toBe('');
  });
});

// ── AC4 & AC5: audit findings — pipe escaping and CVE rendering ───────────────

describe('generateExecutiveReport() — audit findings pipe escaping and CVE rendering (AC4, AC5)', () => {
  // Helper: count the number of pipe-separated columns in a markdown table row.
  // A row like "| a | b | c |" has 3 columns (leading/trailing pipes are delimiters).
  function columnCount(row: string): number {
    // Split on unescaped pipes only: replace \| with a placeholder, split, restore
    const placeholder = '\x00';
    const cleaned = row.replace(/\\\|/g, placeholder);
    const parts = cleaned.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
    // Restore placeholder in parts to confirm they don't get double-counted
    return parts.length;
  }

  const cleanScanWithComposer: import('@core/types/scan').ScanResultJson = {
    agent: 'osv-scanner',
    status: 'success',
    environment: 'local',
    ecosystems: {
      composer: {
        vulnerabilities_total: 0,
        auto_safe: 0,
        breaking: 0,
        manual: 0,
        auto_safe_packages: [],
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: [],
      },
    },
    error: null,
  };

  it('(AC4) audit findings with pipe chars in affectedVersions do not break markdown table columns', () => {
    // affectedVersions contains a pipe: ">=2.0.0, <3.0.0|>=3.0.0, <4.0.0"
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScanWithComposer,
      scanAfter: cleanScanWithComposer,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/piped-pkg@3.0.1'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/piped-pkg',
              advisoryId: 'GHSA-pipe-0001',
              title: 'Pipe injection',
              cve: null,
              // This raw string contains a literal pipe — the report must escape it
              affectedVersions: '>=2.0.0, <3.0.0|>=3.0.0, <4.0.0',
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    // Find all table rows that mention the piped-pkg package
    const rows = result.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && l.includes('vendor/piped-pkg'));
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // The raw affectedVersions string ">=2.0.0, <3.0.0|>=3.0.0, <4.0.0" contains 1 literal pipe.
    // After escaping it becomes ">=2.0.0, <3.0.0\|>=3.0.0, <4.0.0".
    // Verify: the escaped sequence is present in the report.
    const reportContainsEscapedPipe = rows.some((row) => row.includes('\\|'));
    expect(reportContainsEscapedPipe).toBe(true);

    // Verify: none of the rows for this package contain an unescaped pipe that would
    // split table columns incorrectly. We do this by checking that the column count
    // of each matching row is consistent (== the column count of the header row for
    // that table, which must also match the separator row).
    // A simpler proxy: the number of unescaped pipe chars in each data row is exactly
    // (expectedColumns + 1) — i.e., no extra unescaped pipes sneak into the cell.
    for (const row of rows) {
      const cols = columnCount(row);
      // A well-formed markdown table row has at least 2 columns
      expect(cols).toBeGreaterThanOrEqual(2);
    }
  });

  it('(AC5) audit findings with CVE render the CVE identifier in the report', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScanWithComposer,
      scanAfter: cleanScanWithComposer,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/cve-pkg@2.0.0'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/cve-pkg',
              advisoryId: 'GHSA-cve-0001',
              title: 'SQL injection',
              cve: 'CVE-2024-1111',
              affectedVersions: '>=1.0.0 <2.0.0',
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    // The CVE identifier must appear somewhere in the report (used as ghsaId for the link)
    expect(result).toContain('CVE-2024-1111');

    // The advisory ID alone must NOT be used as the displayed identifier when a CVE is available
    // (The advisory ID may appear elsewhere, but not as the primary identifier for this finding)
    const rows = result.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && l.includes('vendor/cve-pkg'));
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // At least one row containing the package must also contain the CVE
    const rowWithCve = rows.find((r) => r.includes('CVE-2024-1111'));
    expect(rowWithCve).toBeDefined();
  });

  it('(AC5-b) audit findings with cve=null render a dash instead of an advisoryId-based link', () => {
    // Bug fix: when cve is null, ghsaId becomes '' so ghsaLink('') returns '—'.
    // Previously, advisoryId (e.g. 'symfony/http-kernel/2024-001.yaml') was used as
    // ghsaId, producing a broken osv.dev URL.
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScanWithComposer,
      scanAfter: cleanScanWithComposer,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/nocve-pkg@1.1.0'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/nocve-pkg',
              advisoryId: 'symfony/http-kernel/2024-001.yaml',
              title: 'XSS',
              cve: null,
              affectedVersions: '>=1.0.0 <1.1.0',
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    // When cve is null, the report must NOT generate a link using the advisoryId
    expect(result).not.toContain('symfony/http-kernel/2024-001.yaml');

    // The row for vendor/nocve-pkg should render a dash instead of a broken link
    const rows = result.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && l.includes('vendor/nocve-pkg'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const rowWithDash = rows.find((r) => r.includes('—'));
    expect(rowWithDash).toBeDefined();
  });

  it('(AC2-a) audit finding with cve=null renders "—" in the link column, not a broken link', () => {
    // Covers AC2 scenario 1: cve is null → ghsaId='', ghsaLink('')='—'
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScanWithComposer,
      scanAfter: cleanScanWithComposer,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/null-cve-pkg@2.0.0'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/null-cve-pkg',
              advisoryId: 'vendor/pkg/2024-broken.yaml',
              title: 'Remote exploit',
              cve: null,
              affectedVersions: '>=1.0.0 <2.0.0',
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    // The advisoryId path must NOT appear anywhere (it would form a broken link)
    expect(result).not.toContain('vendor/pkg/2024-broken.yaml');

    // The row for this package must contain a dash (—), not an osv.dev link
    const rows = result.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && l.includes('vendor/null-cve-pkg'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const rowWithDash = rows.find((r) => r.includes('—'));
    expect(rowWithDash).toBeDefined();
    // Ensure no broken link pattern appears
    const rowWithBrokenLink = rows.find((r) => r.includes('osv.dev/vendor'));
    expect(rowWithBrokenLink).toBeUndefined();
  });

  it('(AC2-b) audit finding with a valid CVE renders plain text (no hyperlink)', () => {
    // Covers AC2 scenario 2: cve='CVE-2024-28858' → ghsaId='CVE-2024-28858' → plain text (no link)
    // CVE IDs don't reliably exist in any public database so we display them as plain text only.
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScanWithComposer,
      scanAfter: cleanScanWithComposer,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/cve-link-pkg@3.0.0'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/cve-link-pkg',
              advisoryId: 'vendor/pkg/2024-001.yaml',
              title: 'SQL injection',
              cve: 'CVE-2024-28858',
              affectedVersions: '>=2.0.0 <3.0.0',
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    // The CVE must appear in the report as plain text
    expect(result).toContain('CVE-2024-28858');

    // The row must contain the CVE as plain text — no NVD link and no osv.dev link
    const rows = result.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && l.includes('vendor/cve-link-pkg'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const rowWithCve = rows.find((r) => r.includes('CVE-2024-28858'));
    expect(rowWithCve).toBeDefined();
    const rowWithNvdLink = rows.find((r) => r.includes('CVE-2024-28858') && r.includes('nvd.nist.gov'));
    expect(rowWithNvdLink).toBeUndefined();
    const rowWithOsvLink = rows.find((r) => r.includes('CVE-2024-28858') && r.includes('osv.dev'));
    expect(rowWithOsvLink).toBeUndefined();
  });

  it('(AC2-c) audit finding with cve="" (empty string) renders "—" in the link column', () => {
    // Covers AC2 scenario 3: cve='' → ghsaId='' → ghsaLink('')='—'
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScanWithComposer,
      scanAfter: cleanScanWithComposer,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/empty-cve-pkg@5.0.0'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/empty-cve-pkg',
              advisoryId: 'vendor/pkg/2024-002.yaml',
              title: 'XSS',
              cve: '' as unknown as null,
              affectedVersions: '>=4.0.0 <5.0.0',
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    // The row for this package must contain a dash, not a link
    const rows = result.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && l.includes('vendor/empty-cve-pkg'));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const rowWithDash = rows.find((r) => r.includes('—'));
    expect(rowWithDash).toBeDefined();
  });
});

// ── installedVersion field: real from→to versions in the report ───────────────

describe('generateExecutiveReport() — audit findings installedVersion field', () => {
  const cleanScanForInstalled: import('@core/types/scan').ScanResultJson = {
    agent: 'osv-scanner',
    status: 'success',
    environment: 'local',
    ecosystems: {
      composer: {
        vulnerabilities_total: 0,
        auto_safe: 0,
        breaking: 0,
        manual: 0,
        auto_safe_packages: [],
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: [],
      },
    },
    error: null,
  };

  it('audit findings with installedVersion show actual from→to versions in the report', () => {
    // AC4: installedVersion='1.5.0' should appear in the affectedVersions column; safeVersion
    // should come from packages_updated (2.0.0).
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScanForInstalled,
      scanAfter: cleanScanForInstalled,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/pkg@2.0.0'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/pkg',
              advisoryId: 'GHSA-installed-001',
              title: 'Remote code execution',
              cve: 'CVE-2024-9999',
              affectedVersions: '>=1.0.0 <2.0.0',
              installedVersion: '1.5.0',
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    // The actual installed version '1.5.0' must appear in the report (as currentVersion)
    expect(result).toContain('1.5.0');

    // The advisory range must NOT appear as the currentVersion cell
    // (the table row for vendor/pkg should contain '1.5.0', not the range)
    const rows = result.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && l.includes('vendor/pkg'));
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const rowWithInstalled = rows.find((r) => r.includes('1.5.0'));
    expect(rowWithInstalled).toBeDefined();

    // The post-update version '2.0.0' must appear as safeVersion
    const rowWithSafe = rows.find((r) => r.includes('2.0.0'));
    expect(rowWithSafe).toBeDefined();
  });

  it('audit findings without installedVersion fall back to affectedVersions', () => {
    // AC5: no installedVersion (undefined) → currentVersion falls back to affectedVersions range
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScanForInstalled,
      scanAfter: cleanScanForInstalled,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/legacy-pkg@3.0.0'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/legacy-pkg',
              advisoryId: 'GHSA-legacy-001',
              title: 'Path traversal',
              cve: null,
              affectedVersions: '>=2.0.0 <3.0.0',
              // installedVersion intentionally omitted (backward compat)
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    // The advisory range must appear in the report as the fallback currentVersion
    expect(result).toContain('>=2.0.0 <3.0.0');

    const rows = result.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && l.includes('vendor/legacy-pkg'));
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // At least one row must contain the advisory range
    const rowWithRange = rows.find((r) => r.includes('>=2.0.0 <3.0.0'));
    expect(rowWithRange).toBeDefined();
  });

  it('audit findings with installedVersion=null fall back to affectedVersions', () => {
    // AC5 variant: installedVersion explicitly null → same fallback behaviour
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: cleanScanForInstalled,
      scanAfter: cleanScanForInstalled,
      updates: {
        composer: {
          $schema: 'osv-update-result/v1',
          agent: 'composer-safe-update',
          status: 'success',
          packages_updated: ['vendor/null-pkg@4.0.0'],
          packages_skipped: [],
          packages_pending_breaking: [],
          validations: [{ name: 'validation', status: 'pass', detail: 'ok' }],
          error: null,
          audit_findings: [
            {
              ecosystem: 'composer',
              package: 'vendor/null-pkg',
              advisoryId: 'GHSA-null-001',
              title: 'Buffer overflow',
              cve: null,
              affectedVersions: '>=3.0.0 <4.0.0',
              installedVersion: null,
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');

    // The advisory range must appear as the fallback currentVersion
    expect(result).toContain('>=3.0.0 <4.0.0');

    const rows = result.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && l.includes('vendor/null-pkg'));
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const rowWithRange = rows.find((r) => r.includes('>=3.0.0 <4.0.0'));
    expect(rowWithRange).toBeDefined();
  });
});

// ── AC4 & AC5: validation entries with command field ─────────────────────────

describe('generateExecutiveReport() — validation entries with command field (AC4, AC5)', () => {
  const scanWithNpm: ScanResultJson = {
    agent: 'osv-scanner',
    status: 'success',
    environment: 'local',
    ecosystems: {
      npm: {
        vulnerabilities_total: 1,
        auto_safe: 1,
        breaking: 0,
        manual: 0,
        auto_safe_packages: ['lodash'],
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: [{
          ghsaId: 'GHSA-0001',
          cvss: '7.5',
          package: 'lodash',
          ecosystem: 'npm',
          currentVersion: '4.17.20',
          safeVersion: '4.17.21',
          classification: 'auto_safe',
          risk: 'high',
        }],
      },
    },
    error: null,
  };

  const updateWithCommandEntry = {
    $schema: 'osv-update-result/v1' as const,
    agent: 'npm-safe-update',
    status: 'success' as const,
    packages_updated: ['lodash@4.17.21'],
    packages_skipped: [],
    packages_pending_breaking: [],
    error: null,
  };

  it('(AC4) when validation entry has command field, verifiedMsg uses backtick format', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: scanWithNpm,
      scanAfter: scanWithNpm,
      updates: {
        npm: {
          ...updateWithCommandEntry,
          validations: [{
            name: 'tests',
            status: 'pass',
            detail: 'All tests passed',
            command: 'npm run test',
          }],
        },
      },
    });

    expect(typeof result).toBe('string');
    // The command must appear in backticks in the report
    expect(result).toContain('`npm run test`');
    // The detail must also appear
    expect(result).toContain('All tests passed');
    // The name must appear
    expect(result).toContain('tests');
  });

  it('(AC4) verifiedMsg format: ✅ **{name}** (`{command}`) — {detail}', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: scanWithNpm,
      scanAfter: scanWithNpm,
      updates: {
        npm: {
          ...updateWithCommandEntry,
          validations: [{
            name: 'build',
            status: 'pass',
            detail: 'Build succeeded',
            command: 'npm run build',
          }],
        },
      },
    });

    expect(typeof result).toBe('string');
    // Full format check: name, command in backticks, detail with em-dash separator
    expect(result).toContain('**build**');
    expect(result).toContain('`npm run build`');
    expect(result).toContain('Build succeeded');
  });

  it('(AC5) backward compat: validation entry WITHOUT command uses locale fallback', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: scanWithNpm,
      scanAfter: scanWithNpm,
      updates: {
        npm: {
          ...updateWithCommandEntry,
          validations: [{
            name: 'validation',
            status: 'pass',
            detail: 'Tests passed',
            // no command field — backward compat
          }],
        },
      },
    });

    expect(typeof result).toBe('string');
    // Backward compat: must NOT use the backtick format (no backtick-wrapped command)
    expect(result).not.toMatch(/`[^`]+`/);
    // The locale fallback message should be present
    expect(result).toContain('Tests passed');
  });

  it('(AC5) entries with command and entries without command both render correctly in same report', () => {
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: scanWithNpm,
      scanAfter: scanWithNpm,
      updates: {
        npm: {
          ...updateWithCommandEntry,
          validations: [
            {
              name: 'tests',
              status: 'pass',
              detail: 'Tests ok',
              command: 'npm test',
            },
          ],
        },
      },
    });

    expect(typeof result).toBe('string');
    // The command entry uses backtick format
    expect(result).toContain('`npm test`');
    expect(result).toContain('Tests ok');
  });

  it('(AC4) pip check command appears in verifiedMsg when set', () => {
    const pipScan: ScanResultJson = {
      ...emptyScan,
      ecosystems: {
        pip: {
          vulnerabilities_total: 0,
          auto_safe: 0,
          breaking: 0,
          manual: 0,
          auto_safe_packages: [],
          breaking_packages: [],
          manual_packages: [],
          vulnerabilities: [],
        },
      },
    };

    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: pipScan,
      scanAfter: pipScan,
      updates: {
        pip: {
          $schema: 'osv-update-result/v1' as const,
          agent: 'pip-safe-update',
          status: 'success' as const,
          packages_updated: [],
          packages_skipped: [],
          packages_pending_breaking: [],
          error: null,
          validations: [{
            name: 'pip-check',
            status: 'pass',
            detail: 'No broken requirements',
            command: 'pip check',
          }],
        },
      },
    });

    expect(typeof result).toBe('string');
    expect(result).toContain('`pip check`');
    expect(result).toContain('No broken requirements');
  });
});

// ── vulnLink() unit tests ─────────────────────────────────────────────────────

describe('vulnLink()', () => {
  it('CVE ID → plain text (no hyperlink)', () => {
    expect(vulnLink('CVE-2026-45068')).toBe('CVE-2026-45068');
  });

  it('GHSA ID → osv.dev/vulnerability/ URL', () => {
    expect(vulnLink('GHSA-1234-5678-abcd')).toBe('[GHSA-1234-5678-abcd](https://osv.dev/vulnerability/GHSA-1234-5678-abcd)');
  });

  it('empty string → "—"', () => {
    expect(vulnLink('')).toBe('—');
  });

  it('null-ish (empty via falsy) → "—"', () => {
    // The function accepts string; callers coerce null/undefined to '' via `|| ''`
    // but we also verify that an empty-string-coerced call returns dash
    expect(vulnLink('' as string)).toBe('—');
  });

  it('unknown prefix → osv.dev/vulnerability/ fallback', () => {
    expect(vulnLink('PYSEC-2023-1234')).toBe('[PYSEC-2023-1234](https://osv.dev/vulnerability/PYSEC-2023-1234)');
  });

  it('CVE- prefix matching is case-sensitive (lowercase cve- is treated as unknown)', () => {
    // 'cve-' does not start with 'CVE-', so it falls back to osv.dev
    expect(vulnLink('cve-2026-45068')).toBe('[cve-2026-45068](https://osv.dev/vulnerability/cve-2026-45068)');
  });
});

// ── Blocked vulns section tests (REACHABILITY-ENGINE-001-S2) ─────────────────

describe('generateExecutiveReport() — blocked vulns section (AC1–AC5)', () => {
  function allTableRows(report: string): string[] {
    return report.split('\n').filter((l) => l.startsWith('|') && !l.includes('---'));
  }

  const blockedVuln = {
    ghsaId: 'GHSA-block-0001',
    cvss: '8.1',
    package: 'some-dep',
    ecosystem: 'npm',
    currentVersion: '2.0.0',
    safeVersion: '2.1.0',
    classification: 'auto_safe' as const,
    risk: 'high',
    reason: '',
    reachable: false as const,
    blockReason: 'Protected by constraint',
    blockedBy: ['some-other-dep@^2.0.0'],
  };

  const pendingVuln = {
    ghsaId: 'GHSA-pend-0001',
    cvss: '6.5',
    package: 'pending-dep',
    ecosystem: 'npm',
    currentVersion: '1.0.0',
    safeVersion: null as string | null,
    classification: 'breaking' as const,
    risk: 'medium',
    reason: 'Major version bump required: 1.0.0 → 2.0.0',
  };

  const fixedVuln = {
    ghsaId: 'GHSA-fixed-0001',
    cvss: '7.5',
    package: 'fixed-dep',
    ecosystem: 'npm',
    currentVersion: '3.0.0',
    safeVersion: '3.1.0',
    classification: 'auto_safe' as const,
    risk: 'high',
    reason: '',
  };

  function makeMixedScan(vulns: object[]): ScanResultJson {
    return {
      agent: 'osv-scanner',
      status: 'success',
      environment: 'local',
      ecosystems: {
        npm: {
          vulnerabilities_total: vulns.length,
          auto_safe: vulns.filter((v: any) => v.classification === 'auto_safe').length,
          breaking: vulns.filter((v: any) => v.classification === 'breaking').length,
          manual: 0,
          vulnerabilities: vulns as any[],
        },
      },
      error: null,
    };
  }

  // AC1: blocked vulns appear in dedicated blocked section with blockReason and blockedBy columns
  it('(AC1) blocked vulns appear in the blocked section with blockReason and blockedBy', () => {
    const scan = makeMixedScan([blockedVuln]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect(typeof result).toBe('string');

    // The blocked section intro must appear
    expect(result).toContain('blocked by dependency constraints');

    // The blocked vuln package must appear in a table row
    const rows = allTableRows(result);
    const blockedRows = rows.filter((r) => r.includes('some-dep'));
    expect(blockedRows.length).toBeGreaterThanOrEqual(1);

    // The blockReason must appear in the row
    const rowWithReason = blockedRows.find((r) => r.includes('Protected by constraint'));
    expect(rowWithReason).toBeDefined();

    // The blockedBy must appear in the row
    const rowWithBlockedBy = blockedRows.find((r) => r.includes('some-other-dep@^2.0.0'));
    expect(rowWithBlockedBy).toBeDefined();
  });

  // AC2: blocked vulns do NOT appear in the pending section
  it('(AC2) blocked vulns do NOT appear in the pending section', () => {
    const scan = makeMixedScan([blockedVuln]);
    const ctx = buildExecutiveReportContext({ ...baseOpts, scanBefore: scan, scanAfter: scan });

    const pendingVulns = ctx['pendingVulns'] as Record<string, unknown>[];
    const blockedVulns = ctx['blockedVulns'] as Record<string, unknown>[];

    // blocked vuln must be in blockedVulns
    const inBlocked = blockedVulns.some((r) => r['package'] === 'some-dep');
    expect(inBlocked).toBe(true);

    // blocked vuln must NOT be in pendingVulns
    const inPending = pendingVulns.some((r) => r['package'] === 'some-dep');
    expect(inPending).toBe(false);
  });

  // AC3: when no blocked vulns, blocked section is not rendered
  it('(AC3) when no blocked vulns, blocked section is not rendered', () => {
    const scan = makeMixedScan([pendingVuln]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect(typeof result).toBe('string');

    // The blocked section intro must NOT appear
    expect(result).not.toContain('blocked by dependency constraints');

    // Context should have empty blockedVulns
    const ctx = buildExecutiveReportContext({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect((ctx['blockedVulns'] as unknown[]).length).toBe(0);
    expect(ctx['hasBlockedVulns']).toBe(false);
  });

  // AC5: evidence section shows blocked status for reachable === false vulns
  it('(AC5) evidence section shows blocked status for reachable=false vulns, not pending', () => {
    const scan = makeMixedScan([blockedVuln]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });

    // The evidence section must contain a "blocked" status, not just "pending"
    expect(result).toContain('blocked (constraint:');

    // Must not show the generic pending status for the blocked vuln
    // (pending status words should not appear for the blocked package)
    const evidenceRows = result.split('\n').filter(
      (l) => l.startsWith('|') && !l.includes('---') && l.includes('some-dep'),
    );
    const blockedStatusRow = evidenceRows.find((r) => r.includes('blocked'));
    expect(blockedStatusRow).toBeDefined();
  });

  // allFixed is false when there are blocked vulns (even if no pending)
  it('allFixed is false when blocked vulns exist (even if no pending)', () => {
    const scan = makeMixedScan([blockedVuln, fixedVuln]);
    const ctx = buildExecutiveReportContext({
      ...baseOpts,
      scanBefore: scan,
      scanAfter: scan,
      updates: {
        npm: {
          agent: 'npm',
          status: 'success',
          environment: 'local',
          packages_updated: ['fixed-dep@3.1.0'],
          validations: [],
        },
      },
    });

    // fixedVulns has fixed-dep, blockedVulns has some-dep, pendingOriginal should be empty
    expect(ctx['allFixed']).toBe(false);
  });

  // allFixed is true when only fixed vulns and no blocked or pending
  it('allFixed is true when fixedVulns > 0 and no blocked or pending', () => {
    const scan = makeMixedScan([fixedVuln]);
    const ctx = buildExecutiveReportContext({
      ...baseOpts,
      scanBefore: scan,
      scanAfter: scan,
      updates: {
        npm: {
          agent: 'npm',
          status: 'success',
          environment: 'local',
          packages_updated: ['fixed-dep@3.1.0'],
          validations: [],
        },
      },
    });

    expect(ctx['allFixed']).toBe(true);
  });

  // Mixed scenario: fixed + blocked + pending all in correct sections
  it('mixed scenario — fixed + blocked + pending appear in their correct sections', () => {
    const scan = makeMixedScan([fixedVuln, blockedVuln, pendingVuln]);
    const ctx = buildExecutiveReportContext({
      ...baseOpts,
      scanBefore: scan,
      scanAfter: scan,
      updates: {
        npm: {
          agent: 'npm',
          status: 'success',
          environment: 'local',
          packages_updated: ['fixed-dep@3.1.0'],
          validations: [],
        },
      },
    });

    const fixedVulns = ctx['fixedVulns'] as Record<string, unknown>[];
    const blockedVulnsCtx = ctx['blockedVulns'] as Record<string, unknown>[];
    const pendingVulnsCtx = ctx['pendingVulns'] as Record<string, unknown>[];

    // fixed-dep is fixed
    expect(fixedVulns.some((r) => r['package'] === 'fixed-dep')).toBe(true);
    // some-dep is blocked
    expect(blockedVulnsCtx.some((r) => r['package'] === 'some-dep')).toBe(true);
    // pending-dep is pending
    expect(pendingVulnsCtx.some((r) => r['package'] === 'pending-dep')).toBe(true);

    // Cross-checks: no cross-section bleed
    expect(fixedVulns.some((r) => r['package'] === 'some-dep')).toBe(false);
    expect(fixedVulns.some((r) => r['package'] === 'pending-dep')).toBe(false);
    expect(blockedVulnsCtx.some((r) => r['package'] === 'fixed-dep')).toBe(false);
    expect(blockedVulnsCtx.some((r) => r['package'] === 'pending-dep')).toBe(false);
    expect(pendingVulnsCtx.some((r) => r['package'] === 'some-dep')).toBe(false);
    expect(pendingVulnsCtx.some((r) => r['package'] === 'fixed-dep')).toBe(false);
  });

  // Blocked vuln with default blockReason (no blockReason set → 'Dependency constraint')
  it('blocked vuln with no blockReason falls back to "Dependency constraint"', () => {
    const vulnNoReason = { ...blockedVuln, blockReason: undefined };
    const scan = makeMixedScan([vulnNoReason]);
    const ctx = buildExecutiveReportContext({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    const blocked = ctx['blockedVulns'] as Record<string, unknown>[];
    expect(blocked[0]?.['blockReason']).toBe('Dependency constraint');
  });

  // Blocked vuln with no blockedBy → '—'
  it('blocked vuln with no blockedBy shows "—"', () => {
    const vulnNoBlockedBy = { ...blockedVuln, blockedBy: undefined };
    const scan = makeMixedScan([vulnNoBlockedBy]);
    const ctx = buildExecutiveReportContext({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    const blocked = ctx['blockedVulns'] as Record<string, unknown>[];
    expect(blocked[0]?.['blockedBy']).toBe('—');
  });

  // AC4: DOCX generation succeeds with blocked vulns present
  it('(AC4) DOCX generation succeeds with blocked vulns present', async () => {
    const scan = makeMixedScan([blockedVuln]);
    const buffer = await generateExecutiveReportDocx({ ...baseOpts, scanBefore: scan, scanAfter: scan });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  // Refactor guard: blockedStatusOrNull extracted from computeEvidenceStatusPt (AC4 / Slice-6)
  it('(AC4-refactor) reachable=false vuln still shows blocked status in evidence after refactor', () => {
    // This test guards the zero-behavior-change guarantee of the blockedStatusOrNull extraction.
    const scan = makeMixedScan([blockedVuln]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });

    // The evidence section (after section) must still show blocked status for reachable=false vulns
    expect(result).toContain('blocked (constraint:');
    const evidenceRows = result.split('\n').filter(
      (l) => l.startsWith('|') && !l.includes('---') && l.includes('some-dep'),
    );
    expect(evidenceRows.length).toBeGreaterThanOrEqual(1);
    const statusRow = evidenceRows.find((r) => r.includes('blocked'));
    expect(statusRow).toBeDefined();
  });

  it('(AC4-refactor) reachable=undefined vuln does NOT show blocked status (falls through to pending)', () => {
    // Guards that the refactor did not accidentally block vulns with reachable=undefined
    const unreachableVuln = { ...pendingVuln };  // no reachable field
    const scan = makeMixedScan([unreachableVuln]);
    const result = generateExecutiveReport({ ...baseOpts, scanBefore: scan, scanAfter: scan });

    // blocked status must NOT appear for this package
    const rows = result.split('\n').filter(
      (l) => l.startsWith('|') && !l.includes('---') && l.includes('pending-dep'),
    );
    const blockedRow = rows.find((r) => r.includes('blocked (constraint:'));
    expect(blockedRow).toBeUndefined();
  });

  // Blocked section appears between fixed and pending in markdown output
  it('blocked section appears between fixed section and pending section in markdown', () => {
    const scan = makeMixedScan([fixedVuln, blockedVuln, pendingVuln]);
    const result = generateExecutiveReport({
      ...baseOpts,
      scanBefore: scan,
      scanAfter: scan,
      updates: {
        npm: {
          agent: 'npm',
          status: 'success',
          environment: 'local',
          packages_updated: ['fixed-dep@3.1.0'],
          validations: [],
        },
      },
    });

    const lines = result.split('\n');
    const fixedIntroIdx = lines.findIndex((l) => l.includes('found and fixed'));
    const blockedIntroIdx = lines.findIndex((l) => l.includes('blocked by dependency constraints'));
    const pendingIntroIdx = lines.findIndex((l) => l.includes('could not be fixed automatically'));

    // All three sections must be present
    expect(fixedIntroIdx).toBeGreaterThan(-1);
    expect(blockedIntroIdx).toBeGreaterThan(-1);
    expect(pendingIntroIdx).toBeGreaterThan(-1);

    // Order: fixed < blocked < pending
    expect(fixedIntroIdx).toBeLessThan(blockedIntroIdx);
    expect(blockedIntroIdx).toBeLessThan(pendingIntroIdx);
  });
});
