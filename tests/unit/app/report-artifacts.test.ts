import type { ProjectConfig, EcosystemConfig } from '@core/types/config';
import type { ScanResultJson } from '@core/types/scan';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/report-artifact-plan', () => ({
  resolveArtifactPlan: vi.fn(),
}));

vi.mock('@modules/scanner/index', () => ({
  runScanner: vi.fn(),
}));

vi.mock('@reporting/executive', () => ({
  generateExecutiveReport: vi.fn(() => '# consolidated markdown'),
  generateEntryReport: vi.fn(() => '# entry markdown'),
  executiveReportFilename: vi.fn(() => 'base-report.md'),
  splitReportFilename: vi.fn((base: string, entryKey: string) => `base-report-${entryKey}.md`),
}));

vi.mock('@reporting/docx-executive', () => ({
  generateExecutiveReportDocx: vi.fn().mockResolvedValue(Buffer.from('fake-docx')),
  executiveReportDocxFilename: vi.fn(() => 'base-report.docx'),
}));

vi.mock('@reporting/sonarqube-report', () => ({
  generateSonarQubeHtmlReport: vi.fn(),
  sonarqubeHtmlReportFilename: vi.fn(() => 'base-report.html'),
}));

vi.mock('@app/report-saver', () => ({
  saveReport: vi.fn().mockResolvedValue({ localUrl: '/reports/report' }),
  resolveReportsDir: vi.fn(() => '/abs/reports'),
  resolveEngineReportsDir: vi.fn(() => '/abs/reports/sonarqube'),
}));

import { resolveArtifactPlan } from '@app/report-artifact-plan';
import type { ArtifactPlan } from '@app/report-artifact-plan';
import { generateAndSaveReportArtifacts } from '@app/report-artifacts';
import { saveReport } from '@app/report-saver';
import { runScanner } from '@modules/scanner/index';
import {
  generateExecutiveReport,
  generateEntryReport,
  splitReportFilename,
} from '@reporting/executive';
import { generateExecutiveReportDocx } from '@reporting/docx-executive';
import { generateSonarQubeHtmlReport } from '@reporting/sonarqube-report';

const mockResolveArtifactPlan = vi.mocked(resolveArtifactPlan);
const mockRunScanner = vi.mocked(runScanner);
const mockGenerateExecutiveReportDocx = vi.mocked(generateExecutiveReportDocx);
const mockGenerateSonarQubeHtmlReport = vi.mocked(generateSonarQubeHtmlReport);

function ecosystemResult() {
  return {
    vulnerabilities_total: 0,
    auto_safe: 0,
    breaking: 0,
    manual: 0,
    auto_safe_packages: [],
    breaking_packages: [],
    manual_packages: [],
    vulnerabilities: [],
  };
}

function scanResult(ecosystemKeys: string[]): ScanResultJson {
  const ecosystems: Record<string, ReturnType<typeof ecosystemResult>> = {};
  for (const key of ecosystemKeys) ecosystems[key] = ecosystemResult();
  return {
    $schema: 'https://example.test/schema.json',
    agent: 'osv-scanner',
    status: 'success',
    environment: 'local',
    ecosystems,
    error: null,
  };
}

const ecosystems: EcosystemConfig[] = [{ id: 'npm' }, { id: 'pip' }];

const baseConfig: ProjectConfig = {
  project: { name: 'Project', client: 'Acme' },
  ecosystems,
  protected_packages: {},
  safe_update_policy: {
    allow_patch_and_minor_within_constraints: true,
    require_authorization_for_constraint_change: false,
  },
  conflict_resolution: 'manual',
};

const baseInput = {
  runner: { environment: 'local' as const, run: vi.fn(), runArgs: vi.fn() },
  cwd: '/repo',
  config: baseConfig,
  scanBefore: scanResult(['npm', 'pip']),
  updates: { npm: { some: 'update' } as any, pip: { other: 'update' } as any },
};

function planWith(descriptors: ArtifactPlan['descriptors'], flags: Partial<Pick<ArtifactPlan, 'markdownEnabled' | 'docxEnabled'>> = {}): ArtifactPlan {
  return {
    markdownEnabled: flags.markdownEnabled ?? descriptors.some((d) => d.kind.startsWith('markdown')),
    docxEnabled: flags.docxEnabled ?? descriptors.some((d) => d.kind.startsWith('docx')),
    descriptors,
  };
}

describe('generateAndSaveReportArtifacts()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunScanner.mockResolvedValue(scanResult(['npm', 'pip']));
  });

  it('returns 0 and never scans or saves when neither markdown nor docx is enabled', async () => {
    mockResolveArtifactPlan.mockReturnValue(planWith([], { markdownEnabled: false, docxEnabled: false }));

    const code = await generateAndSaveReportArtifacts(baseInput);

    expect(code).toBe(0);
    expect(runScanner).not.toHaveBeenCalled();
    expect(saveReport).not.toHaveBeenCalled();
  });

  it('saves a markdown-split descriptor under the split filename', async () => {
    mockResolveArtifactPlan.mockReturnValue(planWith([{ kind: 'markdown-split', entryKey: 'npm' }]));

    await generateAndSaveReportArtifacts(baseInput);

    expect(generateEntryReport).toHaveBeenCalledWith(expect.anything(), 'npm');
    expect(splitReportFilename).toHaveBeenCalledWith('base-report.md', 'npm');
    expect(saveReport).toHaveBeenCalledWith('base-report-npm.md', '# entry markdown', '/abs/reports');
  });

  it('saves a docx-split descriptor under the split filename', async () => {
    mockResolveArtifactPlan.mockReturnValue(planWith([{ kind: 'docx-split', entryKey: 'pip' }]));

    await generateAndSaveReportArtifacts(baseInput);

    expect(generateExecutiveReportDocx).toHaveBeenCalledTimes(1);
    expect(saveReport).toHaveBeenCalledWith('base-report-pip.md', expect.any(Buffer), '/abs/reports');
  });

  it('filters scans and updates to the matching entryKey when building split docx options', async () => {
    mockResolveArtifactPlan.mockReturnValue(planWith([{ kind: 'docx-split', entryKey: 'npm' }]));

    await generateAndSaveReportArtifacts(baseInput);

    const optsPassed = mockGenerateExecutiveReportDocx.mock.calls[0]![0];
    expect(Object.keys(optsPassed.scanBefore.ecosystems)).toEqual(['npm']);
    expect(Object.keys(optsPassed.scanAfter.ecosystems)).toEqual(['npm']);
    expect(Object.keys(optsPassed.updates)).toEqual(['npm']);
    expect(optsPassed.ecosystems).toEqual([{ id: 'npm' }]);
  });

  it('falls back to all ecosystems with empty scan maps when entryKey matches none', async () => {
    mockResolveArtifactPlan.mockReturnValue(planWith([{ kind: 'docx-split', entryKey: 'composer' }]));

    await generateAndSaveReportArtifacts(baseInput);

    const optsPassed = mockGenerateExecutiveReportDocx.mock.calls[0]![0];
    expect(optsPassed.ecosystems).toEqual(ecosystems);
    expect(optsPassed.scanBefore.ecosystems).toEqual({});
    expect(optsPassed.scanAfter.ecosystems).toEqual({});
    expect(optsPassed.updates).toEqual({});
  });

  it('saves a markdown-consolidated descriptor under the base filename', async () => {
    mockResolveArtifactPlan.mockReturnValue(planWith([{ kind: 'markdown-consolidated' }]));

    await generateAndSaveReportArtifacts(baseInput);

    expect(generateExecutiveReport).toHaveBeenCalledTimes(1);
    expect(saveReport).toHaveBeenCalledWith('base-report.md', '# consolidated markdown', '/abs/reports');
  });

  it('saves a docx-consolidated descriptor under the base filename', async () => {
    mockResolveArtifactPlan.mockReturnValue(planWith([{ kind: 'docx-consolidated' }]));

    await generateAndSaveReportArtifacts(baseInput);

    expect(generateExecutiveReportDocx).toHaveBeenCalledWith(
      expect.objectContaining({ ecosystems }),
    );
    expect(saveReport).toHaveBeenCalledWith('base-report.docx', expect.any(Buffer), '/abs/reports');
  });

  it('saves nothing for a sonarqube-html descriptor when the generated report is falsy', async () => {
    mockGenerateSonarQubeHtmlReport.mockReturnValue(null as any);
    mockResolveArtifactPlan.mockReturnValue(planWith([{ kind: 'sonarqube-html' }], { markdownEnabled: true }));

    await generateAndSaveReportArtifacts(baseInput);

    expect(saveReport).not.toHaveBeenCalled();
  });

  it('saves a truthy sonarqube-html report into the sonar reports dir', async () => {
    mockGenerateSonarQubeHtmlReport.mockReturnValue('<html>report</html>');
    mockResolveArtifactPlan.mockReturnValue(planWith([{ kind: 'sonarqube-html' }], { markdownEnabled: true }));

    await generateAndSaveReportArtifacts(baseInput);

    expect(saveReport).toHaveBeenCalledWith('base-report.html', '<html>report</html>', '/abs/reports/sonarqube');
  });

  it('runs the scanner exactly once regardless of how many descriptors are in the plan', async () => {
    mockResolveArtifactPlan.mockReturnValue(
      planWith([{ kind: 'markdown-consolidated' }, { kind: 'docx-consolidated' }]),
    );

    await generateAndSaveReportArtifacts(baseInput);

    expect(runScanner).toHaveBeenCalledTimes(1);
  });
});
