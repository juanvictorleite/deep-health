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

export async function generateAndSaveReportArtifacts(
  input: ReportArtifactsInput,
): Promise<number> {
  const {
    runner,
    cwd,
    config,
    scanBefore,
    updates,
    engineResults,
    advisorResults,
    residualVerification,
  } = input;

  const client = input.client ?? config.project.client;
  const project = input.project ?? config.project.name;
  const outputsConfig = config.outputs;

  const formats = outputsConfig?.formats ?? [];
  const markdownEnabled = formats.includes('markdown');
  const docxEnabled = formats.includes('docx');

  if (!markdownEnabled && !docxEnabled) return 0;

  const reportsDir = resolveReportsDir(cwd, outputsConfig?.dir);
  const subFoldersEnabled = outputsConfig?.sub_folders ?? false;
  const sonarReportsDir = resolveEngineReportsDir(
    reportsDir,
    subFoldersEnabled ? 'sonarqube' : undefined,
  );

  const splitReportsEnabled = input.splitReports ?? outputsConfig?.split_reports ?? false;

  const sonarqubeMetrics: string[] = outputsConfig?.sonarqube_metrics ?? [...DEFAULT_SONAR_REPORT_METRICS];

  const reportOpts = {
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

  if (splitReportsEnabled && config.ecosystems.length > 0) {
    for (const ecoEntry of config.ecosystems) {
      const entryKey = ecosystemEntryKey(ecoEntry);

      if (markdownEnabled) {
        const entryReport = generateEntryReport(reportOpts, entryKey);
        const baseFilename = executiveReportFilename(client, project);
        const filename = splitReportFilename(baseFilename, entryKey);
        await saveReport(filename, entryReport, reportsDir);
      }

      if (docxEnabled) {
        const baseDocxFilename = executiveReportDocxFilename(client, project);
        const docxFilename = splitReportFilename(baseDocxFilename, entryKey);
        const entryOpts = buildEntryReportOptsForSplit(reportOpts, entryKey);
        const docxBuffer = await generateExecutiveReportDocx(entryOpts);
        await saveReport(docxFilename, docxBuffer, reportsDir);
      }
    }
  } else {
    if (markdownEnabled) {
      const execReport = generateExecutiveReport(reportOpts);
      const filename = executiveReportFilename(client, project);
      await saveReport(filename, execReport, reportsDir);
    }

    if (docxEnabled) {
      const docxBuffer = await generateExecutiveReportDocx(reportOpts);
      const docxFilename = executiveReportDocxFilename(client, project);
      await saveReport(docxFilename, docxBuffer, reportsDir);
    }
  }

  const sonarHtml = generateSonarQubeHtmlReport(engineResults, client, project, config.report_language, sonarqubeMetrics);
  if (sonarHtml) {
    const htmlFilename = sonarqubeHtmlReportFilename(client, project);
    await saveReport(htmlFilename, sonarHtml, sonarReportsDir);
  }

  return 0;
}

function buildEntryReportOptsForSplit(
  opts: {
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
  },
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
