import chalk, { type ChalkInstance } from 'chalk';

// ─── Scanner color palette ────────────────────────────────────────────────────

export const SCANNER_COLORS: Map<string, ChalkInstance> = new Map([
  ['osv', chalk.hex('#F97316')],
  ['sonarqube', chalk.hex('#4D9FE8')],
  ['npm', chalk.hex('#22C55E')],
  ['composer', chalk.hex('#8B5CF6')],
  ['pip', chalk.hex('#F59E0B')],
]);

function scannerColor(id: string): ChalkInstance {
  return SCANNER_COLORS.get(id) ?? chalk.bold.white;
}

// ─── Badge ────────────────────────────────────────────────────────────────────

export function badge(id: string): string {
  return scannerColor(id)(`[${id.toUpperCase()}]`);
}

// ─── Divider ──────────────────────────────────────────────────────────────────

const DIVIDER_WIDTH = 60;
const DIVIDER_CHAR = '─';

export function divider(label?: string): string {
  const color = label !== undefined && SCANNER_COLORS.has(label)
    ? scannerColor(label)
    : chalk.gray;

  if (label === undefined || label === '') {
    return color(DIVIDER_CHAR.repeat(DIVIDER_WIDTH));
  }

  const inner = ` ${label.toUpperCase()} `;
  const remaining = Math.max(0, DIVIDER_WIDTH - inner.length);
  const leftCount = Math.floor(remaining / 2);
  const rightCount = remaining - leftCount;

  return color(
    `${DIVIDER_CHAR.repeat(leftCount)}${inner}${DIVIDER_CHAR.repeat(rightCount)}`,
  );
}

// ─── Tag ─────────────────────────────────────────────────────────────────────

/**
 * Returns a colored badge for `id` followed by the literal bracket label.
 * Example: tag('osv', 'OSV verify') → '\x1b[...][OSV]\x1b[m] [OSV verify]'
 * The `[<label>]` substring is always preserved verbatim so downstream string
 * assertions remain intact.
 */
export function tag(id: string, label: string): string {
  return `${badge(id)} [${label}]`;
}

// ─── Section header ───────────────────────────────────────────────────────────

const SECTION_HEADER_WIDTH = 54;
const SECTION_HEADER_CHAR = '─';

export function sectionHeader(title: string): string {
  const prefix = `${SECTION_HEADER_CHAR}${SECTION_HEADER_CHAR} `;
  const suffix = ' ';
  const inner = prefix + title + suffix;
  const remaining = Math.max(0, SECTION_HEADER_WIDTH - inner.length);
  const line = chalk.gray(inner + SECTION_HEADER_CHAR.repeat(remaining));
  return `\n${line}\n\n`;
}

// ─── Semantic chalk shortcuts ─────────────────────────────────────────────────

export const dim = chalk.dim;
export const success = chalk.hex('#22C55E').bold;
export const warn = chalk.hex('#F59E0B').bold;
export const error = chalk.hex('#EF4444').bold;
