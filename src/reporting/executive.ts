import { stripVTControlCharacters } from 'node:util';

import type { ExecutiveReportOptions } from '@core/types/report';

import { render } from './renderer';
import {
  buildEntryReportViewModel,
  buildExecutiveReportViewModel,
  escapeMdTableCell,
  vulnLink,
} from './report-view-model';
import executiveTemplate from './templates/executive.hbs';

// Re-export the formatting helpers so existing importers of `@reporting/executive`
// keep working (ADR 0008 — the transforms moved to report-view-model.ts).
export { escapeMdTableCell, vulnLink };

// Backward-compatible aliases for the pre-split public API names. The pure
// transforms now live in report-view-model.ts under their new names; these
// aliases keep existing importers (and their "context" naming) working.
export const buildExecutiveReportContext = buildExecutiveReportViewModel;
export const buildEntryReportContext = buildEntryReportViewModel;

// Preserve Markdown whitespace (tab, LF, CR) while removing residual C0/C1 controls.
// oxlint-disable-next-line no-control-regex
const NON_MARKDOWN_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function sanitizeMarkdownOutput(markdown: string): string {
  return stripVTControlCharacters(markdown).replace(NON_MARKDOWN_CONTROL_CHARACTERS, '');
}

function monthName(date: Date): string {
  return date.toLocaleString('en-US', { month: 'long' });
}

export function generateExecutiveReport(opts: ExecutiveReportOptions): string {
  const viewModel = buildExecutiveReportViewModel(opts);
  return sanitizeMarkdownOutput(render(executiveTemplate, viewModel));
}

export function executiveReportFilename(client: string, project: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `[${client} ${project}] Security Report - ${year}-${month} - ${monthName(now)}.md`;
}

/**
 * Generate an executive report scoped to a single ecosystem entry.
 * Convenience wrapper around buildEntryReportViewModel + render.
 */
export function generateEntryReport(opts: ExecutiveReportOptions, entryKey: string): string {
  const viewModel = buildEntryReportViewModel(opts, entryKey);
  return sanitizeMarkdownOutput(render(executiveTemplate, viewModel));
}

/**
 * Derive a split report filename by inserting the entry identifier
 * (with colons replaced by hyphens) before the final extension.
 *
 * Example:
 *   base:    '[Client Project] Security Report - 2026-05 - May.md'
 *   entry:   'npm:frontend'
 *   result:  '[Client Project] Security Report - npm-frontend - 2026-05 - May.md'
 */
export function splitReportFilename(baseFilename: string, entryKey: string): string {
  const slug = entryKey.replace(/:/g, '-');
  const dotIndex = baseFilename.lastIndexOf('.');
  if (dotIndex === -1) return `${baseFilename}-${slug}`;
  const name = baseFilename.slice(0, dotIndex);
  const ext = baseFilename.slice(dotIndex);
  // Insert the slug after the first segment that ends with '] Security Report'
  // Format: '[Client Project] Security Report - <slug> - YYYY-MM - Month.md'
  const markerIndex = name.indexOf('] Security Report - ');
  if (markerIndex !== -1) {
    const afterMarker = name.slice(markerIndex + '] Security Report - '.length);
    const beforeMarker = name.slice(0, markerIndex + '] Security Report - '.length);
    return `${beforeMarker}${slug} - ${afterMarker}${ext}`;
  }
  return `${name} - ${slug}${ext}`;
}
