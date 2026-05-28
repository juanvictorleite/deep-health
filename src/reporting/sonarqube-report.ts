import { CLI_NAME } from '@infra/brand';
import type { ScanResultJson } from '@core/types/scan';
import type { SupportedLocale } from '@core/types/locale';
import { getLocale } from '@reporting/i18n';
import { render } from './renderer';
import sonarqubeHtmlTemplate from './templates/sonarqube-report-html.hbs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function htmlLangCode(locale: SupportedLocale): string {
  return locale === 'pt-br' ? 'pt-BR' : 'en';
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

function conditionStatusIcon(status: string): string {
  return status === 'OK' ? '✅' : status === 'ERROR' ? '❌' : '⚠️';
}

function qualityGateBadgeClass(status: string): string {
  if (status === 'OK') return 'qg-ok';
  if (status === 'ERROR') return 'qg-error';
  return 'qg-warn';
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
  if (!engineResults) return null;

  const sonarResult = engineResults['sonarqube'];
  if (!sonarResult) return null;
  if (sonarResult.status === 'skipped') return null;

  const resolvedLocale: SupportedLocale = locale ?? 'en';
  const loc = getLocale(resolvedLocale);
  const tr = loc.exec;

  const now = new Date();
  const localeMonthName = loc.months[now.getMonth()];
  const periodLabel = `${localeMonthName} ${now.getFullYear()}`;
  const exportedAt = now.toISOString().replace('T', ' ').slice(0, 19);

  const htmlLang = htmlLangCode(resolvedLocale);
  const reportTitle = tr.sonarqube_report_title;
  const footerText = tr.sonarqube_report_footer.replace('{{cliName}}', CLI_NAME);

  // ── Error case ──────────────────────────────────────────────────────────────
  if (sonarResult.status === 'error') {
    const warning = sonarResult.error ?? 'SonarQube scan failed';
    return render(sonarqubeHtmlTemplate, {
      project,
      client,
      periodLabel,
      exportedAt,
      htmlLang,
      reportTitle,
      footerText,
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
      warning,
      qualityGateStatus: null,
      hasConditions: false,
      conditions: [],
      metrics: null,
      noIssues: false,
      issuesByFile: null,
      issueCountSuffix: null,
    });
  }

  // ── Success case ────────────────────────────────────────────────────────────
  const meta = sonarResult.metadata;

  // Quality gate
  const rawQgStatus = meta?.qualityGateStatus;
  const rawQgPassed = meta?.qualityGatePassed;
  const qgDisplayStatus = rawQgStatus
    ? (rawQgStatus === 'OK' ? tr.sonarqube_report_qg_passed : rawQgStatus === 'ERROR' ? tr.sonarqube_report_qg_failed : rawQgStatus)
    : null;
  const qgBadgeClass = rawQgStatus ? qualityGateBadgeClass(rawQgStatus) : 'qg-warn';

  // Conditions
  const rawConditions = meta?.qualityGateConditions;
  const conditions = (rawConditions ?? []).map((c) => ({
    statusIcon: conditionStatusIcon(c.status),
    isOk: c.status === 'OK',
    metricKey: c.metricKey,
    comparator: c.comparator,
    errorThreshold: c.errorThreshold ?? '—',
    actualValue: c.actualValue ?? '—',
  }));

  // Metrics
  const rawMetrics = meta?.metrics;
  const metrics = rawMetrics
    ? Object.entries(rawMetrics)
        .filter(([key]) => metricsFilter === undefined || metricsFilter.includes(key))
        .map(([key, value]) => ({ key, value }))
    : null;

  // Issues grouped by file
  const rawIssues = meta?.issues;

  const fileMap = new Map<string, Array<{ severity: string; severityClass: string; rule: string; line: string; message: string }>>();
  for (const issue of rawIssues ?? []) {
    const colon = issue.component.indexOf(':');
    const file = colon >= 0 ? issue.component.slice(colon + 1) : issue.component;
    const entry = {
      severity: issue.severity,
      severityClass: severityClass(issue.severity),
      rule: issue.rule,
      line: issue.line !== undefined ? String(issue.line) : '—',
      message: issue.message,
    };
    const arr = fileMap.get(file) ?? [];
    arr.push(entry);
    fileMap.set(file, arr);
  }

  const issuesByFile = fileMap.size > 0
    ? [...fileMap.entries()].map(([file, issues]) => ({ file, issues }))
    : null;

  const totalIssues = rawIssues?.length ?? 0;
  const noIssues = rawIssues !== undefined && totalIssues === 0;

  return render(sonarqubeHtmlTemplate, {
    project,
    client,
    periodLabel,
    exportedAt,
    htmlLang,
    reportTitle,
    footerText,
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
    warning: null,
    qualityGateStatus: qgDisplayStatus,
    qualityGateBadgeClass: qgBadgeClass,
    hasConditions: conditions.length > 0,
    conditions,
    metrics,
    noIssues,
    issuesByFile,
    issueCountSuffix: totalIssues > 0 ? tr.sonarqube_report_issues_found.replace('{{n}}', String(totalIssues)) : null,
    // suppress unused warning via assignment
    _qualityGatePassed: rawQgPassed,
  });
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
