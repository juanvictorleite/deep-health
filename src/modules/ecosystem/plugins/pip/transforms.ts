import semver from 'semver';

import type { VulnerabilityClass } from '@core/types/common';
import type { VulnerabilityEntry } from '@core/types/scan';

/**
 * Strip pip version specifiers and extras from a package reference.
 *
 * Rules (applied in order):
 * 1. Strip trailing `[extras]` group (e.g. `pkg[security]` → `pkg`)
 * 2. Split on first occurrence of `==|>=|<=|~=|!=|>|<|@` — keep left side
 * 3. Trim whitespace
 *
 * Examples:
 *   'requests==2.31'         → 'requests'
 *   'requests>=2.0'          → 'requests'
 *   'requests[security]==2'  → 'requests'
 *   'requests[a,b]>=1'       → 'requests'
 *   'requests@1.0'           → 'requests'
 *   'requests'               → 'requests'
 */
export function stripPipVersion(ref: string): string {
  // Strip extras brackets first
  let cleaned = ref.replace(/\[[^\]]*\]/g, '');
  // Split on first version specifier operator
  const match = cleaned.match(/^([^=!<>~@]*)/);
  cleaned = match ? (match[1] ?? cleaned) : cleaned;
  return cleaned.trim();
}

/**
 * Convert a scan entry to a pip install spec with a pinned version.
 *
 * Handles both '@' and '==' separators used in scan data:
 *   'pillow==9.5.0'    → 'pillow==9.5.0'
 *   'pillow@9.5.0'     → 'pillow==9.5.0'
 *   'pillow'           → 'pillow'  (no version found)
 *
 * The '-U' flag is intentionally omitted — we install the exact OSV-recommended version.
 */
export function toPipInstallSpec(scanEntry: string): string {
  const name = stripPipVersion(scanEntry);
  const match = scanEntry.match(/(?:==|@)([^\s,;@=]+)/);
  if (!match) return name;
  const version = match[1]!;
  return `${name}==${version}`;
}

/**
 * Compute the maximum safe version for each package from the vulnerabilities array.
 *
 * Algorithm:
 *   1. Filter entries by the provided classifications set.
 *   2. Skip entries with null safeVersion.
 *   3. Group by lowercase package name.
 *   4. For each group, pick the MAX safeVersion using semver.coerce + semver.gt.
 *      Falls back to localeCompare when both versions are non-semver-coercible.
 *
 * @param vulnerabilities - Array of VulnerabilityEntry from the ecosystem scan.
 * @param classifications - Set of VulnerabilityClass values to include (e.g. {'auto_safe'} or {'auto_safe','breaking'}).
 * @returns Map<lowercasePkgName, maxSafeVersion>
 */
export function computeMaxSafeVersions(
  vulnerabilities: VulnerabilityEntry[],
  classifications: Set<VulnerabilityClass>,
): Map<string, string> {
  const result = new Map<string, string>();

  for (const entry of vulnerabilities) {
    if (!classifications.has(entry.classification)) continue;
    if (entry.safeVersion === null) continue;

    const pkg = entry.package.toLowerCase();
    const candidate = entry.safeVersion;
    const existing = result.get(pkg);

    if (existing === undefined) {
      result.set(pkg, candidate);
      continue;
    }

    // Compare candidate vs existing — pick the larger one
    const semCandidate = semver.coerce(candidate);
    const semExisting = semver.coerce(existing);

    if (semCandidate !== null && semExisting !== null) {
      if (semver.gt(semCandidate, semExisting)) {
        result.set(pkg, candidate);
      }
    } else {
      // Fallback for non-semver versions: use localeCompare
      if (candidate.localeCompare(existing) > 0) {
        result.set(pkg, candidate);
      }
    }
  }

  return result;
}

/**
 * Compute all unique safe versions for each package from the vulnerabilities array,
 * sorted descending (highest first).
 *
 * Algorithm:
 *   1. Filter entries by the provided classifications set.
 *   2. Skip entries with null safeVersion.
 *   3. Group by lowercase package name — collect all unique safeVersions per package.
 *   4. Sort each group descending: semver.coerce + semver.gt for semver-parseable versions,
 *      with localeCompare fallback for non-semver pip versions.
 *
 * @param vulnerabilities - Array of VulnerabilityEntry from the ecosystem scan.
 * @param classifications - Set of VulnerabilityClass values to include.
 * @returns Map<lowercasePkgName, string[]> where the array is sorted descending.
 */
export function computeSortedSafeVersions(
  vulnerabilities: VulnerabilityEntry[],
  classifications: Set<VulnerabilityClass>,
): Map<string, string[]> {
  const result = new Map<string, Set<string>>();

  for (const entry of vulnerabilities) {
    if (!classifications.has(entry.classification)) continue;
    if (entry.safeVersion === null) continue;

    const pkg = entry.package.toLowerCase();
    const existing = result.get(pkg);
    if (existing === undefined) {
      result.set(pkg, new Set([entry.safeVersion]));
    } else {
      existing.add(entry.safeVersion);
    }
  }

  const sorted = new Map<string, string[]>();
  for (const [pkg, versions] of result) {
    sorted.set(pkg, [...versions].sort(compareVersionsDescending));
  }
  return sorted;
}

function compareVersionsDescending(a: string, b: string): number {
  const semA = semver.coerce(a);
  const semB = semver.coerce(b);
  if (semA !== null && semB !== null) {
    return semver.gt(semA, semB) ? -1 : semver.gt(semB, semA) ? 1 : 0;
  }
  return b.localeCompare(a);
}

/**
 * Rewrite requirements.txt content with newly installed versions.
 *
 * For each package line:
 *   - Preserve comments (#), blank lines, and options (-r, -e, --)
 *   - Split on ';' to separate environment markers
 *   - Extract package name (and optional extras) from the left side
 *   - Look up lowercase name in installedVersions
 *   - If found: replace version specifier with ==<installedVersion>
 *   - If not found: keep line as-is
 *
 * @param content - Current requirements.txt content
 * @param installedVersions - Map of lowercase package name → installed version
 */
export function updateRequirementsContent(
  content: string,
  installedVersions: Map<string, string>,
): string {
  if (installedVersions.size === 0) return content;

  const lines = content.split('\n');
  const result = lines.map((line) => {
    const trimmed = line.trim();

    // Preserve blank lines, comments, and options (-r, -e, --)
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('-')) {
      return line;
    }

    // Split on ';' to preserve environment markers
    const semicolonIdx = line.indexOf(';');
    const packagePart = semicolonIdx === -1 ? line : line.slice(0, semicolonIdx);
    const markerPart = semicolonIdx === -1 ? '' : line.slice(semicolonIdx);

    // Extract extras (e.g. [security]) from the package part
    const extrasMatch = packagePart.match(/(\[[^\]]*\])/);
    const extras = extrasMatch ? extrasMatch[1]! : '';

    // Get lowercase package name for map lookup
    const pkgName = stripPipVersion(packagePart.trim()).toLowerCase();

    const installedVersion = installedVersions.get(pkgName);
    if (installedVersion === undefined) return line;

    // Reconstruct: originalName[extras]==newVersion; marker
    return `${pkgName}${extras}==${installedVersion}${markerPart}`;
  });

  return result.join('\n');
}

/**
 * Parse the `Successfully installed` line emitted by pip after a successful install.
 *
 * Format: `Successfully installed pkg1-1.0.0 pkg2-2.3.4 django-debug-toolbar-6.3.0`
 *
 * Splitting on the last hyphen that precedes a digit sequence handles packages
 * with hyphens in their names (e.g. `django-debug-toolbar-6.3.0`).
 *
 * Returns a Map of lowercase-normalized package name → installed version.
 * Returns an empty Map when the line is absent or unparseable.
 */
export function parsePipInstalledVersions(stdout: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('Successfully installed ')) continue;

    const tokens = trimmed.slice('Successfully installed '.length).split(/\s+/);
    for (const token of tokens) {
      // Find the last hyphen that is immediately followed by a digit
      const match = token.match(/^(.*)-(\d[\d.]*)$/);
      if (!match) continue;
      const name = match[1]!.toLowerCase();
      const version = match[2]!;
      if (name) {
        result.set(name, version);
      }
    }
    break; // Only one "Successfully installed" line expected
  }
  return result;
}

/**
 * Build the `packages_updated` array for pip using installed versions from pip stdout.
 *
 * For each auto_safe package (e.g. "pillow==8.0.1"), look up the name in the
 * installed-versions map and use the real installed version.
 *
 * Packages NOT present in `installedVersions` are silently skipped — they were
 * excluded by the greedy subset algorithm (findCompatibleSubset) and were never
 * actually installed.
 *
 * Returns an empty array when `installedVersions` is empty (nothing was installed).
 */
export function buildPipPackagesUpdated(
  autoSafePackages: string[],
  installedVersions: Map<string, string>,
): string[] {
  if (installedVersions.size === 0) return [];

  const updated: string[] = [];
  for (const pkg of autoSafePackages) {
    const name = stripPipVersion(pkg).toLowerCase();
    const installedVersion = installedVersions.get(name);
    if (installedVersion !== undefined) {
      // Use the real installed version
      updated.push(`${name}@${installedVersion}`);
    }
    // Packages not in installedVersions were excluded by the greedy subset — skip them.
  }
  return updated;
}

/**
 * Parse pip-audit --fix JSON output.
 *
 * pip-audit JSON structure:
 *   { fixes?: Array<{ name?: string; version?: string; fix_version?: string; is_skipped?: boolean }> }
 *
 * Returns 'name@fix_version' (lowercase name) for each entry where:
 *   - is_skipped is falsy
 *   - fix_version is present and non-empty
 *
 * Returns empty array on parse failure, missing fixes array, or any unexpected shape.
 */
function parseSingleFixEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const fix = entry as Record<string, unknown>;
  if (fix['is_skipped']) return null;
  const name = typeof fix['name'] === 'string' ? fix['name'].toLowerCase() : undefined;
  const fixVersion = typeof fix['fix_version'] === 'string' ? fix['fix_version'] : undefined;
  if (name && fixVersion) return `${name}@${fixVersion}`;
  return null;
}

export function parsePipAuditFixJson(stdout: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object') return [];

    const obj = parsed as Record<string, unknown>;
    const fixes = obj['fixes'];
    if (!Array.isArray(fixes)) return [];

    return fixes.map(parseSingleFixEntry).filter((r): r is string => r !== null);
  } catch {
    return [];
  }
}

/**
 * Build a map of lowercase package name → maximum CVSS score from the
 * provided vulnerability list, filtered to the given classifications.
 *
 * Non-numeric CVSS values (e.g. '—', '') are treated as 0.
 */
export function buildMaxCvssMap(
  vulnerabilities: VulnerabilityEntry[],
  classifications: Set<VulnerabilityClass>,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const vuln of vulnerabilities) {
    if (!classifications.has(vuln.classification)) continue;
    const pkgName = vuln.package.toLowerCase();
    const score = parseFloat(vuln.cvss);
    const numeric = Number.isNaN(score) ? 0 : score;
    const current = result.get(pkgName);
    if (current === undefined || numeric > current) result.set(pkgName, numeric);
  }
  return result;
}

/**
 * Return a new array of package specs sorted descending by CVSS score.
 *
 * Package name is extracted by splitting on '==' and taking the first segment.
 * Specs not present in cvssMap sort last (treated as CVSS 0).
 * Sort is stable — equal-CVSS specs retain their original relative order.
 */
export function sortSpecsByCvss(specs: string[], cvssMap: Map<string, number>): string[] {
  return [...specs].sort((a, b) => {
    const scoreA = cvssMap.get((a.split('==')[0] ?? a).toLowerCase()) ?? 0;
    const scoreB = cvssMap.get((b.split('==')[0] ?? b).toLowerCase()) ?? 0;
    return scoreB - scoreA;
  });
}
