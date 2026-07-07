import semver from 'semver';

import { classifyPackage } from '@core/policy/safe-update';
import type { ProjectConfig, ProtectedPackage } from '@core/types/config';
import { emptyEcosystem } from '@core/types/scan';
import type { ScanResultJson, EcosystemScanResult, VulnerabilityEntry } from '@core/types/scan';
import type { EcosystemRegistry } from '@modules/ecosystem/registry';

// ─── Internal types ────────────────────────────────────────────────────────────

interface OsvVulnerability {
  id?: string;
  summary?: string;
  severity?: { type?: string; score?: string }[];
  affected?: {
    ranges?: {
      /**
       * OSV range type: 'SEMVER' | 'ECOSYSTEM' | 'GIT'.
       * GIT ranges carry commit SHAs, not installable package versions — must be
       * excluded from version-based fix detection to avoid semver.coerce() treating
       * a leading-digit SHA (e.g. "9e08eb8f…") as "9.0.0".
       */
      type?: string;
      events?: {
        fixed?: string;
        introduced?: string;
        last_affected?: string;
      }[];
    }[];
  }[];
}

interface OsvPackageEntry {
  package?: { name?: string; version?: string; ecosystem?: string };
  vulnerabilities?: OsvVulnerability[];
}

interface OsvResultEntry {
  packages?: OsvPackageEntry[];
}

export interface OsvJsonOutput {
  results?: OsvResultEntry[];
}

interface ClassificationBuckets {
  auto_safe: Set<string>;
  breaking: Set<string>;
  manual: Set<string>;
}

// ─── CVSS helpers ─────────────────────────────────────────────────────────────

function cvssMetricValue(map: Record<string, number>, key: string | undefined): number {
  return map[key ?? ''] ?? 0;
}

function extractCvssMetrics(vectorBody: string): Record<string, string> {
  const metrics: Record<string, string> = {};
  for (const part of vectorBody.split('/')) {
    const [k, v] = part.split(':');
    if (k && v) metrics[k] = v;
  }
  return metrics;
}

function extractCvssComponents(metrics: Record<string, string>): {
  av: number;
  ac: number;
  scope: boolean;
  pr: number;
  ui: number;
  c: number;
  i: number;
  a: number;
} {
  const scope = metrics['S'] === 'C';
  const prMap = scope
    ? { N: 0.85, L: 0.68, H: 0.50 }
    : { N: 0.85, L: 0.62, H: 0.27 };
  const impMap = { N: 0, L: 0.22, H: 0.56 };

  return {
    av: cvssMetricValue({ N: 0.85, A: 0.62, L: 0.55, P: 0.2 }, metrics['AV']),
    ac: cvssMetricValue({ L: 0.77, H: 0.44 }, metrics['AC']),
    scope,
    pr: cvssMetricValue(prMap, metrics['PR']),
    ui: cvssMetricValue({ N: 0.85, R: 0.62 }, metrics['UI']),
    c: cvssMetricValue(impMap, metrics['C']),
    i: cvssMetricValue(impMap, metrics['I']),
    a: cvssMetricValue(impMap, metrics['A']),
  };
}

function computeCvssImpactSubScore(iscBase: number, scope: boolean): number {
  return scope
    ? 7.52 * (iscBase - 0.029) - 3.25 * Math.pow(iscBase - 0.02, 15)
    : 6.42 * iscBase;
}

function combineCvssRawScore(isc: number, exploitability: number, scope: boolean): number {
  return scope
    ? Math.min(1.08 * (isc + exploitability), 10)
    : Math.min(isc + exploitability, 10);
}

function computeCvssScore(metrics: Record<string, string>): string {
  const { av, ac, scope, pr, ui, c, i, a } = extractCvssComponents(metrics);

  const iscBase = 1 - (1 - c) * (1 - i) * (1 - a);
  if (iscBase <= 0) return '0.0';

  const isc = computeCvssImpactSubScore(iscBase, scope);
  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = combineCvssRawScore(isc, exploitability, scope);

  return (Math.ceil(raw * 10) / 10).toFixed(1);
}

function parseCvssBaseScore(score: string): string {
  try {
    const match = score.match(/CVSS:\d+\.\d+\/(.+)/);
    if (!match) return '—';
    return computeCvssScore(extractCvssMetrics(match[1]!));
  } catch {
    return '—';
  }
}

function extractCvss(vuln: { severity?: { type?: string; score?: string }[] }): string {
  for (const s of vuln.severity ?? []) {
    if (s.type === 'CVSS_V3' && s.score) {
      return parseCvssBaseScore(s.score);
    }
  }
  return '—';
}

// ─── Safe-version helpers ──────────────────────────────────────────────────────

function findFirstFixedInRange(range: { type?: string; events?: { fixed?: string }[] }): string | null {
  if (range.type === 'GIT') return null;
  for (const event of range.events ?? []) {
    if (event.fixed) return event.fixed;
  }
  return null;
}

function findFirstFixedFromNonGitRanges(vuln: OsvVulnerability): string | null {
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      const fixed = findFirstFixedInRange(range);
      if (fixed) return fixed;
    }
  }
  return null;
}

function extractRangeEvents(
  range: { events?: { fixed?: string; introduced?: string }[] },
): { introduced?: string; fixed?: string } {
  let introduced: string | undefined;
  let fixed: string | undefined;

  for (const event of range.events ?? []) {
    if (event.introduced !== undefined) introduced = event.introduced;
    if (event.fixed !== undefined) fixed = event.fixed;
  }

  return { introduced, fixed };
}

function isCurrentVersionInRange(
  coercedCurrent: semver.SemVer,
  coercedIntroduced: semver.SemVer | null,
  coercedFixed: semver.SemVer,
): boolean {
  const afterIntroduced = !coercedIntroduced || semver.gte(coercedCurrent, coercedIntroduced);
  const beforeFixed = semver.lt(coercedCurrent, coercedFixed);
  return afterIntroduced && beforeFixed;
}

function findFixedInRangeIfApplicable(
  range: { type?: string; events?: { fixed?: string; introduced?: string }[] },
  coercedCurrent: semver.SemVer,
): string | null {
  // GIT ranges carry commit SHAs — semver.coerce() on a leading-digit SHA
  // (e.g. "9e08eb8f…") would produce "9.0.0", falsely treating it as a
  // semver fix target. Only SEMVER and ECOSYSTEM ranges are package-installable.
  if (range.type === 'GIT') return null;

  const { introduced, fixed } = extractRangeEvents(range);
  if (!fixed) return null; // range without fixed (e.g. last_affected only) — skip

  const coercedIntroduced = introduced ? semver.coerce(introduced) : null;
  const coercedFixed = semver.coerce(fixed);
  if (!coercedFixed) return null;

  return isCurrentVersionInRange(coercedCurrent, coercedIntroduced, coercedFixed) ? fixed : null;
}

function findSafeVersionInRanges(vuln: OsvVulnerability, coercedCurrent: semver.SemVer): string | null {
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      const fixed = findFixedInRangeIfApplicable(range, coercedCurrent);
      if (fixed) return fixed;
    }
  }
  return null;
}

function extractSafeVersionFromVuln(vuln: OsvVulnerability, currentVersion: string): string | null {
  const coercedCurrent = semver.coerce(currentVersion);
  if (!coercedCurrent) {
    // Fallback for non-semver versions: return the first fixed found from a non-GIT range.
    return findFirstFixedFromNonGitRanges(vuln);
  }
  return findSafeVersionInRanges(vuln, coercedCurrent);
}

// ─── Parse helpers ─────────────────────────────────────────────────────────────

function buildProtectedByPlugin(registry: EcosystemRegistry, config: ProjectConfig) {
  return new Map(
    registry.getAll().map((plugin) => [
      plugin.id,
      new Map(plugin.getProtectedPackages(config).map((p) => [p.package, p])),
    ]),
  );
}

function ensureEcosystemBucket(
  ecosystems: Record<string, EcosystemScanResult>,
  ecosystemSets: Record<string, ClassificationBuckets>,
  pluginId: string,
): { target: EcosystemScanResult; targetSets: ClassificationBuckets } {
  if (!ecosystems[pluginId]) {
    ecosystems[pluginId] = emptyEcosystem();
    ecosystemSets[pluginId] = {
      auto_safe: new Set<string>(),
      breaking: new Set<string>(),
      manual: new Set<string>(),
    };
  }
  return { target: ecosystems[pluginId]!, targetSets: ecosystemSets[pluginId]! };
}

function extractPackageIdentity(
  pkg: OsvPackageEntry,
): { pkgName: string; pkgVersion: string; osvEcosystem: string } {
  return {
    pkgName: pkg.package?.name ?? '',
    pkgVersion: pkg.package?.version ?? '',
    osvEcosystem: pkg.package?.ecosystem ?? '',
  };
}

function addUniquePackageRef(set: Set<string>, arr: string[], packageRef: string): void {
  if (!set.has(packageRef)) {
    set.add(packageRef);
    arr.push(packageRef);
  }
}

function recordClassification(
  target: EcosystemScanResult,
  targetSets: ClassificationBuckets,
  classification: VulnerabilityEntry['classification'],
  packageRef: string,
): void {
  if (classification === 'auto_safe') {
    target.auto_safe++;
    addUniquePackageRef(targetSets.auto_safe, target.auto_safe_packages, packageRef);
  } else if (classification === 'breaking') {
    target.breaking++;
    addUniquePackageRef(targetSets.breaking, target.breaking_packages, packageRef);
  } else {
    target.manual++;
    addUniquePackageRef(targetSets.manual, target.manual_packages, packageRef);
  }
}

function buildVulnerabilityEntry(
  vuln: OsvVulnerability,
  pkgName: string,
  pkgVersion: string,
  pluginId: string,
  protectedMap: Map<string, ProtectedPackage>,
): VulnerabilityEntry {
  const ghsaId = vuln.id ?? '';
  const risk = vuln.summary ?? '';
  const cvss = extractCvss(vuln);
  const safeVersion = extractSafeVersionFromVuln(vuln, pkgVersion);

  const classified = classifyPackage(
    { name: pkgName, currentVersion: pkgVersion, safeVersion },
    protectedMap,
  );

  return {
    ecosystem: pluginId,
    package: pkgName,
    currentVersion: pkgVersion,
    safeVersion,
    cvss,
    ghsaId,
    risk,
    classification: classified.classification,
    reason: classified.reason ?? '',
    ...(classified.breakingReason !== undefined ? { breakingReason: classified.breakingReason } : {}),
  };
}

function processPackageVulnerabilities(
  pkg: OsvPackageEntry,
  pkgName: string,
  pkgVersion: string,
  pluginId: string,
  target: EcosystemScanResult,
  targetSets: ClassificationBuckets,
  protectedMap: Map<string, ProtectedPackage>,
): void {
  for (const vuln of pkg.vulnerabilities ?? []) {
    const entry = buildVulnerabilityEntry(vuln, pkgName, pkgVersion, pluginId, protectedMap);
    target.vulnerabilities.push(entry);
    target.vulnerabilities_total++;

    const packageRef = `${pkgName}@${pkgVersion}`;
    recordClassification(target, targetSets, entry.classification, packageRef);
  }
}

function processPackage(
  pkg: OsvPackageEntry,
  registry: EcosystemRegistry,
  protectedByPlugin: Map<string, Map<string, ProtectedPackage>>,
  ecosystems: Record<string, EcosystemScanResult>,
  ecosystemSets: Record<string, ClassificationBuckets>,
): void {
  const { pkgName, pkgVersion, osvEcosystem } = extractPackageIdentity(pkg);

  const plugin = registry.findByOsvEcosystem(osvEcosystem);
  if (!plugin) return;

  const { target, targetSets } = ensureEcosystemBucket(ecosystems, ecosystemSets, plugin.id);
  const protectedMap = protectedByPlugin.get(plugin.id) ?? new Map<string, ProtectedPackage>();

  processPackageVulnerabilities(pkg, pkgName, pkgVersion, plugin.id, target, targetSets, protectedMap);
}

/**
 * Parses raw osv-scanner JSON output into the canonical `ecosystems` findings map.
 *
 * Pure transformation: JSON → per-ecosystem vulnerability lists with CVSS scores,
 * safe-version resolution, and auto_safe/breaking/manual classification. No I/O.
 */
export function parseOsvJsonOutput(
  stdout: string,
  config: ProjectConfig,
  registry: EcosystemRegistry,
): Pick<ScanResultJson, 'ecosystems'> {
  const data = JSON.parse(stdout) as OsvJsonOutput;
  const ecosystems: Record<string, EcosystemScanResult> = {};

  if (!data.results) return { ecosystems };

  const protectedByPlugin = buildProtectedByPlugin(registry, config);
  const ecosystemSets: Record<string, ClassificationBuckets> = {};

  for (const result of data.results) {
    for (const pkg of result.packages ?? []) {
      processPackage(pkg, registry, protectedByPlugin, ecosystems, ecosystemSets);
    }
  }

  return { ecosystems };
}
