import { resolve } from "node:path";

import { __ } from "@core/i18n";
import type { ScanResultJson } from "@core/types/scan";
import { DEFAULT_REPORTS_SUBDIR } from "@infra/brand";
import { LocalStorageProvider } from "@infra/storage/local";
import {
  buildSonarQubeExport,
  sonarQubeExportFilename,
} from "@reporting/sonarqube-export";

export interface SaveReportOutcome {
  localUrl: string;
}

export async function saveReport(
  filename: string,
  content: string | Buffer,
  reportsDir: string,
): Promise<SaveReportOutcome> {
  const provider = new LocalStorageProvider(reportsDir);
  try {
    const result = await provider.upload(filename, content);
    process.stdout.write(
      __('Report saved [{{provider}}]: {{url}}\n', { provider: result.provider, url: result.url }),
    );
    return { localUrl: result.url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(__('Failed to save report locally: {{msg}}', { msg }), { cause: err });
  }
}

export async function saveSonarQubeExport(
  engineResults: Record<string, ScanResultJson>,
  projectName: string,
  date: string,
  reportsDir: string,
): Promise<void> {
  const sonarExport = buildSonarQubeExport(engineResults);
  if (!sonarExport) return;

  const exportFilename = sonarQubeExportFilename(projectName, date);
  try {
    await saveReport(
      exportFilename,
      JSON.stringify(sonarExport, null, 2),
      reportsDir,
    );
  } catch (err) {
    process.stderr.write(
      __('SonarQube export save failed: {{error}}\n', { error: err instanceof Error ? err.message : String(err) }),
    );
  }
}

export function resolveReportsDir(
  cwd: string,
  configReportsDir: string | undefined,
): string {
  return resolve(cwd, configReportsDir ?? DEFAULT_REPORTS_SUBDIR);
}

export function resolveEngineReportsDir(
  reportsDir: string,
  subFolder: string | undefined,
): string {
  if (!subFolder) return reportsDir;
  return resolve(reportsDir, subFolder);
}
