import type { ScanResultJson } from '@core/types/scan';

import type { ExecLocale } from './i18n/types';
import type {
  SonarQubeConditionView,
  SonarQubeFileGroupView,
  SonarQubeMetricEntry,
  SonarQubeSuccessViewModel,
} from './sonarqube-view-model';
import { buildSonarQubeViewModel } from './sonarqube-view-model';

// ── SonarQube executive section builder ──────────────────────────────────────

interface SonarQubeConditionEntry {
  metricKey: string;
  status: string;
  statusIcon: string;
  comparator: string;
  errorThreshold: string;
  actualValue: string;
}

interface SonarQubeIssueEntry {
  severity: string;
  severityIcon: string;
  rule: string;
  line: string;
  message: string;
  type: string;
}

interface SonarQubeFileGroup {
  file: string;
  issues: SonarQubeIssueEntry[];
}

export interface SonarQubeExecSectionData {
  present: boolean;
  skipped: boolean;
  warning: string | null;
  qualityGate: string | null;
  hasConditions: boolean;
  conditions: SonarQubeConditionEntry[];
  conditionsLabel: string;
  metrics: { key: string; value: string }[] | null;
  hasIssues: boolean;
  noIssues: boolean;
  issueCountLabel: string;
  issuesByFile: SonarQubeFileGroup[];
  issuesByFileLabel: string;
}

function execQualityGateLabel(locale: ExecLocale, status: string): string {
  const statusText = status === 'OK' ? '✅ OK' : status === 'ERROR' ? '❌ ERROR' : status;
  return locale.sonarqube_quality_gate(statusText);
}

function projectExecConditions(conditions: SonarQubeConditionView[]): SonarQubeConditionEntry[] {
  return conditions.map((c) => ({
    metricKey: c.metricKey,
    status: c.status,
    statusIcon: c.statusIcon,
    comparator: c.comparator,
    errorThreshold: c.errorThreshold,
    actualValue: c.actualValue,
  }));
}

function projectExecMetrics(metrics: SonarQubeMetricEntry[] | null, locale: ExecLocale): { key: string; value: string }[] | null {
  if (!metrics) return null;
  const metricLabels = locale.sonarqube_metric_labels ?? {};
  return metrics.map(({ key, value }) => ({ key: metricLabels[key] ?? key, value }));
}

function projectExecIssueGroups(groups: SonarQubeFileGroupView[]): SonarQubeFileGroup[] {
  return groups.map(({ file, issues }) => ({
    file,
    issues: issues.map((i) => ({
      severity: i.severity,
      severityIcon: i.severityIcon,
      rule: i.rule,
      line: i.line,
      message: i.message,
      type: i.type,
    })),
  }));
}

function buildSuccessSection(vm: SonarQubeSuccessViewModel, locale: ExecLocale, empty: SonarQubeExecSectionData): SonarQubeExecSectionData {
  const qualityGateLabel = vm.qualityGate ? execQualityGateLabel(locale, vm.qualityGate.status) : null;
  const conditions = projectExecConditions(vm.qualityGate?.conditions ?? []);

  return {
    present: true,
    skipped: false,
    warning: null,
    qualityGate: qualityGateLabel,
    hasConditions: conditions.length > 0,
    conditions,
    conditionsLabel: empty.conditionsLabel,
    metrics: projectExecMetrics(vm.metrics, locale),
    hasIssues: vm.hasIssues,
    noIssues: vm.noIssues,
    issueCountLabel: vm.hasIssues ? locale.sonarqube_issue_count(vm.totalIssues) : '',
    issuesByFile: projectExecIssueGroups(vm.issueGroups),
    issuesByFileLabel: empty.issuesByFileLabel,
  };
}

export function buildSonarQubeExecSection(
  engineResults: Record<string, ScanResultJson> | undefined,
  locale: ExecLocale,
  metricsFilter?: string[],
): SonarQubeExecSectionData {
  const empty: SonarQubeExecSectionData = {
    present: false, skipped: false, warning: null, qualityGate: null,
    hasConditions: false, conditions: [], conditionsLabel: locale.sonarqube_conditions,
    metrics: null, hasIssues: false, noIssues: false,
    issueCountLabel: '', issuesByFile: [], issuesByFileLabel: locale.sonarqube_issues_by_file,
  };

  const vm = buildSonarQubeViewModel({ engineResults, metricsFilter });

  if (vm.state === 'absent') return empty;
  if (vm.state === 'skipped') return { ...empty, present: true, skipped: true };
  if (vm.state === 'error') return { ...empty, present: true, warning: locale.sonarqube_warning(vm.error ?? 'scan error') };

  return buildSuccessSection(vm, locale, empty);
}
