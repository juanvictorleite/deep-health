/**
 * Golden-master test for ADR 0008 (executive report ViewModel split).
 *
 * This fixture is run BEFORE the report-view-model.ts extraction to capture
 * the pre-refactor output as a committed snapshot, then re-run AFTER the
 * extraction to prove `generateExecutiveReport` / `generateEntryReport`
 * output is byte-identical (behavior-preserving move of the pure transforms
 * out of src/reporting/executive.ts into src/reporting/report-view-model.ts).
 *
 * The fixture covers: fixed vulns, pending vulns, blocked (unreachable) vulns,
 * audit findings injected via updates[].audit_findings, residual verification
 * (unverified with a residual count), multiple ecosystems, and entry-split
 * (per-entry) reporting.
 */
import type { ExecutiveReportOptions } from '@core/types/report';
import { generateEntryReport, generateExecutiveReport } from '@reporting/executive';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

const fixtureOpts: ExecutiveReportOptions = {
  client: 'Acme',
  project: 'Project',
  branch: 'main',
  scannerEngines: ['osv', 'sonarqube'],
  ecosystems: [
    { id: 'npm', label: 'frontend' },
    { id: 'npm', label: 'api' },
    { id: 'composer' },
  ],
  scanBefore: {
    $schema: 'osv-scan-result/v1',
    agent: 'osv-scanner',
    status: 'success',
    environment: 'local',
    error: null,
    ecosystems: {
      'npm:frontend': {
        vulnerabilities_total: 1,
        auto_safe: 1,
        breaking: 0,
        manual: 0,
        auto_safe_packages: ['lodash'],
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: [
          {
            ecosystem: 'npm:frontend',
            package: 'lodash',
            currentVersion: '4.17.20',
            safeVersion: '4.17.21',
            cvss: '7.5',
            ghsaId: 'GHSA-frontend-0001',
            risk: 'high',
            classification: 'auto_safe',
            reason: '',
          },
        ],
      },
      'npm:api': {
        vulnerabilities_total: 1,
        auto_safe: 0,
        breaking: 1,
        manual: 0,
        auto_safe_packages: [],
        breaking_packages: ['express'],
        manual_packages: [],
        vulnerabilities: [
          {
            ecosystem: 'npm:api',
            package: 'express',
            currentVersion: '4.17.1',
            safeVersion: '5.0.0',
            cvss: '8.1',
            ghsaId: 'GHSA-api-0002',
            risk: 'critical',
            classification: 'breaking',
            reason: 'Major version bump required: 4.17.1 → 5.0.0',
          },
        ],
      },
      composer: {
        vulnerabilities_total: 1,
        auto_safe: 0,
        breaking: 0,
        manual: 1,
        auto_safe_packages: [],
        breaking_packages: [],
        manual_packages: ['symfony/http-kernel'],
        vulnerabilities: [
          {
            ecosystem: 'composer',
            package: 'symfony/http-kernel',
            currentVersion: '5.4.0',
            safeVersion: '5.4.20',
            cvss: '9.1',
            ghsaId: 'GHSA-composer-0003',
            risk: 'critical',
            classification: 'manual',
            reason: 'Protected package: do not upgrade. Safe version 5.4.20 is outside constraint ^5.4.0',
            reachable: false,
            blockReason: 'Dependency constraint',
            blockedBy: ['symfony/framework-bundle'],
          },
        ],
      },
    },
  },
  scanAfter: {
    $schema: 'osv-scan-result/v1',
    agent: 'osv-scanner',
    status: 'success',
    environment: 'local',
    error: null,
    ecosystems: {},
  },
  updates: {
    'npm:frontend': {
      $schema: 'osv-update-result/v1',
      agent: 'npm-safe-update',
      status: 'success',
      packages_updated: ['lodash@4.17.21'],
      packages_skipped: [],
      packages_pending_breaking: [],
      validations: [{ name: 'npm test', status: 'pass', detail: '42 passing', command: 'npm test' }],
      error: null,
    },
    composer: {
      $schema: 'osv-update-result/v1',
      agent: 'composer-safe-update',
      status: 'success',
      packages_updated: ['vendor/audit-pkg@1.2.0'],
      packages_skipped: [],
      packages_pending_breaking: [],
      validations: [{ name: 'phpunit', status: 'pass', detail: '12 passing' }],
      error: null,
      audit_findings: [
        {
          ecosystem: 'composer',
          package: 'vendor/audit-pkg',
          advisoryId: 'GHSA-audit-9999',
          title: 'SQL Injection',
          cve: 'CVE-2024-5555',
          affectedVersions: '>=1.0.0 <1.2.0',
          installedVersion: '1.1.0',
        },
      ],
    },
  },
  residualVerification: { status: 'unverified', summary: { 'npm:frontend': 1, composer: 0 } },
  engineResults: {
    sonarqube: {
      $schema: 'osv-scan-result/v1',
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
        ],
        metrics: { coverage: '70' },
        issues: [],
      },
    },
  },
  advisorResults: {
    'npm:frontend': [{ name: 'npm-audit', command: 'npm audit', exitCode: 0, output: '', status: 'clean' }],
  },
};

describe('golden master — generateExecutiveReport() output stability (ADR 0008 report-view-model extraction)', () => {
  it('produces output byte-identical to the pre-refactor snapshot (consolidated report)', () => {
    const result = generateExecutiveReport(fixtureOpts);
    expect(result).toMatchSnapshot();
  });

  it('produces output byte-identical to the pre-refactor snapshot (single-entry scoped report)', () => {
    const result = generateEntryReport(fixtureOpts, 'npm:frontend');
    expect(result).toMatchSnapshot();
  });

  it('produces output byte-identical to the pre-refactor snapshot (entry scoped to composer with audit findings)', () => {
    const result = generateEntryReport(fixtureOpts, 'composer');
    expect(result).toMatchSnapshot();
  });
});
