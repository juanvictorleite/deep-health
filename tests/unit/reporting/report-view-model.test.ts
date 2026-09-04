/**
 * Unit tests for src/reporting/report-view-model.ts (ADR 0008).
 *
 * Exercises buildExecutiveReportViewModel / buildEntryReportViewModel directly —
 * row building, dedup, and summary labels — with no Handlebars/render involved.
 */
import type { ExecutiveReportOptions } from '@core/types/report';
import type { ScanResultJson, VulnerabilityEntry } from '@core/types/scan';
import {
  buildEntryReportViewModel,
  buildExecutiveReportViewModel,
  escapeMdTableCell,
  vulnLink,
} from '@reporting/report-view-model';
import { describe, expect, it } from 'vitest';

const emptyScan: ScanResultJson = {
  $schema: 'osv-scan-result/v1',
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

function makeVuln(overrides: Partial<VulnerabilityEntry> & Pick<VulnerabilityEntry, 'ecosystem' | 'package'>): VulnerabilityEntry {
  return {
    currentVersion: '1.0.0',
    safeVersion: null,
    cvss: '7.5',
    ghsaId: 'GHSA-0000-0000-0000',
    risk: 'high',
    classification: 'breaking',
    reason: '',
    ...overrides,
  };
}

describe('buildExecutiveReportViewModel() — shape', () => {
  it('returns the ExecutiveReportViewModel keys, no Handlebars involved', () => {
    const vm = buildExecutiveReportViewModel(baseOpts);
    expect(Object.keys(vm).sort()).toEqual(
      [
        'allFixed', 'advisorSection', 'blockedVulns', 'branch', 'client', 'dependencyChanges',
        'evidenceSections',
        'fixedVulns', 'hasBlockedVulns', 'hasBranch', 'hasPending', 'monthFull', 'noVulns',
        'hasDependencyChanges', 'pendingVulns', 'project', 'scanAfterSummary', 'scanBeforeSummary', 'scannerEngines',
        'sonarSection', 't', 'totalBefore', 'year',
      ].sort(),
    );
  });

  it('noVulns is true and totalBefore is 0 with an empty scan', () => {
    const vm = buildExecutiveReportViewModel(baseOpts);
    expect(vm.noVulns).toBe(true);
    expect(vm.totalBefore).toBe(0);
    expect(vm.fixedVulns).toEqual([]);
    expect(vm.pendingVulns).toEqual([]);
    expect(vm.blockedVulns).toEqual([]);
  });

  it('carries client/project through unchanged', () => {
    const vm = buildExecutiveReportViewModel(baseOpts);
    expect(vm.client).toBe('Acme');
    expect(vm.project).toBe('Project');
  });

  it('builds dependency changes only from packages_updated evidence', () => {
    const vm = buildExecutiveReportViewModel({
      ...baseOpts,
      ecosystems: [{ id: 'npm', path: 'app', label: 'app' }],
      updates: {
        'npm:app': {
          $schema: 'osv-update-result/v1', agent: 'npm-safe-update', status: 'success',
          packages_updated: ['lodash@4.17.21', 'ws@7.5.10'], packages_skipped: [],
          packages_pending_breaking: [], validations: [], error: null,
        },
      },
    });

    expect(vm.hasDependencyChanges).toBe(true);
    expect(vm.dependencyChanges).toEqual([
      { ecosystem: 'npm (app)', packageRef: 'lodash@4.17.21' },
      { ecosystem: 'npm (app)', packageRef: 'ws@7.5.10' },
    ]);
  });

  it('uses an explicit empty state when packages_updated has no evidence', () => {
    const vm = buildExecutiveReportViewModel(baseOpts);
    expect(vm.hasDependencyChanges).toBe(false);
    expect(vm.dependencyChanges).toEqual([]);
  });
});

describe('buildExecutiveReportViewModel() — row building', () => {
  it('builds a fixedVulns row for an auto_safe vuln whose package was updated', () => {
    const scan: ScanResultJson = {
      ...emptyScan,
      ecosystems: {
        npm: {
          vulnerabilities_total: 1, auto_safe: 1, breaking: 0, manual: 0,
          auto_safe_packages: ['lodash'], breaking_packages: [], manual_packages: [],
          vulnerabilities: [makeVuln({
            ecosystem: 'npm', package: 'lodash', currentVersion: '4.17.20',
            safeVersion: '4.17.21', classification: 'auto_safe', ghsaId: 'GHSA-fix-0001',
          })],
        },
      },
    };
    const vm = buildExecutiveReportViewModel({
      ...baseOpts,
      scanBefore: scan,
      updates: {
        npm: {
          $schema: 'osv-update-result/v1', agent: 'npm-safe-update', status: 'success',
          packages_updated: ['lodash@4.17.21'], packages_skipped: [], packages_pending_breaking: [],
          validations: [], error: null,
        },
      },
    });
    expect(vm.fixedVulns).toHaveLength(1);
    const row = vm.fixedVulns[0] as Record<string, unknown>;
    expect(row['package']).toBe('lodash');
    expect(row['safeVersion']).toBe('4.17.21');
    expect(row['ghsaId']).toBe('GHSA-fix-0001');
    expect(row['residualWarning']).toBe(false);
  });

  it('builds a blockedVulns row for a vuln with reachable === false', () => {
    const scan: ScanResultJson = {
      ...emptyScan,
      ecosystems: {
        composer: {
          vulnerabilities_total: 1, auto_safe: 0, breaking: 0, manual: 1,
          auto_safe_packages: [], breaking_packages: [], manual_packages: ['vendor/pkg'],
          vulnerabilities: [makeVuln({
            ecosystem: 'composer', package: 'vendor/pkg', classification: 'manual',
            reachable: false, blockReason: 'Dependency constraint', blockedBy: ['vendor/framework'],
          })],
        },
      },
    };
    const vm = buildExecutiveReportViewModel({ ...baseOpts, scanBefore: scan });
    expect(vm.blockedVulns).toHaveLength(1);
    expect(vm.pendingVulns).toHaveLength(0);
    const row = vm.blockedVulns[0] as Record<string, unknown>;
    expect(row['package']).toBe('vendor/pkg');
    expect(row['blockReason']).toBe('Dependency constraint');
    expect(row['blockedBy']).toBe('vendor/framework');
  });

  it('flags residualWarning true when residualVerification is unverified with a residual count > 0', () => {
    const scan: ScanResultJson = {
      ...emptyScan,
      ecosystems: {
        npm: {
          vulnerabilities_total: 1, auto_safe: 1, breaking: 0, manual: 0,
          auto_safe_packages: ['lodash'], breaking_packages: [], manual_packages: [],
          vulnerabilities: [makeVuln({
            ecosystem: 'npm', package: 'lodash', classification: 'auto_safe', safeVersion: '4.17.21',
          })],
        },
      },
    };
    const vm = buildExecutiveReportViewModel({
      ...baseOpts,
      scanBefore: scan,
      updates: {
        npm: {
          $schema: 'osv-update-result/v1', agent: 'npm-safe-update', status: 'success',
          packages_updated: ['lodash@4.17.21'], packages_skipped: [], packages_pending_breaking: [],
          validations: [], error: null,
        },
      },
      residualVerification: { status: 'unverified', summary: { npm: 1 } },
    });
    const row = vm.fixedVulns[0] as Record<string, unknown>;
    expect(row['residualWarning']).toBe(true);
  });
});

describe('buildExecutiveReportViewModel() — dedup', () => {
  it('merges same package + ecosystem across versions and GHSA ids into a single pending row', () => {
    const scan: ScanResultJson = {
      ...emptyScan,
      ecosystems: {
        npm: {
          vulnerabilities_total: 2, auto_safe: 0, breaking: 2, manual: 0,
          auto_safe_packages: [], breaking_packages: ['qs'], manual_packages: [],
          vulnerabilities: [
            makeVuln({ ecosystem: 'npm', package: 'qs', currentVersion: '6.5.2', ghsaId: 'GHSA-aaaa' }),
            makeVuln({ ecosystem: 'npm', package: 'qs', currentVersion: '6.7.0', ghsaId: 'GHSA-bbbb' }),
          ],
        },
      },
    };
    const vm = buildExecutiveReportViewModel({ ...baseOpts, scanBefore: scan });
    expect(vm.pendingVulns).toHaveLength(1);
    const row = vm.pendingVulns[0] as Record<string, unknown>;
    expect(row['affectedVersions']).toBe('6.5.2, 6.7.0');
    expect(row['ghsaId']).toBe('GHSA-aaaa, GHSA-bbbb');
  });

  it('keeps different packages with the same GHSA as separate rows', () => {
    const scan: ScanResultJson = {
      ...emptyScan,
      ecosystems: {
        npm: {
          vulnerabilities_total: 2, auto_safe: 0, breaking: 2, manual: 0,
          auto_safe_packages: [], breaking_packages: ['lodash', 'lodash-es'], manual_packages: [],
          vulnerabilities: [
            makeVuln({ ecosystem: 'npm', package: 'lodash', ghsaId: 'GHSA-shared' }),
            makeVuln({ ecosystem: 'npm', package: 'lodash-es', ghsaId: 'GHSA-shared' }),
          ],
        },
      },
    };
    const vm = buildExecutiveReportViewModel({ ...baseOpts, scanBefore: scan });
    expect(vm.pendingVulns).toHaveLength(2);
    const packages = vm.pendingVulns.map((r) => (r as Record<string, unknown>)['package']);
    expect(packages).toEqual(expect.arrayContaining(['lodash', 'lodash-es']));
  });
});

describe('buildExecutiveReportViewModel() — summary labels', () => {
  it('joins per-ecosystem before/after labels with ", " across multiple ecosystems', () => {
    const scan: ScanResultJson = {
      ...emptyScan,
      ecosystems: {
        npm: {
          vulnerabilities_total: 1, auto_safe: 0, breaking: 1, manual: 0,
          auto_safe_packages: [], breaking_packages: ['lodash'], manual_packages: [],
          vulnerabilities: [makeVuln({ ecosystem: 'npm', package: 'lodash' })],
        },
        composer: {
          vulnerabilities_total: 1, auto_safe: 0, breaking: 0, manual: 1,
          auto_safe_packages: [], breaking_packages: [], manual_packages: ['vendor/pkg'],
          vulnerabilities: [makeVuln({ ecosystem: 'composer', package: 'vendor/pkg' })],
        },
      },
    };
    const vm = buildExecutiveReportViewModel({ ...baseOpts, scanBefore: scan });
    expect(vm.scanBeforeSummary).toContain(',');
    expect(vm.totalBefore).toBe(2);
  });

  it('uses the real post-fix scan instead of deriving the total from actionable findings', () => {
    const blocked = makeVuln({
      ecosystem: 'npm', package: 'blocked-package', classification: 'auto_safe', reachable: false,
    });
    const actionable = makeVuln({
      ecosystem: 'npm', package: 'actionable-package', classification: 'breaking',
    });
    const scan: ScanResultJson = {
      ...emptyScan,
      ecosystems: {
        npm: {
          vulnerabilities_total: 2, auto_safe: 1, breaking: 1, manual: 0,
          auto_safe_packages: ['blocked-package'], breaking_packages: ['actionable-package'], manual_packages: [],
          vulnerabilities: [blocked, actionable],
        },
      },
    };

    const vm = buildExecutiveReportViewModel({ ...baseOpts, scanBefore: scan, scanAfter: scan });

    expect(vm.blockedVulns).toHaveLength(1);
    expect(vm.pendingVulns).toHaveLength(1);
    expect(vm.scanAfterSummary).toContain('**2 vulnerabilities remaining**');
    expect(vm.scanAfterSummary).not.toContain('**1 vulnerabilities remaining**');
  });
});

describe('buildEntryReportViewModel() — scoping', () => {
  const splitScanBefore: ScanResultJson = {
    ...emptyScan,
    ecosystems: {
      'npm:frontend': {
        vulnerabilities_total: 1, auto_safe: 1, breaking: 0, manual: 0,
        auto_safe_packages: ['lodash'], breaking_packages: [], manual_packages: [],
        vulnerabilities: [makeVuln({ ecosystem: 'npm:frontend', package: 'lodash', classification: 'auto_safe' })],
      },
      'npm:api': {
        vulnerabilities_total: 1, auto_safe: 1, breaking: 0, manual: 0,
        auto_safe_packages: ['express'], breaking_packages: [], manual_packages: [],
        vulnerabilities: [makeVuln({ ecosystem: 'npm:api', package: 'express', classification: 'auto_safe' })],
      },
    },
  };

  const splitOpts: ExecutiveReportOptions = {
    client: 'Client',
    project: 'Project',
    scanBefore: splitScanBefore,
    scanAfter: emptyScan,
    updates: {},
    ecosystems: [
      { id: 'npm', label: 'frontend' },
      { id: 'npm', label: 'api' },
    ],
  };

  it('scopes evidenceSections and totalBefore to only the target entry', () => {
    const vm = buildEntryReportViewModel(splitOpts, 'npm:frontend');
    expect(vm.evidenceSections).toHaveLength(1);
    expect((vm.evidenceSections[0] as Record<string, unknown>)['id']).toBe('npm:frontend');
    expect(vm.totalBefore).toBe(1);
  });

  it('scopes to npm:api independently', () => {
    const vm = buildEntryReportViewModel(splitOpts, 'npm:api');
    expect(vm.evidenceSections).toHaveLength(1);
    expect((vm.evidenceSections[0] as Record<string, unknown>)['id']).toBe('npm:api');
    expect(vm.totalBefore).toBe(1);
  });

  it('returns an empty/noVulns view model for an entry key with no scan data', () => {
    const vm = buildEntryReportViewModel(splitOpts, 'npm:nonexistent');
    expect(vm.totalBefore).toBe(0);
    expect(vm.noVulns).toBe(true);
  });

  it('carries client/project through the scoped view model', () => {
    const vm = buildEntryReportViewModel(splitOpts, 'npm:frontend');
    expect(vm.client).toBe('Client');
    expect(vm.project).toBe('Project');
  });
});

describe('escapeMdTableCell() and vulnLink() — re-exported transform helpers', () => {
  it('escapeMdTableCell escapes pipe characters', () => {
    expect(escapeMdTableCell('a|b')).toBe('a\\|b');
  });

  it('vulnLink returns a dash for an empty id', () => {
    expect(vulnLink('')).toBe('—');
  });

  it('vulnLink returns the CVE id unlinked for CVE- prefixed ids', () => {
    expect(vulnLink('CVE-2024-1111')).toBe('CVE-2024-1111');
  });

  it('vulnLink returns an osv.dev markdown link for GHSA ids', () => {
    expect(vulnLink('GHSA-xxxx-yyyy')).toBe('[GHSA-xxxx-yyyy](https://osv.dev/vulnerability/GHSA-xxxx-yyyy)');
  });
});
