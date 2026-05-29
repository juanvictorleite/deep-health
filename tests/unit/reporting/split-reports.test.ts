/**
 * Unit tests for split-report helpers added in src/reporting/executive.ts
 * and the split-report mode in src/app/report-artifacts.ts.
 *
 * AC1: --split-reports generates one report per ecosystem entry.
 * AC2: Split filenames include the entry identifier.
 * AC3: Without --split-reports, consolidated behavior is unchanged.
 * AC4: outputs.split_reports: true is equivalent to --split-reports (CLI overrides config).
 * AC5: buildEntryReportContext — only vulns from target entry appear.
 * AC6: splitReportFilename generates correct per-entry filename.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildEntryReportContext,
  splitReportFilename,
  executiveReportFilename,
} from '@reporting/executive';

// ── fixtures ─────────────────────────────────────────────────────────────────

const emptyScan: ScanResultJson = {
  agent: 'osv-scanner',
  status: 'success',
  environment: 'local',
  ecosystems: {},
  error: null,
};

function makeVuln(ecosystem: string, pkg: string) {
  return {
    ecosystem,
    package: pkg,
    ghsaId: `GHSA-0000-0000-${pkg}`.slice(0, 25),
    cvss: '7.5',
    risk: 'High',
    currentVersion: '1.0.0',
    safeVersion: '1.0.1',
    classification: 'auto_safe' as const,
    reason: '',
  };
}

const frontendVuln = makeVuln('npm:frontend', 'lodash');
const apiVuln = makeVuln('npm:api', 'express');

const splitScanBefore: ScanResultJson = {
  agent: 'osv-scanner',
  status: 'success',
  environment: 'local',
  ecosystems: {
    'npm:frontend': {
      vulnerabilities_total: 1,
      auto_safe: 1,
      breaking: 0,
      manual: 0,
      auto_safe_packages: ['lodash'],
      breaking_packages: [],
      manual_packages: [],
      vulnerabilities: [frontendVuln],
    },
    'npm:api': {
      vulnerabilities_total: 1,
      auto_safe: 1,
      breaking: 0,
      manual: 0,
      auto_safe_packages: ['express'],
      breaking_packages: [],
      manual_packages: [],
      vulnerabilities: [apiVuln],
    },
  },
  error: null,
};

const splitEcosystems = [
  { id: 'npm', label: 'frontend' },
  { id: 'npm', label: 'api' },
];

const baseOpts: ExecutiveReportOptions = {
  client: 'Client',
  project: 'Project',
  scanBefore: splitScanBefore,
  scanAfter: emptyScan,
  updates: {},
  ecosystems: splitEcosystems,
};

// ── AC5: buildEntryReportContext filtering ────────────────────────────────────

describe('buildEntryReportContext()', () => {
  it('only includes vulns from the target entry in the scoped context', () => {
    const ctx = buildEntryReportContext(baseOpts, 'npm:frontend') as Record<string, unknown>;
    // allVulnsBefore should only have lodash, not express
    const allVulns = ctx['allVulnsBefore'] as { package: string }[];
    expect(allVulns.some((v) => v.package === 'lodash')).toBe(true);
    expect(allVulns.some((v) => v.package === 'express')).toBe(false);
  });

  it('only includes vulns from npm:api when scoped to npm:api', () => {
    const ctx = buildEntryReportContext(baseOpts, 'npm:api') as Record<string, unknown>;
    const allVulns = ctx['allVulnsBefore'] as { package: string }[];
    expect(allVulns.some((v) => v.package === 'express')).toBe(true);
    expect(allVulns.some((v) => v.package === 'lodash')).toBe(false);
  });

  it('returns an empty vuln set when entryKey has no scan data', () => {
    const ctx = buildEntryReportContext(baseOpts, 'npm:nonexistent') as Record<string, unknown>;
    expect(ctx['totalBefore']).toBe(0);
    expect(ctx['noVulns']).toBe(true);
  });

  it('includes correct client and project in context', () => {
    const ctx = buildEntryReportContext(baseOpts, 'npm:frontend') as Record<string, unknown>;
    expect(ctx['client']).toBe('Client');
    expect(ctx['project']).toBe('Project');
  });

  it('scopes ecosystems to the single entry', () => {
    const ctx = buildEntryReportContext(baseOpts, 'npm:frontend') as Record<string, unknown>;
    const sections = ctx['evidenceSections'] as { id: string }[];
    expect(sections.length).toBe(1);
    expect(sections[0]!.id).toBe('npm:frontend');
  });
});

// ── AC6: splitReportFilename ──────────────────────────────────────────────────

describe('splitReportFilename()', () => {
  it('inserts entry key slug into the filename before date part', () => {
    const base = '[Client Project] Security Report - 2026-05 - May.md';
    const result = splitReportFilename(base, 'npm:frontend');
    expect(result).toBe('[Client Project] Security Report - npm-frontend - 2026-05 - May.md');
  });

  it('replaces colon with hyphen in the slug', () => {
    const base = '[Client Project] Security Report - 2026-05 - May.md';
    const result = splitReportFilename(base, 'npm:api');
    expect(result).toContain('npm-api');
    expect(result).not.toContain('npm:api');
  });

  it('works for entries without a label (bare id)', () => {
    const base = '[Client Project] Security Report - 2026-05 - May.md';
    const result = splitReportFilename(base, 'npm');
    expect(result).toBe('[Client Project] Security Report - npm - 2026-05 - May.md');
  });

  it('preserves the .md extension', () => {
    const base = executiveReportFilename('Acme', 'Web App');
    const result = splitReportFilename(base, 'npm:frontend');
    expect(result).toMatch(/\.md$/);
  });

  it('returns base-slug for a filename with no dot', () => {
    const result = splitReportFilename('report', 'npm:api');
    expect(result).toBe('report-npm-api');
  });

  it('works for .docx extension', () => {
    const base = '[Client Project] Security Report - 2026-05 - May.docx';
    const result = splitReportFilename(base, 'npm:backend');
    expect(result).toBe('[Client Project] Security Report - npm-backend - 2026-05 - May.docx');
  });
});

// ── AC1, AC2, AC3, AC4: generateAndSaveReportArtifacts split mode ────────────

vi.mock('@modules/scanner/index', () => ({
  runScanner: vi.fn(),
}));

vi.mock('@reporting/executive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reporting/executive')>();
  return {
    ...actual,
    generateExecutiveReport: vi.fn(() => '# consolidated report'),
    generateEntryReport: vi.fn((opts: unknown, key: string) => `# entry report for ${key}`),
    executiveReportFilename: vi.fn(
      () => '[Client Project] Security Report - 2026-05 - May.md',
    ),
    splitReportFilename: actual.splitReportFilename,
    buildEntryReportContext: actual.buildEntryReportContext,
  };
});

vi.mock('@reporting/docx-executive', () => ({
  generateExecutiveReportDocx: vi.fn().mockResolvedValue(Buffer.from('docx')),
  executiveReportDocxFilename: vi.fn(
    () => '[Client Project] Security Report - 2026-05 - May.docx',
  ),
}));

vi.mock('@reporting/sonarqube-report', () => ({
  generateSonarQubeHtmlReport: vi.fn(() => null),
  sonarqubeHtmlReportFilename: vi.fn(() => 'sonar.html'),
}));

vi.mock('@app/report-saver', () => ({
  saveReport: vi.fn().mockResolvedValue({ localUrl: '/r/f', cloudSkipped: true }),
  resolveReportsDir: vi.fn(() => '/abs/reports'),
  resolveEngineReportsDir: vi.fn(() => '/abs/reports'),
}));

import { generateAndSaveReportArtifacts } from '@app/report-artifacts';
import { saveReport } from '@app/report-saver';
import type { ProjectConfig } from '@core/types/config';
import type { ExecutiveReportOptions } from '@core/types/report';
import type { ScanResultJson } from '@core/types/scan';
import { runScanner } from '@modules/scanner/index';
import { generateExecutiveReport, generateEntryReport } from '@reporting/executive';

const multiEntryConfig: ProjectConfig = {
  project: { name: 'Project', client: 'Client' },
  ecosystems: [
    { id: 'npm', label: 'frontend' },
    { id: 'npm', label: 'api' },
  ],
  protected_packages: {},
  safe_update_policy: {
    allow_patch_and_minor_within_constraints: true,
    require_authorization_for_constraint_change: false,
  },
  conflict_resolution: 'manual',
};

const singleEcoConfig: ProjectConfig = {
  ...multiEntryConfig,
  ecosystems: [{ id: 'npm' }],
};

const baseInput = {
  runner: { environment: 'local' as const, run: vi.fn(), runArgs: vi.fn() },
  cwd: '/repo',
  scanBefore: emptyScan,
  updates: {},
};

describe('generateAndSaveReportArtifacts() — split mode (AC1, AC2, AC3, AC4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runScanner).mockResolvedValue(emptyScan);
  });

  // AC1: generates one report per entry
  it('(AC1) generates one report per ecosystem entry in split mode', async () => {
    const code = await generateAndSaveReportArtifacts({
      ...baseInput,
      config: { ...multiEntryConfig, outputs: { formats: ['markdown'] } },
      splitReports: true,
    });
    expect(code).toBe(0);
    // generateEntryReport called once per ecosystem entry (2 entries)
    expect(generateEntryReport).toHaveBeenCalledTimes(2);
    expect(generateExecutiveReport).not.toHaveBeenCalled();
  });

  // AC2: split filenames include entry identifier
  it('(AC2) split report filenames include the entry identifier', async () => {
    const savedFilenames: string[] = [];
    vi.mocked(saveReport).mockImplementation(async (filename: string) => {
      savedFilenames.push(filename);
      return { localUrl: `/r/${filename}`, cloudSkipped: true };
    });

    await generateAndSaveReportArtifacts({
      ...baseInput,
      config: { ...multiEntryConfig, outputs: { formats: ['markdown'] } },
      splitReports: true,
    });

    expect(savedFilenames.length).toBe(2);
    expect(savedFilenames.some((f) => f.includes('npm-frontend'))).toBe(true);
    expect(savedFilenames.some((f) => f.includes('npm-api'))).toBe(true);
  });

  // AC3: consolidated mode unchanged when splitReports is false
  it('(AC3) consolidated mode uses generateExecutiveReport and single save', async () => {
    await generateAndSaveReportArtifacts({
      ...baseInput,
      config: { ...multiEntryConfig, outputs: { formats: ['markdown'] } },
      splitReports: false,
    });
    expect(generateExecutiveReport).toHaveBeenCalledTimes(1);
    expect(generateEntryReport).not.toHaveBeenCalled();
    expect(saveReport).toHaveBeenCalledTimes(1);
  });

  // AC3: consolidated mode unchanged when splitReports is not set at all
  it('(AC3) consolidated mode is default when splitReports is absent', async () => {
    await generateAndSaveReportArtifacts({
      ...baseInput,
      config: { ...multiEntryConfig, outputs: { formats: ['markdown'] } },
    });
    expect(generateExecutiveReport).toHaveBeenCalledTimes(1);
    expect(generateEntryReport).not.toHaveBeenCalled();
  });

  // AC4: config outputs.split_reports: true activates split mode
  it('(AC4) config outputs.split_reports: true activates split mode', async () => {
    await generateAndSaveReportArtifacts({
      ...baseInput,
      config: {
        ...multiEntryConfig,
        outputs: { formats: ['markdown'], split_reports: true },
      },
    });
    expect(generateEntryReport).toHaveBeenCalledTimes(2);
    expect(generateExecutiveReport).not.toHaveBeenCalled();
  });

  // AC4: CLI flag (splitReports: true) overrides config split_reports: false
  it('(AC4) CLI flag splitReports:true overrides config split_reports:false', async () => {
    await generateAndSaveReportArtifacts({
      ...baseInput,
      config: {
        ...multiEntryConfig,
        outputs: { formats: ['markdown'], split_reports: false },
      },
      splitReports: true,
    });
    expect(generateEntryReport).toHaveBeenCalledTimes(2);
    expect(generateExecutiveReport).not.toHaveBeenCalled();
  });

  // AC4: CLI flag (splitReports: false) overrides config split_reports: true
  it('(AC4) CLI flag splitReports:false overrides config split_reports:true', async () => {
    await generateAndSaveReportArtifacts({
      ...baseInput,
      config: {
        ...multiEntryConfig,
        outputs: { formats: ['markdown'], split_reports: true },
      },
      splitReports: false,
    });
    expect(generateExecutiveReport).toHaveBeenCalledTimes(1);
    expect(generateEntryReport).not.toHaveBeenCalled();
  });

  // Split mode: single entry generates exactly one report
  it('single-entry config in split mode generates one report', async () => {
    await generateAndSaveReportArtifacts({
      ...baseInput,
      config: { ...singleEcoConfig, outputs: { formats: ['markdown'] } },
      splitReports: true,
    });
    expect(generateEntryReport).toHaveBeenCalledTimes(1);
    expect(saveReport).toHaveBeenCalledTimes(1);
  });

  // Returns 1 when cloud upload fails in split mode and require_upload is true
  it('returns 1 when cloud upload fails in split mode and require_upload is true', async () => {
    vi.mocked(saveReport).mockResolvedValue({
      localUrl: '/r/f',
      cloudError: 'auth failed',
      cloudSkipped: false,
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const code = await generateAndSaveReportArtifacts({
      ...baseInput,
      config: {
        ...multiEntryConfig,
        outputs: { formats: ['markdown'] },
        cloud_storage: { provider: 'google_drive', folder_id: 'fid123456789', require_upload: true },
      },
      splitReports: true,
    });
    expect(code).toBe(1);
    stderrSpy.mockRestore();
  });

  // Returns 0 when no formats are configured (even in split mode)
  it('returns 0 immediately when no formats are enabled', async () => {
    const code = await generateAndSaveReportArtifacts({
      ...baseInput,
      config: { ...multiEntryConfig, outputs: { formats: [] } },
      splitReports: true,
    });
    expect(code).toBe(0);
    expect(generateEntryReport).not.toHaveBeenCalled();
    expect(generateExecutiveReport).not.toHaveBeenCalled();
  });
});
