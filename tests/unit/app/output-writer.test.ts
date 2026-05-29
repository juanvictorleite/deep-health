/**
 * Tests for src/app/output-writer.ts
 * Covers writeOutput, formatScanSummary (terminal), and formatScanSummaryMarkdown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock chalk so ANSI codes don't interfere with string assertions
vi.mock('chalk', async () => {
  const identity = (s: string) => s;
  const chalkMock: Record<string, unknown> = {};
  const props = ['bold', 'gray', 'dim', 'yellow', 'green', 'white'];
  for (const p of props) {
    chalkMock[p] = identity;
    (identity as unknown as Record<string, unknown>)[p] = identity;
  }
  chalkMock.hex = () => identity;
  chalkMock.default = new Proxy(identity, {
    get: (_t, key) => {
      if (key === 'hex') return () => identity;
      return identity;
    },
  });
  return { default: chalkMock.default, ...chalkMock };
});

vi.mock('@infra/utils/ui', () => {
  const identity = (s: string) => s;
  return {
    SCANNER_COLORS: new Map([
      ['npm', identity],
      ['composer', identity],
      ['pip', identity],
    ]),
    warn: identity,
    dim: identity,
    success: identity,
    badge: (id: string) => `[${id.toUpperCase()}]`,
    divider: () => '─'.repeat(60),
    error: identity,
  };
});

import { mkdir, writeFile } from 'node:fs/promises';

import { writeOutput, formatScanSummary, formatScanSummaryMarkdown } from '@app/output-writer';
import type { ScanResultJson } from '@core/types/scan';

const baseScan: ScanResultJson = {
  $schema: '',
  status: 'success',
  environment: 'local',
  agent: 'osv-scanner',
  ecosystems: {
    npm: {
      vulnerabilities_total: 2,
      auto_safe: 1,
      breaking: 1,
      manual: 0,
      auto_safe_packages: [],
      breaking_packages: [],
      manual_packages: [],
      vulnerabilities: [],
    },
  },
  error: null,
};

const blockedScan: ScanResultJson = {
  $schema: '',
  status: 'success',
  environment: 'local',
  agent: 'osv-scanner',
  ecosystems: {
    npm: {
      vulnerabilities_total: 3,
      auto_safe: 1,
      breaking: 1,
      manual: 0,
      blocked: 2,
      blocked_packages: ['lodash', 'express'],
      auto_safe_packages: [],
      breaking_packages: [],
      manual_packages: [],
      vulnerabilities: [],
    },
  },
  error: null,
};

const cleanScan: ScanResultJson = {
  $schema: '',
  status: 'success',
  environment: 'local',
  agent: 'osv-scanner',
  ecosystems: {
    npm: {
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

const multiEcoScan: ScanResultJson = {
  $schema: '',
  status: 'success',
  environment: 'local',
  agent: 'osv-scanner',
  ecosystems: {
    npm: {
      vulnerabilities_total: 3,
      auto_safe: 1,
      breaking: 2,
      manual: 0,
      auto_safe_packages: [],
      breaking_packages: [],
      manual_packages: [],
      vulnerabilities: [],
    },
    pip: {
      vulnerabilities_total: 1,
      auto_safe: 0,
      breaking: 0,
      manual: 1,
      auto_safe_packages: [],
      breaking_packages: [],
      manual_packages: [],
      vulnerabilities: [],
    },
  },
  error: null,
};

// ─── writeOutput() ────────────────────────────────────────────────────────────

describe('writeOutput()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes to file when outputPath is provided', async () => {
    await writeOutput('content', '/some/path/report.md');
    expect(mkdir).toHaveBeenCalledWith('/some/path', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith('/some/path/report.md', 'content', 'utf-8');
  });

  it('writes to stdout when no outputPath', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await writeOutput('hello output');
    expect(stdoutSpy).toHaveBeenCalledWith('hello output\n');
    stdoutSpy.mockRestore();
  });
});

// ─── formatScanSummary() — terminal-formatted ────────────────────────────────

describe('formatScanSummary()', () => {
  it('includes the report date header', () => {
    const result = formatScanSummary(baseScan);
    expect(result).toContain('OSV Scan Report');
    // Should include a date like YYYY-MM-DD
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('includes ecosystem name in output', () => {
    const result = formatScanSummary(baseScan);
    expect(result).toContain('npm');
  });

  it('includes column headers', () => {
    const result = formatScanSummary(baseScan);
    expect(result).toContain('Ecosystem');
    expect(result).toContain('Total');
    expect(result).toContain('Auto-safe');
    expect(result).toContain('Blocked');
    expect(result).toContain('Breaking');
    expect(result).toContain('Manual');
  });

  it('shows blocked count of 0 (dim) when blocked is undefined', () => {
    const result = formatScanSummary(baseScan);
    // baseScan has no blocked field — defaults to 0
    expect(result).toContain('0');
  });

  it('shows blocked count when blocked > 0', () => {
    const result = formatScanSummary(blockedScan);
    expect(result).toContain('2');
  });

  it('uses warn styling for blocked > 0 (blocked column present in row)', () => {
    const result = formatScanSummary(blockedScan);
    // Since warn() is mocked as identity, the blocked count 2 should appear in output
    expect(result).toContain('2');
    expect(result).toContain('Blocked');
  });

  it('includes vulnerability counts', () => {
    const result = formatScanSummary(baseScan);
    expect(result).toContain('2'); // total
    expect(result).toContain('1'); // auto_safe and breaking
  });

  it('includes footer with total vulnerability count', () => {
    const result = formatScanSummary(baseScan);
    expect(result).toContain('2 vulnerabilities across 1 ecosystem(s).');
  });

  it('shows no-vulnerability success message when clean', () => {
    const result = formatScanSummary(cleanScan);
    expect(result).toContain('No vulnerabilities found');
  });

  it('does NOT show table when scan is clean', () => {
    const result = formatScanSummary(cleanScan);
    expect(result).not.toContain('Ecosystem');
    expect(result).not.toContain('Auto-safe');
  });

  it('does NOT show success message when there are vulnerabilities', () => {
    const result = formatScanSummary(baseScan);
    expect(result).not.toContain('No vulnerabilities found');
  });

  it('shows totals across multiple ecosystems in footer', () => {
    const result = formatScanSummary(multiEcoScan);
    // Total = 3 + 1 = 4 across 2 ecosystems
    expect(result).toContain('4 vulnerabilities across 2 ecosystem(s).');
  });

  it('includes all ecosystem rows in multi-ecosystem scan', () => {
    const result = formatScanSummary(multiEcoScan);
    expect(result).toContain('npm');
    expect(result).toContain('pip');
  });

  it('shows error warning when scan.error is set', () => {
    const scanWithError: ScanResultJson = { ...baseScan, status: 'error', error: 'scanner failed' };
    const result = formatScanSummary(scanWithError);
    expect(result).toContain('Warning');
    expect(result).toContain('scanner failed');
  });

  it('does not include Warning line when no error', () => {
    const result = formatScanSummary(baseScan);
    expect(result).not.toContain('Warning:');
  });

  it('does not include Warning when error is null', () => {
    const result = formatScanSummary(cleanScan);
    expect(result).not.toContain('Warning');
  });
});

// ─── formatScanSummaryMarkdown() — markdown for file output ──────────────────

describe('formatScanSummaryMarkdown()', () => {
  it('includes markdown header', () => {
    const result = formatScanSummaryMarkdown(baseScan);
    expect(result).toContain('## OSV Scan Report');
  });

  it('includes environment label', () => {
    const result = formatScanSummaryMarkdown(baseScan);
    expect(result).toContain('local');
  });

  it('includes ecosystem heading with markdown H3', () => {
    const result = formatScanSummaryMarkdown(baseScan);
    expect(result).toContain('### npm');
  });

  it('includes markdown list items for stats', () => {
    const result = formatScanSummaryMarkdown(baseScan);
    expect(result).toContain('- Total: 2');
    expect(result).toContain('- Auto-safe: 1');
    expect(result).toContain('- Blocked: 0');
    expect(result).toContain('- Breaking: 1');
    expect(result).toContain('- Manual: 0');
  });

  it('includes blocked line after auto-safe line', () => {
    const result = formatScanSummaryMarkdown(baseScan);
    const autoSafeIdx = result.indexOf('- Auto-safe:');
    const blockedIdx = result.indexOf('- Blocked:');
    const breakingIdx = result.indexOf('- Breaking:');
    expect(autoSafeIdx).toBeLessThan(blockedIdx);
    expect(blockedIdx).toBeLessThan(breakingIdx);
  });

  it('shows non-zero blocked count in markdown', () => {
    const result = formatScanSummaryMarkdown(blockedScan);
    expect(result).toContain('- Blocked: 2');
  });

  it('shows zero blocked count in markdown when eco has no blocked field', () => {
    const result = formatScanSummaryMarkdown(baseScan);
    expect(result).toContain('- Blocked: 0');
  });

  it('includes error warning when scan.error is set', () => {
    const scanWithError: ScanResultJson = { ...baseScan, status: 'error', error: 'scanner failed' };
    const result = formatScanSummaryMarkdown(scanWithError);
    expect(result).toContain('**Warning:** scanner failed');
  });

  it('does not include Warning line when no error', () => {
    const result = formatScanSummaryMarkdown(baseScan);
    expect(result).not.toContain('Warning');
  });

  it('includes a date in the header', () => {
    const result = formatScanSummaryMarkdown(baseScan);
    expect(result).toMatch(/## OSV Scan Report — \d{4}-\d{2}-\d{2}/);
  });

  it('includes multiple ecosystem sections', () => {
    const result = formatScanSummaryMarkdown(multiEcoScan);
    expect(result).toContain('### npm');
    expect(result).toContain('### pip');
  });
});
