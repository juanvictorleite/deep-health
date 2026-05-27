import { success, warn, dim } from '@infra/utils/ui';
import { __ } from '@core/i18n';
import { CLI_NAME } from '@infra/brand';
import type { ScanResultJson } from '@core/types/scan';
import type { UpdateResultJson } from '@core/types/update';

export interface FixSummaryInput {
  scanResult: ScanResultJson | null;
  updates: Record<string, UpdateResultJson>;
  hasPendingVulns: boolean;
  overallStatus: string;
  reportPath?: string;
  auditTrailPath?: string;
}

export interface BreakingWarningEntry {
  pluginName: string;
  entryKey: string;
  count: number;
  packages: string[];
}

/**
 * Returns a formatted multi-line success/partial summary string for the fix pipeline.
 * No side effects — pure string formatting for testability.
 */
export function formatFixSummary(input: FixSummaryInput): string {
  const { scanResult, updates, hasPendingVulns, overallStatus, reportPath, auditTrailPath } = input;

  const lines: string[] = [];

  lines.push('');

  const totalVulns = scanResult
    ? Object.values(scanResult.ecosystems).reduce(
        (sum, eco) => sum + (eco.vulnerabilities_total ?? 0),
        0,
      )
    : 0;

  const fixedCount = Object.values(updates).reduce(
    (sum, u) => sum + (u.packages_updated?.length ?? 0),
    0,
  );

  if (overallStatus === 'error') {
    lines.push(warn(__('Pipeline completed with errors.')));
  } else if (hasPendingVulns) {
    lines.push(warn(__('Fix pipeline completed — vulnerabilities remain.')));
    lines.push(
      success(__('  ✔ Scanned: {{count}} vulnerabilities found', { count: totalVulns })),
    );
    lines.push(
      success(__('  ✔ Fixed: {{count}} package(s)', { count: fixedCount })),
    );
    lines.push(
      warn(__('  ⚠ Remaining: vulnerabilities still pending (manual or breaking)')),
    );
  } else {
    lines.push(success(__('Fix pipeline completed successfully.')));
    lines.push(
      success(__('  ✔ Scanned: {{count}} vulnerabilities found', { count: totalVulns })),
    );
    lines.push(
      success(__('  ✔ Fixed: {{count}} package(s)', { count: fixedCount })),
    );
    lines.push(
      success(__('  ✔ Remaining: 0')),
    );
  }

  if (reportPath) {
    lines.push(success(__('  ✔ Report: {{path}}', { path: reportPath })));
  }

  if (auditTrailPath) {
    lines.push(success(__('  ✔ Audit trail: {{path}}', { path: auditTrailPath })));
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Returns a formatted breaking-change warning block.
 * Groups packages by ecosystem and appends a combined --authorize-breaking command.
 * No side effects — pure string formatting for testability.
 */
export function formatBreakingWarning(entries: BreakingWarningEntry[]): string {
  if (entries.length === 0) return '';

  const lines: string[] = [];

  lines.push(warn(__('Breaking-change updates were skipped:')));

  for (const entry of entries) {
    lines.push(warn(__('  {{pluginName}} ({{entryKey}}): {{count}} package(s)', {
      pluginName: entry.pluginName,
      entryKey: entry.entryKey,
      count: entry.count,
    })));

    for (const pkg of entry.packages) {
      lines.push(dim(__('    - {{pkg}}', { pkg })));
    }
  }

  const allEntryKeys = entries.map((e) => e.entryKey).join(' ');
  lines.push('');
  lines.push(
    dim(
      __('  To authorize: {{cliName}} fix --authorize-breaking {{entryKeys}}', {
        cliName: CLI_NAME,
        entryKeys: allEntryKeys,
      }),
    ),
  );

  return lines.join('\n') + '\n';
}
