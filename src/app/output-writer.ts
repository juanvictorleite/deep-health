import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import chalk from 'chalk';

import { __ } from '@core/i18n';
import type { EcosystemScanResult, ScanResultJson } from '@core/types/scan';
import { SCANNER_COLORS, warn, dim, success } from '@infra/utils/ui';

// ─── Column layout ────────────────────────────────────────────────────────────

function padColumn(text: string, width: number, align: 'left' | 'right'): string {
  // Strip ANSI codes for length calculation
  // oxlint-disable-next-line no-control-regex
  const visibleLength = text.replace(/\x1b\[[0-9;]*m/g, '').length;
  const padding = Math.max(0, width - visibleLength);
  if (align === 'right') {
    return ' '.repeat(padding) + text;
  }
  return text + ' '.repeat(padding);
}

/**
 * Format a count cell with optional warning coloring.
 * When warnWhenPositive is true: positive counts are highlighted with warn(),
 * zero counts are dimmed. When false: zero counts are dimmed, positive counts
 * are plain.
 */
function formatCountCell(count: number, width: number, warnWhenPositive: boolean): string {
  let formatted: string;
  if (warnWhenPositive) {
    formatted = count > 0 ? warn(String(count)) : dim(String(count));
  } else {
    formatted = count === 0 ? dim(String(count)) : String(count);
  }
  return padColumn(formatted, width, 'right');
}

/**
 * Format a single ecosystem row for the scan summary table.
 */
function formatEcosystemRow(
  id: string,
  eco: EcosystemScanResult,
  colWidths: Record<string, number>,
): string {
  const ecoColor = SCANNER_COLORS.get(id) ?? chalk.bold.white;
  const ecoName = padColumn(ecoColor(id), colWidths.ecosystem, 'left');

  const totalStr = formatCountCell(eco.vulnerabilities_total, colWidths.total, false);
  const autoSafeStr = formatCountCell(eco.auto_safe, colWidths.autoSafe, false);
  const blockedStr = formatCountCell(eco.blocked ?? 0, colWidths.blocked, true);
  const breakingStr = formatCountCell(eco.breaking, colWidths.breaking, true);
  const manualStr = formatCountCell(eco.manual, colWidths.manual, false);

  return `${ecoName}  ${totalStr}  ${autoSafeStr}  ${blockedStr}  ${breakingStr}  ${manualStr}`;
}

// ─── Terminal-formatted summary (stdout) ──────────────────────────────────────

/**
 * Format a scan result as a terminal-formatted summary with chalk coloring.
 */
export function formatScanSummary(scan: ScanResultJson): string {
  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  lines.push(chalk.bold(`OSV Scan Report — ${date}`));
  lines.push('');

  const ecosystemEntries = Object.entries(scan.ecosystems);
  const totalVulns = ecosystemEntries.reduce((sum, [, eco]) => sum + eco.vulnerabilities_total, 0);

  if (totalVulns === 0) {
    lines.push(success(__('No vulnerabilities found — project is clean.')));
  } else {
    // Table header
    const colWidths = { ecosystem: 14, total: 7, autoSafe: 10, blocked: 9, breaking: 9, manual: 8 };

    const header = [
      padColumn(chalk.gray(__('Ecosystem')), colWidths.ecosystem, 'left'),
      padColumn(chalk.gray(__('Total')), colWidths.total, 'right'),
      padColumn(chalk.gray(__('Auto-safe')), colWidths.autoSafe, 'right'),
      padColumn(chalk.gray(__('Blocked')), colWidths.blocked, 'right'),
      padColumn(chalk.gray(__('Breaking')), colWidths.breaking, 'right'),
      padColumn(chalk.gray(__('Manual')), colWidths.manual, 'right'),
    ].join('  ');

    lines.push(header);
    lines.push(chalk.gray('─'.repeat(69)));

    for (const [id, eco] of ecosystemEntries) {
      lines.push(formatEcosystemRow(id, eco, colWidths));
    }

    lines.push('');

    const ecoCount = ecosystemEntries.length;
    lines.push(
      __('{{total}} vulnerabilities across {{count}} ecosystem(s).', {
        total: String(totalVulns),
        count: String(ecoCount),
      }),
    );
  }

  if (scan.error) {
    lines.push('');
    lines.push(chalk.yellow(`Warning: ${scan.error}`));
  }

  return lines.join('\n');
}

// ─── Markdown-formatted summary (file output) ────────────────────────────────

/**
 * Format a scan result as a human-readable markdown summary (for --output file).
 */
export function formatScanSummaryMarkdown(scan: ScanResultJson): string {
  const lines: string[] = [
    `## OSV Scan Report — ${new Date().toISOString().split('T')[0]}`,
    `**Environment:** ${scan.environment}`,
    '',
  ];

  for (const [id, eco] of Object.entries(scan.ecosystems)) {
    lines.push(
      `### ${id}`,
      `- Total: ${eco.vulnerabilities_total}`,
      `- Auto-safe: ${eco.auto_safe}`,
      `- Blocked: ${eco.blocked ?? 0}`,
      `- Breaking: ${eco.breaking}`,
      `- Manual: ${eco.manual}`,
      '',
    );
  }

  if (scan.error) {
    lines.push(`**Warning:** ${scan.error}`);
  }

  return lines.join('\n');
}

// ─── Write output ─────────────────────────────────────────────────────────────

/**
 * Write content to a file path, or stdout if no path is given.
 */
export async function writeOutput(
  content: string,
  outputPath?: string,
): Promise<void> {
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, 'utf-8');
  } else {
    process.stdout.write(content + '\n');
  }
}
