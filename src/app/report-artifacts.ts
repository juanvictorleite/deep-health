import { resolveArtifactPlan } from '@app/report-artifact-plan';
import type { ArtifactDescriptor } from '@app/report-artifact-plan';
import { saveReport, resolveReportsDir, resolveEngineReportsDir } from '@app/report-saver';
import type { CommandRunner } from '@core/types/common';
import type { ProjectConfig, EcosystemConfig } from '@core/types/config';
import { ecosystemEntryKey, DEFAULT_SONAR_REPORT_METRICS } from '@core/types/config';
import type { SupportedLocale } from '@core/types/locale';
import type { AdvisorResult, ResidualVerification, ExecutiveReportOptions } from '@core/types/report';
import type { ScanResultJson } from '@core/types/scan';
import type { UpdateResultJson } from '@core/types/update';
import { runScanner } from '@modules/scanner/index';
import { generateExecutiveReportDocx, executiveReportDocxFilename } from '@reporting/docx-executive';
import {
  generateExecutiveReport,
  generateEntryReport,
  executiveReportFilename,
  splitReportFilename,
} from '@reporting/executive';
import { generateSonarQubeHtmlReport, sonarqubeHtmlReportFilename } from '@reporting/sonarqube-report';

export interface ReportArtifactsInput {
  runner: CommandRunner;
  cwd: string;
  config: ProjectConfig;
  client?: string;
  project?: string;
  scanBefore: ScanResultJson;
  updates: Record<string, UpdateResultJson>;
  engineResults?: Record<string, ScanResultJson>;
  advisorResults?: Record<string, AdvisorResult[]>;
  residualVerification?: ResidualVerification;
  splitReports?: boolean;
}

interface ReportOpts {
  client: string;
  project: string;
  scanBefore: ScanResultJson;
  scanAfter: ScanResultJson;
  updates: Record<string, UpdateResultJson>;
  ecosystems: EcosystemConfig[];
  engineResults?: Record<string, ScanResultJson>;
  advisorResults?: Record<string, AdvisorResult[]>;
  residualVerification?: ResidualVerification;
  locale?: SupportedLocale;
  sonarqubeMetrics?: string[];
}

interface ArtifactExecutionContext {
  reportOpts: ReportOpts;
  client: string;
  project: string;
  reportsDir: string;
  sonarReportsDir: string;
}

interface ArtifactPaths {
  reportsDir: string;
  sonarReportsDir: string;
  sonarqubeMetrics: string[];
}

function resolveArtifactPaths(cwd: string, config: ProjectConfig): ArtifactPaths {
  const outputsConfig = config.outputs;
  const reportsDir = resolveReportsDir(cwd, outputsConfig?.dir);
  const subFoldersEnabled = outputsConfig?.sub_folders ?? false;
  const sonarReportsDir = resolveEngineReportsDir(
    reportsDir,
    subFoldersEnabled ? 'sonarqube' : undefined,
  );
  const sonarqubeMetrics = outputsConfig?.sonarqube_metrics ?? [...DEFAULT_SONAR_REPORT_METRICS];
  return { reportsDir, sonarReportsDir, sonarqubeMetrics };
}

export async function generateAndSaveReportArtifacts(
  input: ReportArtifactsInput,
): Promise<number> {
  const { runner, cwd, config, scanBefore, updates, engineResults, advisorResults, residualVerification } = input;

  const client = input.client ?? config.project.client;
  const project = input.project ?? config.project.name;

  const plan = resolveArtifactPlan({ config, splitReports: input.splitReports, engineResults });
  if (!plan.markdownEnabled && !plan.docxEnabled) return 0;

  const { reportsDir, sonarReportsDir, sonarqubeMetrics } = resolveArtifactPaths(cwd, config);

  const reportOpts: ReportOpts = {
    client,
    project,
    scanBefore,
    scanAfter: await runScanner(runner, config, cwd),
    updates,
    ecosystems: config.ecosystems,
    engineResults,
    locale: config.report_language,
    advisorResults,
    residualVerification,
    sonarqubeMetrics,
  };

  const ctx: ArtifactExecutionContext = { reportOpts, client, project, reportsDir, sonarReportsDir };

  for (const descriptor of plan.descriptors) {
    await executeArtifactDescriptor(descriptor, ctx);
  }

  return 0;
}

async function executeArtifactDescriptor(
  descriptor: ArtifactDescriptor,
  ctx: ArtifactExecutionContext,
): Promise<void> {
  switch (descriptor.kind) {
    case 'markdown-split':
      await saveMarkdownSplit(ctx, descriptor.entryKey!);
      return;
    case 'docx-split':
      await saveDocxSplit(ctx, descriptor.entryKey!);
      return;
    case 'markdown-consolidated':
      await saveMarkdownConsolidated(ctx);
      return;
    case 'docx-consolidated':
      await saveDocxConsolidated(ctx);
      return;
    case 'sonarqube-html':
      await saveSonarHtml(ctx);
      return;
  }
}

async function saveMarkdownSplit(ctx: ArtifactExecutionContext, entryKey: string): Promise<void> {
  const entryReport = generateEntryReport(ctx.reportOpts, entryKey);
  const baseFilename = executiveReportFilename(ctx.client, ctx.project);
  const filename = splitReportFilename(baseFilename, entryKey);
  await saveReport(filename, entryReport, ctx.reportsDir);
}

async function saveDocxSplit(ctx: ArtifactExecutionContext, entryKey: string): Promise<void> {
  const baseDocxFilename = executiveReportDocxFilename(ctx.client, ctx.project);
  const docxFilename = splitReportFilename(baseDocxFilename, entryKey);
  const entryOpts = buildEntryReportOptsForSplit(ctx.reportOpts, entryKey);
  const docxBuffer = await generateExecutiveReportDocx(entryOpts);
  await saveReport(docxFilename, docxBuffer, ctx.reportsDir);
}

async function saveMarkdownConsolidated(ctx: ArtifactExecutionContext): Promise<void> {
  const execReport = generateExecutiveReport(ctx.reportOpts);
  const filename = executiveReportFilename(ctx.client, ctx.project);
  await saveReport(filename, execReport, ctx.reportsDir);
}

async function saveDocxConsolidated(ctx: ArtifactExecutionContext): Promise<void> {
  const docxBuffer = await generateExecutiveReportDocx(ctx.reportOpts);
  const docxFilename = executiveReportDocxFilename(ctx.client, ctx.project);
  await saveReport(docxFilename, docxBuffer, ctx.reportsDir);
}

async function saveSonarHtml(ctx: ArtifactExecutionContext): Promise<void> {
  const sonarHtml = generateSonarQubeHtmlReport(
    ctx.reportOpts.engineResults,
    ctx.client,
    ctx.project,
    ctx.reportOpts.locale,
    ctx.reportOpts.sonarqubeMetrics,
  );
  if (!sonarHtml) return;

  const htmlFilename = sonarqubeHtmlReportFilename(ctx.client, ctx.project);
  await saveReport(htmlFilename, sonarHtml, ctx.sonarReportsDir);
}

function buildEntryReportOptsForSplit(
  opts: ReportOpts,
  entryKey: string,
): ExecutiveReportOptions {
  const entryEcosystems = opts.ecosystems.filter(
    (e) => ecosystemEntryKey(e) === entryKey,
  );

  const filteredScanBefore: ScanResultJson = {
    ...opts.scanBefore,
    ecosystems: opts.scanBefore.ecosystems[entryKey] !== undefined
      ? { [entryKey]: opts.scanBefore.ecosystems[entryKey]! }
      : {},
  };

  const filteredScanAfter: ScanResultJson = {
    ...opts.scanAfter,
    ecosystems: opts.scanAfter.ecosystems[entryKey] !== undefined
      ? { [entryKey]: opts.scanAfter.ecosystems[entryKey]! }
      : {},
  };

  const filteredUpdates: Record<string, UpdateResultJson> = {};
  if (opts.updates[entryKey] !== undefined) {
    filteredUpdates[entryKey] = opts.updates[entryKey]!;
  }

  return {
    client: opts.client,
    project: opts.project,
    scanBefore: filteredScanBefore,
    scanAfter: filteredScanAfter,
    updates: filteredUpdates,
    ecosystems: entryEcosystems.length > 0 ? entryEcosystems : opts.ecosystems,
    locale: opts.locale,
    engineResults: opts.engineResults,
    advisorResults: opts.advisorResults,
    residualVerification: opts.residualVerification,
    sonarqubeMetrics: opts.sonarqubeMetrics,
  };
}
