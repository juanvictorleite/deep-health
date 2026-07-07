import type { ScanResultJson } from '@core/types/scan';
import type { SonarQubeQualityGateCondition, SonarQubeIssue } from '@core/types/scan';

import type { SonarQubeQualityGateView } from './sonarqube-view-model';
import { buildSonarQubeViewModel } from './sonarqube-view-model';

// ─── Export types ──────────────────────────────────────────────────────────────

export type SonarQubeQualityGateConditionExport = SonarQubeQualityGateCondition;

export type SonarQubeIssueExport = SonarQubeIssue & {
  /** Relative file path extracted from component string */
  file: string;
};

export interface SonarQubeMetricsExport {
  bugs?: string;
  vulnerabilities?: string;
  code_smells?: string;
  coverage?: string;
  duplicated_lines_density?: string;
  security_hotspots?: string;
  [key: string]: string | undefined;
}

/**
 * Detailed SonarQube export payload.
 * Written as a standalone JSON artifact when SonarQube ran successfully.
 */
export interface SonarQubeDetailedExport {
  $schema: 'sonarqube-export/v1';
  exportedAt: string;
  /** The SonarQube agent that produced this result */
  agent: string;
  /** Overall scan status: 'success' | 'error' | 'skipped' */
  status: string;
  qualityGate: {
    status: string;
    passed: boolean;
    conditions: SonarQubeQualityGateConditionExport[];
  } | null;
  metrics: SonarQubeMetricsExport | null;
  issues: SonarQubeIssueExport[] | null;
  error: string | null;
}

// ─── Builder ───────────────────────────────────────────────────────────────────

function projectExportQualityGate(qualityGate: SonarQubeQualityGateView | null): SonarQubeDetailedExport['qualityGate'] {
  if (!qualityGate) return null;
  return {
    status: qualityGate.status,
    passed: qualityGate.passed ?? qualityGate.status === 'OK',
    conditions: qualityGate.rawConditions,
  };
}

/**
 * Build a detailed SonarQube export from the raw engine result.
 *
 * Returns null if:
 * - The engine result is undefined (SonarQube not configured / not in engineResults)
 * - Status is 'skipped'
 *
 * For status='error', returns an export with only the error field populated.
 */
export function buildSonarQubeExport(
  engineResults: Record<string, ScanResultJson> | undefined,
): SonarQubeDetailedExport | null {
  const vm = buildSonarQubeViewModel({ engineResults });
  if (vm.state === 'absent' || vm.state === 'skipped') return null;

  const exportedAt = new Date().toISOString();

  if (vm.state === 'error') {
    return {
      $schema: 'sonarqube-export/v1',
      exportedAt,
      agent: vm.agent,
      status: 'error',
      qualityGate: null,
      metrics: null,
      issues: null,
      error: vm.error ?? 'unknown error',
    };
  }

  return {
    $schema: 'sonarqube-export/v1',
    exportedAt,
    agent: vm.agent,
    status: vm.rawStatus,
    qualityGate: projectExportQualityGate(vm.qualityGate),
    metrics: vm.rawMetrics,
    issues: vm.issuesWithFile,
    error: vm.error,
  };
}

/**
 * Determine the filename for the SonarQube export JSON.
 * Naming mirrors the project/date artifact convention.
 */
export function sonarQubeExportFilename(projectName: string, date: string): string {
  return `sonarqube-export-${projectName.toLowerCase().replace(/\s+/g, '-')}-${date}.json`;
}
