import { saveReport, resolveReportsDir, resolveEngineReportsDir } from '@app/report-saver';
import type { CommandRunner } from '@core/types/common';
import type { ProjectConfig, EcosystemConfig } from '@core/types/config';
import { ecosystemEntryKey, DEFAULT_SONAR_REPORT_METRICS } from '@core/types/config';
import type { SupportedLocale } from '@core/types/locale';
import type { AdvisorResult, ResidualVerification, ExecutiveReportOptions } from '@core/types/report';
import type { ScanResultJson } from '@core/types/scan';
import type { UpdateResultJson } from '@core/types/update';
import { CLI_NAME } from '@infra/brand';
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
  /** Override the client name from config (e.g. --client CLI flag). */
  client?: string;
  /** Override the project name from config (e.g. --project CLI flag). */
  project?: string;
  scanBefore: ScanResultJson;
  updates: Record<string, UpdateResultJson>;
  engineResults?: Record<string, ScanResultJson>;
  advisorResults?: Record<string, AdvisorResult[]>;
  residualVerification?: ResidualVerification;
  /**
   * When true, generates one report per ecosystem entry.
   * Overrides config.outputs.split_reports when provided.
   * Defaults to config.outputs.split_reports ?? false.
   */
  splitReports?: boolean;
}

/**
 * Generate and save the post-pipeline report artefacts:
 *   1. Executive report (Markdown) — saved when outputs.formats includes 'markdown'
 *   2. SonarQube HTML report — saved alongside the executive report when sonar data is present
 *
 * Returns 0 on success. Returns 1 when a required cloud upload fails.
 * Never saves the audit trail — that remains the caller's responsibility.
 */
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

  // CLI flag (input.splitReports) takes precedence over config value
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
    // Split mode: one report per ecosystem entry
    for (const ecoEntry of config.ecosystems) {
      const entryKey = ecosystemEntryKey(ecoEntry);

      if (markdownEnabled) {
        const entryReport = generateEntryReport(reportOpts, entryKey);
        const baseFilename = executiveReportFilename(client, project);
        const filename = splitReportFilename(baseFilename, entryKey);
        const outcome = await saveReport(filename, entryReport, reportsDir, config.cloud_storage, cwd);
        if (outcome.cloudError && config.cloud_storage?.require_upload) {
          process.stderr.write(
            `[${CLI_NAME}] Cloud upload required but failed: ${outcome.cloudError}\n`,
          );
          return 1;
        }
      }

      if (docxEnabled) {
        const baseDocxFilename = executiveReportDocxFilename(client, project);
        const docxFilename = splitReportFilename(baseDocxFilename, entryKey);
        // Build entry-scoped opts for DOCX generation
        const entryOpts = buildEntryReportOptsForSplit(reportOpts, entryKey);
        const docxBuffer = await generateExecutiveReportDocx(entryOpts);
        const docxOutcome = await saveReport(docxFilename, docxBuffer, reportsDir, config.cloud_storage, cwd);
        if (docxOutcome.cloudError && config.cloud_storage?.require_upload) {
          process.stderr.write(
            `[${CLI_NAME}] Cloud upload required but failed (DOCX): ${docxOutcome.cloudError}\n`,
          );
          return 1;
        }
      }
    }
  } else {
    // Consolidated mode (default)
    if (markdownEnabled) {
      const execReport = generateExecutiveReport(reportOpts);
      const filename = executiveReportFilename(client, project);
      const outcome = await saveReport(filename, execReport, reportsDir, config.cloud_storage, cwd);
      if (outcome.cloudError && config.cloud_storage?.require_upload) {
        process.stderr.write(
          `[${CLI_NAME}] Cloud upload required but failed: ${outcome.cloudError}\n`,
        );
        return 1;
      }
    }

    if (docxEnabled) {
      const docxBuffer = await generateExecutiveReportDocx(reportOpts);
      const docxFilename = executiveReportDocxFilename(client, project);
      const docxOutcome = await saveReport(docxFilename, docxBuffer, reportsDir, config.cloud_storage, cwd);
      if (docxOutcome.cloudError && config.cloud_storage?.require_upload) {
        process.stderr.write(
          `[${CLI_NAME}] Cloud upload required but failed (DOCX): ${docxOutcome.cloudError}\n`,
        );
        return 1;
      }
    }
  }

  // Standalone SonarQube HTML artifact — only when at least one format is enabled
  const sonarHtml = generateSonarQubeHtmlReport(engineResults, client, project, config.report_language, sonarqubeMetrics);
  if (sonarHtml) {
    const htmlFilename = sonarqubeHtmlReportFilename(client, project);
    const sonarOutcome = await saveReport(
      htmlFilename,
      sonarHtml,
      sonarReportsDir,
      config.cloud_storage,
      cwd,
    );
    if (sonarOutcome.cloudError && config.cloud_storage?.require_upload) {
      process.stderr.write(
        `[${CLI_NAME}] Cloud upload required but failed (SonarQube HTML): ${sonarOutcome.cloudError}\n`,
      );
      return 1;
    }
  }

  return 0;
}

/**
 * Build entry-scoped ExecutiveReportOptions for split DOCX generation.
 * Filters scanBefore/scanAfter/updates to only the given entryKey and
 * narrows ecosystems to the single entry.
 */
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
