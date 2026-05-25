import { __ } from '@core/i18n';
import type { Locale } from './types';

export function buildLocale(): Locale {
  return {
    months: [
      __('January'),
      __('February'),
      __('March'),
      __('April'),
      __('May'),
      __('June'),
      __('July'),
      __('August'),
      __('September'),
      __('October'),
      __('November'),
      __('December'),
    ],

    pkg_count(vulnCount, pkgCount, ecosystem, names) {
      const tmpl =
        pkgCount === 1
          ? __('{{vulnCount}} in {{ecosystem}} ({{pkgCount}} package{{namesSuffix}})')
          : __('{{vulnCount}} in {{ecosystem}} ({{pkgCount}} packages)');
      return tmpl
        .replace(/\{\{vulnCount\}\}/g, String(vulnCount))
        .replace(/\{\{pkgCount\}\}/g, String(pkgCount))
        .replace(/\{\{ecosystem\}\}/g, ecosystem)
        .replace(/\{\{namesSuffix\}\}/g, names ? `: ${names}` : '');
    },

    reason: {
      no_safe_version: __('No upstream fix available'),
      major_bump: (version) =>
        __('Requires major version {{version}} — breaking change; authorization required', { version }),
      major_bump_generic: __('Requires major version bump — breaking change; authorization required'),
      protected_constraint: (constraint) =>
        __('Blocked by constraint {{constraint}}', { constraint }),
    },

    status: {
      no_fix: __('pending (no fix available)'),
      needs_auth: __('pending (authorization required)'),
      pending: __('pending'),
    },

    exec: {
      report_title: __('Security Report'),
      label_client: __('Client'),
      label_project: __('Project'),
      label_period: __('Period'),
      section_task: __('Task'),
      task_title: __('Security Maintenance — Monthly Routine'),
      task_description: __(
        'Monthly scan of installed dependencies to identify packages with known vulnerabilities and apply available fixes.',
      ),
      section_resolution: __('Resolution'),
      no_vulns: __(
        'No vulnerabilities were identified in the project dependencies. The project is up to date and secure.',
      ),
      found_and_fixed: __('After running the scan, the following issues were found and fixed:'),
      pending_intro: __(
        'The following vulnerabilities could not be fixed automatically and remain pending:',
      ),
      table_fixed_header: __(
        '| Type | CVE/GHSA | CVSS | Package | Old Version | Fixed Version | Risk |\n|------|----------|------|---------|-------------|---------------|------|',
      ),
      table_pending_header: __(
        '| Type | CVE/GHSA | CVSS | Package | Current Version | Reason |\n|------|----------|------|---------|-----------------|--------|',
      ),
      section_evidence_before: __('Evidence — Before'),
      table_before_header: __(
        '| Type | CVE/GHSA | CVSS | Package | Version | Risk |\n|------|----------|------|---------|---------|------|',
      ),
      scan_summary: (total, ecoLabels) =>
        __('Initial scan (before fixes): **{{total}} vulnerabilities** — {{ecoLabels}}', {
          total,
          ecoLabels,
        }),
      section_evidence_after: __('Evidence — After'),
      ecosystem_evidence_title: (ecoLabel) =>
        __('{{ecoLabel}} — post-fix scan summary:', { ecoLabel }),
      table_after_header: __(
        '| Type | CVE/GHSA | CVSS | Package | Status after fixes | Risk |\n|------|----------|------|---------|-------------------|------|',
      ),
      scan_after_summary_generic: (total, ecoLabels) =>
        __('Post-fix scan: **{{total}} vulnerabilities remaining** — {{ecoLabels}}', {
          total,
          ecoLabels,
        }),
      tests_verified_intro: __('Test suite verification after applying fixes:'),
      validation_verified: (validationLabel, detail) =>
        __('{{validationLabel}} verified successfully: {{detail}}', { validationLabel, detail }),
      section_summary: __('Summary'),
      all_fixed: __(
        'All identified vulnerabilities have been fixed. The project is up to date and secure regarding its dependencies.',
      ),
      pending_needs_action_intro: __(
        'All vulnerabilities that could be fixed without breaking changes have been applied. The items listed below require evaluation or major version authorization:',
      ),
      pending_manual: __(
        'Identified vulnerabilities require manual action — no automatic fixes were applied.',
      ),
      fixed_version: (version) => __('fixed ({{version}})', { version }),
      sonarqube_title: __('Code Quality Analysis — SonarQube'),
      sonarqube_quality_gate: (status) => __('**Quality Gate:** {{status}}', { status }),
      sonarqube_conditions: __('**Quality Gate Conditions:**'),
      sonarqube_metrics: __('**Metrics:**'),
      sonarqube_issues_by_file: __('**Issues by file:**'),
      sonarqube_no_issues: __('_No issues found._'),
      sonarqube_issue_count: (n) => __('{{n}} issue(s) found', { n }),
      sonarqube_skipped: __('_SonarQube: analysis not executed or disabled in this cycle._'),
      sonarqube_warning: (message) =>
        __('_SonarQube: analysis warning — {{message}}_', { message }),
      sonarqube_metric_labels: {
        alert_status: __('Quality Gate Status'),
        bugs: __('Bugs'),
        code_smells: __('Code Smells'),
        coverage: __('Coverage'),
        duplicated_lines_density: __('Duplicated Lines (%)'),
        ncloc: __('Lines of Code'),
        reliability_rating: __('Reliability Rating'),
        security_rating: __('Security Rating'),
        sqale_index: __('Technical Debt'),
        sqale_rating: __('Maintainability Rating'),
        vulnerabilities: __('Vulnerabilities'),
      },
      advisors_title: __('Advisor Analysis'),
      advisor_header: (name) => __('### {{name}}', { name }),
      advisor_skipped: __('— skipped'),
      advisor_clean: __('✅ clean'),
      advisor_findings: __('⚠️ findings'),
      advisor_error: __('❌ error'),
      advisor_output: (output) => __('```\n{{output}}\n```', { output }),
      advisor_findings_label: __('**Findings:**'),
      advisor_no_findings: __('_No issues found._'),
      advisor_col_ecosystem: __('Ecosystem'),
      advisor_col_advisor: __('Advisor'),
      advisor_col_status: __('Status'),
      advisor_col_findings: __('Findings'),
      label_branch: __('Branch'),
      label_scanners: __('Scanners'),
      col_ecosystem: __('Type'),
      col_ghsa: __('CVE/GHSA'),
      col_cvss: __('CVSS'),
      col_package: __('Package'),
      col_old_version: __('Old Version'),
      col_safe_version: __('Fixed Version'),
      col_risk: __('Risk'),
      col_current_version: __('Current Version'),
      col_reason: __('Reason'),
      col_affected_versions: __('Version'),
      col_status_after: __('Status after fixes'),
      sonarqube_report_title: __('SonarQube Report'),
      sonarqube_report_generated: __('Generated'),
      sonarqube_report_th_metric: __('Metric'),
      sonarqube_report_th_actual: __('Actual'),
      sonarqube_report_th_threshold: __('Threshold'),
      sonarqube_report_th_comparator: __('Comparator'),
      sonarqube_report_th_value: __('Value'),
      sonarqube_report_th_severity: __('Severity'),
      sonarqube_report_th_rule: __('Rule'),
      sonarqube_report_th_line: __('Line'),
      sonarqube_report_th_message: __('Message'),
      sonarqube_report_qg_passed: __('PASSED'),
      sonarqube_report_qg_failed: __('FAILED'),
      sonarqube_report_issues_found: __('{{n}} found'),
      sonarqube_report_footer: __('Generated by {{cliName}}'),
      sonarqube_report_quality_gate: __('Quality Gate'),
      sonarqube_report_conditions: __('Quality Gate Conditions'),
      sonarqube_report_metrics: __('Metrics'),
      sonarqube_report_issues: __('Issues'),
    },
  };
}
