// Re-exported from the neutral types layer so reporting/i18n internals stay self-consistent.
export type { SupportedLocale } from '@core/types/locale';

export interface ExecLocale {
  report_title: string;
  label_client: string;
  label_project: string;
  label_period: string;
  section_task: string;
  task_title: string;
  task_description: string;
  section_resolution: string;
  no_vulns: string;
  found_and_fixed: string;
  pending_intro: string;
  table_fixed_header: string;
  table_pending_header: string;
  section_evidence_before: string;
  /** Generic scan summary: total vulns + per-ecosystem labels */
  scan_summary(total: number, ecoLabels: string): string;
  section_evidence_after: string;
  /** Generic evidence section title per ecosystem. Ex: "PHP/Composer (composer.lock) — post-fix scan summary:" */
  ecosystem_evidence_title(ecoLabel: string): string;
  table_after_header: string;
  /** Generic post-fix summary: remaining vulns + per-ecosystem labels */
  scan_after_summary_generic(total: number, ecoLabels: string): string;
  tests_verified_intro: string;
  /** Generic validation verified message for any ecosystem */
  validation_verified(validationLabel: string, detail: string): string;
  section_summary: string;
  all_fixed: string;
  pending_needs_action_intro: string;
  pending_manual: string;
  fixed_version(version: string): string;
  /** SonarQube executive section */
  sonarqube_title: string;
  sonarqube_quality_gate(status: string): string;
  sonarqube_conditions: string;
  sonarqube_metrics: string;
  sonarqube_issues_by_file: string;
  sonarqube_no_issues: string;
  sonarqube_issue_count(n: number): string;
  sonarqube_skipped: string;
  sonarqube_warning(message: string): string;
  /** Optional map of known SonarQube metric keys to human-readable labels */
  sonarqube_metric_labels?: Record<string, string>;
  /** Advisor section */
  advisors_title: string;
  advisor_header(name: string): string;
  advisor_skipped: string;
  advisor_clean: string;
  advisor_findings: string;
  advisor_error: string;
  advisor_output(output: string): string;
  advisor_findings_label: string;
  advisor_no_findings: string;
  /** Advisor overview table column headers */
  advisor_col_ecosystem: string;
  advisor_col_advisor: string;
  advisor_col_status: string;
  advisor_col_findings: string;
  /** Branch/engine metadata labels */
  label_branch: string;
  label_scanners: string;
  /** DOCX table column headers */
  col_ecosystem: string;
  col_ghsa: string;
  col_cvss: string;
  col_package: string;
  col_old_version: string;
  col_safe_version: string;
  col_risk: string;
  col_current_version: string;
  col_reason: string;
  col_affected_versions: string;
  col_status_after: string;
  /** Blocked vulnerabilities section */
  blocked_intro: string;
  table_blocked_header: string;
  col_block_reason: string;
  col_blocked_by: string;
  /** Status label for a blocked vuln in the evidence section */
  blocked_status(blockedBy: string): string;
  /** SonarQube HTML report labels (used in Slice 2) */
  sonarqube_report_title: string;
  sonarqube_report_generated: string;
  sonarqube_report_th_metric: string;
  sonarqube_report_th_actual: string;
  sonarqube_report_th_threshold: string;
  sonarqube_report_th_comparator: string;
  sonarqube_report_th_value: string;
  sonarqube_report_th_severity: string;
  sonarqube_report_th_rule: string;
  sonarqube_report_th_line: string;
  sonarqube_report_th_message: string;
  sonarqube_report_qg_passed: string;
  sonarqube_report_qg_failed: string;
  sonarqube_report_issues_found: string;
  sonarqube_report_footer: string;
  sonarqube_report_quality_gate: string;
  sonarqube_report_conditions: string;
  sonarqube_report_metrics: string;
  sonarqube_report_issues: string;
}

export interface ReasonLocale {
  no_safe_version: string;
  major_bump(targetVersion: string): string;
  major_bump_generic: string;
  protected_constraint(constraint: string): string;
}

export interface StatusLocale {
  no_fix: string;
  needs_auth: string;
  pending: string;
}

export interface Locale {
  months: readonly string[];
  pkg_count(vulnCount: number, pkgCount: number, ecosystem: string, names?: string): string;
  exec: ExecLocale;
  reason: ReasonLocale;
  status: StatusLocale;
}
