
import { formatFixSummary, formatBreakingWarning } from '@app/fix-summary';
import type { FixSummaryInput } from '@app/fix-summary';
import { describe, it, expect } from 'vitest';

const baseEcosystem = {
  vulnerabilities_total: 0,
  auto_safe: 0,
  breaking: 0,
  manual: 0,
  auto_safe_packages: [],
  breaking_packages: [],
  manual_packages: [],
  vulnerabilities: [],
};

const baseScanResult = {
  $schema: 'osv-scan-result/v1' as const,
  agent: 'osv-scanner' as const,
  status: 'success' as const,
  environment: 'local',
  ecosystems: {
    npm: { ...baseEcosystem, vulnerabilities_total: 5, auto_safe: 3 },
  },
  error: null,
};

const blockedScanResult = {
  $schema: 'osv-scan-result/v1' as const,
  agent: 'osv-scanner' as const,
  status: 'success' as const,
  environment: 'local',
  ecosystems: {
    npm: { ...baseEcosystem, vulnerabilities_total: 5, auto_safe: 2, blocked: 2 },
    pip: { ...baseEcosystem, vulnerabilities_total: 3, blocked: 1 },
  },
  error: null,
};

const baseUpdates = {
  npm: {
    $schema: 'osv-update-result/v1' as const,
    agent: 'osv-fixer',
    status: 'success' as const,
    packages_updated: ['lodash', 'express', 'axios'],
    packages_skipped: [],
    packages_pending_breaking: [],
    validations: [{ name: 'tests', status: 'pass' as const }],
    error: null,
  },
};

describe('formatFixSummary()', () => {
  it('returns success summary when pipeline completes cleanly', () => {
    const input: FixSummaryInput = {
      scanResult: baseScanResult,
      updates: baseUpdates,
      hasPendingVulns: false,
      overallStatus: 'success',
    };

    const output = formatFixSummary(input);

    expect(output).toContain('Fix pipeline completed successfully.');
    expect(output).toContain('5 vulnerabilities found');
    expect(output).toContain('Fixed: 3 package(s)');
    expect(output).toContain('Remaining: 0');
  });

  it('shows warn-colored lines when hasPendingVulns is true', () => {
    const input: FixSummaryInput = {
      scanResult: baseScanResult,
      updates: baseUpdates,
      hasPendingVulns: true,
      overallStatus: 'success',
    };

    const output = formatFixSummary(input);

    expect(output).toContain('Fix pipeline completed — vulnerabilities remain.');
    expect(output).toContain('5 vulnerabilities found');
    expect(output).toContain('Fixed: 3 package(s)');
    expect(output).toContain('Remaining: vulnerabilities still pending');
  });

  it('includes report path when provided', () => {
    const input: FixSummaryInput = {
      scanResult: baseScanResult,
      updates: baseUpdates,
      hasPendingVulns: false,
      overallStatus: 'success',
      reportPath: '/reports/executive.md',
    };

    const output = formatFixSummary(input);

    expect(output).toContain('Report: /reports/executive.md');
  });

  it('includes audit trail path when provided', () => {
    const input: FixSummaryInput = {
      scanResult: baseScanResult,
      updates: baseUpdates,
      hasPendingVulns: false,
      overallStatus: 'success',
      auditTrailPath: '/reports/runs/2026-01-01.json',
    };

    const output = formatFixSummary(input);

    expect(output).toContain('Audit trail: /reports/runs/2026-01-01.json');
  });

  it('handles null scanResult gracefully (0 vulnerabilities)', () => {
    const input: FixSummaryInput = {
      scanResult: null,
      updates: {},
      hasPendingVulns: false,
      overallStatus: 'success',
    };

    const output = formatFixSummary(input);

    expect(output).toContain('0 vulnerabilities found');
    expect(output).toContain('Fixed: 0 package(s)');
  });

  it('shows error status message when overallStatus is error', () => {
    const input: FixSummaryInput = {
      scanResult: null,
      updates: {},
      hasPendingVulns: false,
      overallStatus: 'error',
    };

    const output = formatFixSummary(input);

    expect(output).toContain('Pipeline completed with errors.');
  });

  it('accumulates fixed count across multiple ecosystems', () => {
    const multiEcoUpdates = {
      npm: {
        ...baseUpdates.npm,
        packages_updated: ['lodash', 'express'],
      },
      composer: {
        $schema: 'osv-update-result/v1' as const,
        agent: 'osv-fixer',
        status: 'success' as const,
        packages_updated: ['symfony/http-kernel', 'guzzlehttp/guzzle'],
        packages_skipped: [],
        packages_pending_breaking: [],
        validations: [{ name: 'tests', status: 'pass' as const }],
        error: null,
      },
    };

    const input: FixSummaryInput = {
      scanResult: baseScanResult,
      updates: multiEcoUpdates,
      hasPendingVulns: false,
      overallStatus: 'success',
    };

    const output = formatFixSummary(input);

    expect(output).toContain('Fixed: 4 package(s)');
  });

  it('omits report and audit trail lines when not provided', () => {
    const input: FixSummaryInput = {
      scanResult: baseScanResult,
      updates: baseUpdates,
      hasPendingVulns: false,
      overallStatus: 'success',
    };

    const output = formatFixSummary(input);

    expect(output).not.toContain('Report:');
    expect(output).not.toContain('Audit trail:');
  });

  it('shows blocked count in remaining line when blockedCount > 0', () => {
    const input: FixSummaryInput = {
      scanResult: blockedScanResult,
      updates: baseUpdates,
      hasPendingVulns: true,
      overallStatus: 'success',
    };

    const output = formatFixSummary(input);

    // 2 (npm) + 1 (pip) = 3 blocked total
    expect(output).toContain('3 blocked');
    expect(output).toContain('rest manual or breaking');
  });

  it('uses old remaining message when blockedCount is 0', () => {
    const input: FixSummaryInput = {
      scanResult: baseScanResult,
      updates: baseUpdates,
      hasPendingVulns: true,
      overallStatus: 'success',
    };

    const output = formatFixSummary(input);

    expect(output).toContain('manual or breaking');
    expect(output).not.toContain('blocked,');
  });

  it('sums blocked count across multiple ecosystems', () => {
    const input: FixSummaryInput = {
      scanResult: blockedScanResult,
      updates: baseUpdates,
      hasPendingVulns: true,
      overallStatus: 'success',
    };

    const output = formatFixSummary(input);

    // npm.blocked=2 + pip.blocked=1 = 3
    expect(output).toContain('3 blocked');
  });

  it('handles null scanResult with 0 blocked count (no crash)', () => {
    const input: FixSummaryInput = {
      scanResult: null,
      updates: {},
      hasPendingVulns: true,
      overallStatus: 'success',
    };

    const output = formatFixSummary(input);

    // blockedCount is 0 when scanResult is null → use default message
    expect(output).toContain('manual or breaking');
    expect(output).not.toContain('blocked,');
  });
});

describe('formatBreakingWarning()', () => {
  it('returns empty string for empty entries array', () => {
    expect(formatBreakingWarning([])).toBe('');
  });

  it('formats a single ecosystem breaking warning', () => {
    const output = formatBreakingWarning([
      { pluginName: 'npm', entryKey: 'npm', count: 2, packages: ['lodash', 'express'] },
    ]);

    expect(output).toContain('Breaking-change updates were skipped:');
    expect(output).toContain('npm (npm): 2 package(s)');
    expect(output).toContain('- lodash');
    expect(output).toContain('- express');
    expect(output).toContain('--authorize-breaking npm');
  });

  it('groups multiple ecosystems and combines them in the authorize command', () => {
    const output = formatBreakingWarning([
      { pluginName: 'npm', entryKey: 'npm', count: 1, packages: ['lodash'] },
      { pluginName: 'Composer', entryKey: 'composer', count: 2, packages: ['symfony/http-kernel', 'guzzlehttp/guzzle'] },
    ]);

    expect(output).toContain('npm (npm): 1 package(s)');
    expect(output).toContain('Composer (composer): 2 package(s)');
    expect(output).toContain('- lodash');
    expect(output).toContain('- symfony/http-kernel');
    expect(output).toContain('- guzzlehttp/guzzle');
    expect(output).toContain('--authorize-breaking npm composer');
  });

  it('handles empty packages list gracefully', () => {
    const output = formatBreakingWarning([
      { pluginName: 'pip', entryKey: 'pip', count: 3, packages: [] },
    ]);

    expect(output).toContain('pip (pip): 3 package(s)');
    expect(output).toContain('--authorize-breaking pip');
    expect(output).not.toContain('- ');
  });

  it('uses entryKey format in the authorize command for monorepo entries', () => {
    const output = formatBreakingWarning([
      { pluginName: 'npm', entryKey: 'npm:frontend', count: 1, packages: ['react'] },
    ]);

    expect(output).toContain('--authorize-breaking npm:frontend');
  });

  it('ends with a newline', () => {
    const output = formatBreakingWarning([
      { pluginName: 'npm', entryKey: 'npm', count: 1, packages: ['lodash'] },
    ]);

    expect(output.endsWith('\n')).toBe(true);
  });
});
