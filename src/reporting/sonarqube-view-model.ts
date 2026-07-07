import type { ScanResultJson, SonarQubeIssue, SonarQubeQualityGateCondition } from '@core/types/scan';

// ── Normalized shapes shared by the three consumers ──────────────────────────

export interface SonarQubeConditionView {
  metricKey: string;
  status: string;
  statusIcon: string;
  isOk: boolean;
  comparator: string;
  errorThreshold: string;
  actualValue: string;
}

export interface SonarQubeIssueView {
  severity: string;
  severityClass: string;
  severityIcon: string;
  rule: string;
  line: string;
  message: string;
  type: string;
}

export interface SonarQubeFileGroupView {
  file: string;
  issues: SonarQubeIssueView[];
}

export interface SonarQubeMetricEntry {
  key: string;
  value: string;
}

export interface SonarQubeQualityGateView {
  status: string;
  passed: boolean | undefined;
  conditions: SonarQubeConditionView[];
  /** Untouched conditions array, for consumers (the export) that pass it through verbatim. */
  rawConditions: SonarQubeQualityGateCondition[];
}

export interface SonarQubeIssueWithFile extends SonarQubeIssue {
  file: string;
}

// ── ViewModel (discriminated by state) ────────────────────────────────────────

export interface SonarQubeAbsentViewModel {
  state: 'absent';
}

export interface SonarQubeSkippedViewModel {
  state: 'skipped';
}

export interface SonarQubeErrorViewModel {
  state: 'error';
  agent: string;
  rawStatus: string;
  error: string | null;
}

export interface SonarQubeSuccessViewModel {
  state: 'success';
  agent: string;
  rawStatus: string;
  error: string | null;
  qualityGate: SonarQubeQualityGateView | null;
  /** Metrics filtered by metricsFilter, raw metric keys (report/exec-section project their own key labels from this). */
  metrics: SonarQubeMetricEntry[] | null;
  /** Untouched metrics map, ignoring metricsFilter, for the export surface. */
  rawMetrics: Record<string, string> | null;
  issueGroups: SonarQubeFileGroupView[];
  totalIssues: number;
  hasIssues: boolean;
  noIssues: boolean;
  /** Untouched issues with a derived `file` field, for the export surface. */
  issuesWithFile: SonarQubeIssueWithFile[] | null;
}

export type SonarQubeViewModel =
  | SonarQubeAbsentViewModel
  | SonarQubeSkippedViewModel
  | SonarQubeErrorViewModel
  | SonarQubeSuccessViewModel;

export interface SonarQubeViewModelInput {
  engineResults: Record<string, ScanResultJson> | undefined;
  metricsFilter?: string[];
}

const ABSENT_VIEW_MODEL: SonarQubeAbsentViewModel = { state: 'absent' };
const SKIPPED_VIEW_MODEL: SonarQubeSkippedViewModel = { state: 'skipped' };

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractFile(component: string): string {
  const colon = component.indexOf(':');
  return colon >= 0 ? component.slice(colon + 1) : component;
}

function conditionStatusIcon(status: string): string {
  return status === 'OK' ? '✅' : status === 'ERROR' ? '❌' : '⚠️';
}

function severityClass(severity: string): string {
  switch (severity.toUpperCase()) {
    case 'BLOCKER':
    case 'CRITICAL': return 'critical';
    case 'MAJOR': return 'major';
    case 'MINOR': return 'minor';
    case 'INFO': return 'info';
    default: return 'unknown';
  }
}

function severityIcon(severity: string): string {
  switch (severity.toUpperCase()) {
    case 'BLOCKER':
    case 'CRITICAL': return '🔴';
    case 'MAJOR': return '🟠';
    case 'MINOR': return '🟡';
    case 'INFO': return '🔵';
    default: return '⚪';
  }
}

function buildConditions(rawConditions: SonarQubeQualityGateCondition[] | undefined): SonarQubeConditionView[] {
  return (rawConditions ?? []).map((c) => ({
    metricKey: c.metricKey,
    status: c.status,
    statusIcon: conditionStatusIcon(c.status),
    isOk: c.status === 'OK',
    comparator: c.comparator,
    errorThreshold: c.errorThreshold ?? '—',
    actualValue: c.actualValue ?? '—',
  }));
}

function buildMetrics(rawMetrics: Record<string, string> | undefined, metricsFilter: string[] | undefined): SonarQubeMetricEntry[] | null {
  if (!rawMetrics) return null;
  return Object.entries(rawMetrics)
    .filter(([key]) => metricsFilter === undefined || metricsFilter.includes(key))
    .map(([key, value]) => ({ key, value }));
}

function buildIssueGroups(rawIssues: SonarQubeIssue[] | undefined): SonarQubeFileGroupView[] {
  const fileMap = new Map<string, SonarQubeIssueView[]>();
  for (const issue of rawIssues ?? []) {
    const file = extractFile(issue.component);
    const entry: SonarQubeIssueView = {
      severity: issue.severity,
      severityClass: severityClass(issue.severity),
      severityIcon: severityIcon(issue.severity),
      rule: issue.rule,
      line: issue.line !== undefined ? String(issue.line) : '—',
      message: issue.message,
      type: issue.type,
    };
    const group = fileMap.get(file) ?? [];
    group.push(entry);
    fileMap.set(file, group);
  }
  return [...fileMap.entries()].map(([file, issues]) => ({ file, issues }));
}

function buildIssuesWithFile(rawIssues: SonarQubeIssue[] | undefined): SonarQubeIssueWithFile[] | null {
  if (!rawIssues) return null;
  return rawIssues.map((issue) => ({ ...issue, file: extractFile(issue.component) }));
}

function buildQualityGate(meta: ScanResultJson['metadata']): SonarQubeQualityGateView | null {
  const status = meta?.qualityGateStatus;
  if (!status) return null;
  return {
    status,
    passed: meta?.qualityGatePassed,
    conditions: buildConditions(meta?.qualityGateConditions),
    rawConditions: meta?.qualityGateConditions ?? [],
  };
}

function buildErrorViewModel(result: ScanResultJson): SonarQubeErrorViewModel {
  return {
    state: 'error',
    agent: result.agent,
    rawStatus: result.status,
    error: result.error,
  };
}

function buildSuccessViewModel(result: ScanResultJson, metricsFilter: string[] | undefined): SonarQubeSuccessViewModel {
  const meta = result.metadata;
  const rawIssues = meta?.issues;
  const totalIssues = rawIssues?.length ?? 0;

  return {
    state: 'success',
    agent: result.agent,
    rawStatus: result.status,
    error: result.error,
    qualityGate: buildQualityGate(meta),
    metrics: buildMetrics(meta?.metrics, metricsFilter),
    rawMetrics: meta?.metrics ? { ...meta.metrics } : null,
    issueGroups: buildIssueGroups(rawIssues),
    totalIssues,
    hasIssues: totalIssues > 0,
    noIssues: rawIssues !== undefined && totalIssues === 0,
    issuesWithFile: buildIssuesWithFile(rawIssues),
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Normalize a SonarQube engine result once: quality gate status + conditions,
 * metric set, issue groupings and skip/error states. Pure — no I/O, no template
 * strings. `generateSonarQubeHtmlReport`, `buildSonarQubeExecSection` and
 * `buildSonarQubeExport` each project a thin, surface-specific view from this.
 */
export function buildSonarQubeViewModel(input: SonarQubeViewModelInput): SonarQubeViewModel {
  const { engineResults, metricsFilter } = input;
  const result = engineResults?.['sonarqube'];
  if (!result) return ABSENT_VIEW_MODEL;
  if (result.status === 'skipped') return SKIPPED_VIEW_MODEL;
  if (result.status === 'error') return buildErrorViewModel(result);
  return buildSuccessViewModel(result, metricsFilter);
}
