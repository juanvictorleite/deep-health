import type { SupportedLocale } from '@core/types/locale';
import type { ScanResultJson } from '@core/types/scan';
import { CLI_NAME } from '@infra/brand';
import type { ExecLocale } from '@reporting/i18n/types';
import type { Locale } from '@reporting/i18n';
import { getLocale } from '@reporting/i18n';

import { render } from './renderer';
import type {
  SonarQubeConditionView,
  SonarQubeErrorViewModel,
  SonarQubeFileGroupView,
  SonarQubeSuccessViewModel,
} from './sonarqube-view-model';
import { buildSonarQubeViewModel } from './sonarqube-view-model';
import sonarqubeHtmlTemplate from './templates/sonarqube-report-html.hbs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function htmlLangCode(locale: SupportedLocale): string {
  return locale === 'pt-br' ? 'pt-BR' : 'en';
}

function qualityGateBadgeClass(status: string): string {
  if (status === 'OK') return 'qg-ok';
  if (status === 'ERROR') return 'qg-error';
  return 'qg-warn';
}

function qualityGateDisplayStatus(tr: ExecLocale, status: string | undefined): string | null {
  if (!status) return null;
  if (status === 'OK') return tr.sonarqube_report_qg_passed;
  if (status === 'ERROR') return tr.sonarqube_report_qg_failed;
  return status;
}

function projectReportConditions(conditions: SonarQubeConditionView[]): Omit<SonarQubeConditionView, 'status'>[] {
  return conditions.map((c) => ({
    statusIcon: c.statusIcon,
    isOk: c.isOk,
    metricKey: c.metricKey,
    comparator: c.comparator,
    errorThreshold: c.errorThreshold,
    actualValue: c.actualValue,
  }));
}

function projectReportIssueGroups(groups: SonarQubeFileGroupView[]): unknown[] | null {
  if (groups.length === 0) return null;
  return groups.map(({ file, issues }) => ({
    file,
    issues: issues.map((i) => ({
      severity: i.severity,
      severityClass: i.severityClass,
      rule: i.rule,
      line: i.line,
      message: i.message,
    })),
  }));
}

function buildReportCommonContext(
  client: string,
  project: string,
  resolvedLocale: SupportedLocale,
  loc: Locale,
): Record<string, unknown> {
  const tr = loc.exec;
  const now = new Date();
  return {
    project,
    client,
    periodLabel: `${loc.months[now.getMonth()]} ${now.getFullYear()}`,
    exportedAt: now.toISOString().replace('T', ' ').slice(0, 19),
    htmlLang: htmlLangCode(resolvedLocale),
    reportTitle: tr.sonarqube_report_title,
    footerText: tr.sonarqube_report_footer.replace('{{cliName}}', CLI_NAME),
    clientLabel: tr.label_client,
    exportedAtLabel: tr.sonarqube_report_generated,
    qualityGateLabel: tr.sonarqube_report_quality_gate,
    conditionsLabel: tr.sonarqube_report_conditions,
    metricsLabel: tr.sonarqube_report_metrics,
    issuesLabel: tr.sonarqube_report_issues,
    noIssuesLabel: tr.sonarqube_no_issues.replace(/_/g, ''),
    thMetric: tr.sonarqube_report_th_metric,
    thActual: tr.sonarqube_report_th_actual,
    thThreshold: tr.sonarqube_report_th_threshold,
    thComparator: tr.sonarqube_report_th_comparator,
    thValue: tr.sonarqube_report_th_value,
    thSeverity: tr.sonarqube_report_th_severity,
    thRule: tr.sonarqube_report_th_rule,
    thLine: tr.sonarqube_report_th_line,
    thMessage: tr.sonarqube_report_th_message,
  };
}

function buildErrorContext(vm: SonarQubeErrorViewModel, common: Record<string, unknown>): Record<string, unknown> {
  return {
    ...common,
    warning: vm.error ?? 'SonarQube scan failed',
    qualityGateStatus: null,
    hasConditions: false,
    conditions: [],
    metrics: null,
    noIssues: false,
    issuesByFile: null,
    issueCountSuffix: null,
  };
}

function buildSuccessContext(vm: SonarQubeSuccessViewModel, tr: ExecLocale, common: Record<string, unknown>): Record<string, unknown> {
  const qgStatus = vm.qualityGate?.status;
  const conditions = projectReportConditions(vm.qualityGate?.conditions ?? []);

  return {
    ...common,
    warning: null,
    qualityGateStatus: qualityGateDisplayStatus(tr, qgStatus),
    qualityGateBadgeClass: qgStatus ? qualityGateBadgeClass(qgStatus) : 'qg-warn',
    hasConditions: conditions.length > 0,
    conditions,
    metrics: vm.metrics,
    noIssues: vm.noIssues,
    issuesByFile: projectReportIssueGroups(vm.issueGroups),
    issueCountSuffix: vm.hasIssues ? tr.sonarqube_report_issues_found.replace('{{n}}', String(vm.totalIssues)) : null,
  };
}

function buildReportContext(
  vm: SonarQubeErrorViewModel | SonarQubeSuccessViewModel,
  tr: ExecLocale,
  common: Record<string, unknown>,
): Record<string, unknown> {
  return vm.state === 'error' ? buildErrorContext(vm, common) : buildSuccessContext(vm, tr, common);
}

// ─── HTML report generator ────────────────────────────────────────────────────

/**
 * Generate a standalone SonarQube HTML report.
 * Returns null when SonarQube results are absent, skipped, or engineResults is undefined.
 *
 * @param engineResults  Aggregated engine results from the orchestrator.
 * @param client         Client name (used in header and filename).
 * @param project        Project name (used in header and filename).
 * @param locale         Optional locale code. Defaults to 'en'.
 */
export function generateSonarQubeHtmlReport(
  engineResults: Record<string, ScanResultJson> | undefined,
  client: string,
  project: string,
  locale?: SupportedLocale,
  metricsFilter?: string[],
): string | null {
  const vm = buildSonarQubeViewModel({ engineResults, metricsFilter });
  if (vm.state === 'absent' || vm.state === 'skipped') return null;

  const resolvedLocale: SupportedLocale = locale ?? 'en';
  const loc = getLocale(resolvedLocale);
  const common = buildReportCommonContext(client, project, resolvedLocale, loc);

  return render(sonarqubeHtmlTemplate, buildReportContext(vm, loc.exec, common));
}

// ─── Filename ─────────────────────────────────────────────────────────────────

/**
 * Filename for the standalone SonarQube HTML report.
 * Follows the same convention as the executive report:
 *   "[Client Project] SonarQube Report - YYYY-MM - Month.html"
 */
export function sonarqubeHtmlReportFilename(client: string, project: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const loc = getLocale('en');
  return `[${client} ${project}] SonarQube Report - ${year}-${month} - ${loc.months[now.getMonth()]}.html`;
}
