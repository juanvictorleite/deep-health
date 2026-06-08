/**
 * Tests for src/app/commands/scan.ts — runScanCommand
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/scanner/index', () => ({
  runScanner: vi.fn(),
}));

vi.mock('@app/output-writer', () => ({
  writeOutput: vi.fn().mockResolvedValue(undefined),
  formatScanSummary: vi.fn().mockReturnValue('Terminal Scan Summary'),
  formatScanSummaryMarkdown: vi.fn().mockReturnValue('## Markdown Scan Summary'),
}));

import { runScanCommand } from '@app/commands/scan';
import { writeOutput, formatScanSummary, formatScanSummaryMarkdown } from '@app/output-writer';
import type { RunContext } from '@app/run-context';
import type { ScanResultJson } from '@core/types/scan';
import { runScanner } from '@modules/scanner/index';

function makeCtx(): RunContext {
  return {
    config: { project: { name: 'test', client: 'acme' }, ecosystems: [] } as any,
    runner: { run: vi.fn(), runArgs: vi.fn(), dryRun: false, environment: 'local' as const },
  } as unknown as RunContext;
}

function makeScan(status: string, breaking = 0): ScanResultJson {
  return {
    $schema: '',
    status: status as 'success' | 'error',
    environment: 'local',
    agent: 'osv-scanner',
    ecosystems: {
      npm: {
        vulnerabilities_total: 0,
        auto_safe: 0,
        breaking,
        manual: 0,
        auto_safe_packages: [],
        breaking_packages: [],
        manual_packages: [],
        vulnerabilities: [],
      },
    },
    error: null,
  };
}

describe('runScanCommand()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when scan is clean', async () => {
    vi.mocked(runScanner).mockResolvedValue(makeScan('success', 0));
    const code = await runScanCommand(makeCtx(), {
      config: 'security-scan.config.json',
      cwd: '/proj',
      dryRun: false,
      verbose: false,
      quiet: false,
      json: false,
    });
    expect(code).toBe(0);
  });

  it('returns 1 when scan has breaking vulnerabilities', async () => {
    vi.mocked(runScanner).mockResolvedValue(makeScan('success', 2));
    const code = await runScanCommand(makeCtx(), {
      config: 'security-scan.config.json',
      cwd: '/proj',
      dryRun: false,
      verbose: false,
      quiet: false,
      json: false,
    });
    expect(code).toBe(1);
  });

  it('returns 2 when scan status is error', async () => {
    vi.mocked(runScanner).mockResolvedValue(makeScan('error', 0));
    const code = await runScanCommand(makeCtx(), {
      config: 'security-scan.config.json',
      cwd: '/proj',
      dryRun: false,
      verbose: false,
      quiet: false,
      json: false,
    });
    expect(code).toBe(2);
  });

  it('passes JSON output when json=true', async () => {
    vi.mocked(runScanner).mockResolvedValue(makeScan('success', 0));
    await runScanCommand(makeCtx(), {
      config: 'security-scan.config.json',
      cwd: '/proj',
      dryRun: false,
      verbose: false,
      quiet: false,
      json: true,
    });
    expect(formatScanSummary).not.toHaveBeenCalled();
    expect(formatScanSummaryMarkdown).not.toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalledWith(expect.stringContaining('{'), undefined);
  });

  it('uses formatScanSummary (terminal) for stdout — no output path', async () => {
    vi.mocked(runScanner).mockResolvedValue(makeScan('success', 0));
    await runScanCommand(makeCtx(), {
      config: 'security-scan.config.json',
      cwd: '/proj',
      dryRun: false,
      verbose: false,
      quiet: false,
      json: false,
    });
    expect(formatScanSummary).toHaveBeenCalled();
    expect(formatScanSummaryMarkdown).not.toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalledWith('Terminal Scan Summary', undefined);
  });

  it('uses formatScanSummaryMarkdown when --output path is provided', async () => {
    vi.mocked(runScanner).mockResolvedValue(makeScan('success', 0));
    await runScanCommand(makeCtx(), {
      config: 'security-scan.config.json',
      cwd: '/proj',
      dryRun: false,
      verbose: false,
      quiet: false,
      json: false,
      output: '/out/report.md',
    });
    expect(formatScanSummaryMarkdown).toHaveBeenCalled();
    expect(formatScanSummary).not.toHaveBeenCalled();
    expect(writeOutput).toHaveBeenCalledWith('## Markdown Scan Summary', '/out/report.md');
  });

  it('passes output path to writeOutput when provided', async () => {
    vi.mocked(runScanner).mockResolvedValue(makeScan('success', 0));
    await runScanCommand(makeCtx(), {
      config: 'security-scan.config.json',
      cwd: '/proj',
      dryRun: false,
      verbose: false,
      quiet: false,
      json: false,
      output: '/out/report.md',
    });
    expect(writeOutput).toHaveBeenCalledWith(expect.any(String), '/out/report.md');
  });
});
