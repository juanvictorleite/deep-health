import type { EcosystemConfig } from '@core/types/config';
import { ecosystemEntryKey } from '@core/types/config';
import type { ExecutiveReportOptions, ResidualVerification } from '@core/types/report';
import type { VulnerabilityEntry, ScanResultJson } from '@core/types/scan';
import type { UpdateResultJson } from '@core/types/update';
import { defaultRegistry } from '@modules/ecosystem/index';

import { buildAdvisorExecSection } from './advisor-exec-section';
import type { AdvisorExecSectionData } from './advisor-exec-section';
import type { Locale } from './i18n/index';
import { getLocale } from './i18n/index';
import { buildSonarQubeExecSection } from './sonarqube-exec-section';
import type { SonarQubeExecSectionData } from './sonarqube-exec-section';

// ── deduplication ───────────────────────────────────────────────────────────

type VulnerabilityClass = 'auto_safe' | 'breaking' | 'manual';

type AggregatedVulnEntry = VulnerabilityEntry & {
  affectedVersions: string[];
  instanceCount: number;
  ghsaIds: string[];
};

const CLASS_RANK: Record<VulnerabilityClass, number> = { auto_safe: 0, breaking: 1, manual: 2 };

function dedupVulns(entries: VulnerabilityEntry[]): AggregatedVulnEntry[] {
  const groups = new Map<string, VulnerabilityEntry[]>();
  for (const entry of entries) {
    const key = `${entry.ecosystem}|${entry.package}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const affectedVersions = [...new Set(group.map((v) => v.currentVersion))];

    const maxCvss = group.reduce<string | null>((best, v) => {
      const n = parseFloat(v.cvss);
      const b = best !== null ? parseFloat(best) : NaN;
      if (!isNaN(n) && (isNaN(b) || n > b)) return v.cvss;
      return best;
    }, null);

    const safeVersion = group.find((v) => v.safeVersion !== null && v.safeVersion !== undefined)?.safeVersion ?? null;

    const worstClass = group.reduce<VulnerabilityClass>((worst, v) => {
      return (CLASS_RANK[v.classification] ?? 0) > (CLASS_RANK[worst] ?? 0) ? v.classification : worst;
    }, first.classification);

    const minVersion = affectedVersions.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0] ?? first.currentVersion;

    const ghsaIds = [...new Set(group.map((v) => v.ghsaId ?? '').filter((id) => id !== ''))];

    return {
      ...first,
      currentVersion: minVersion,
      cvss: maxCvss ?? first.cvss,
      safeVersion,
      classification: worstClass,
      affectedVersions,
      instanceCount: group.length,
      ghsaIds,
      ghsaId: ghsaIds.join(', '),
    };
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Escape pipe characters in a string so it renders safely inside a markdown
 * table cell. A literal `|` would break the column boundary, so we replace
 * every occurrence with `\|`.
 */
export function escapeMdTableCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

export function vulnLink(id: string): string {
  if (!id) return '—';
  if (id.startsWith('CVE-')) return id;
  return `[${id}](https://osv.dev/vulnerability/${id})`;
}

function parsePackageName(ref: string): string {
  const at = ref.lastIndexOf('@');
  return at > 0 ? ref.slice(0, at) : ref;
}

function parsePackageVersion(ref: string): string | undefined {
  const at = ref.lastIndexOf('@');
  return at > 0 ? ref.slice(at + 1) : undefined;
}

function uniqueCount(vulns: VulnerabilityEntry[]): number {
  return new Set(vulns.map((v) => v.package)).size;
}

function motivoStr(vuln: VulnerabilityEntry, locale: Locale): string {
  const r = vuln.reason;
  if (!r || r.includes('No safe version') || r.includes('Cannot parse')) {
    return locale.reason.no_safe_version;
  }
  if (r.includes('Major version bump')) {
    const match = r.match(/(\S+)\s*→\s*(\S+)/);
    return match
      ? locale.reason.major_bump(match[2]!)
      : locale.reason.major_bump_generic;
  }
  if (r.includes('Protected package')) {
    const constraintMatch = r.match(/constraint\s+(\S+)/);
    return locale.reason.protected_constraint(constraintMatch?.[1] ?? 'configured constraint');
  }
  return r;
}

function pendingStatus(vuln: VulnerabilityEntry, locale: Locale): string {
  const r = vuln.reason;
  if (!r || r.includes('No safe version') || r.includes('Cannot parse')) return locale.status.no_fix;
  if (r.includes('Major version bump')) return locale.status.needs_auth;
  return locale.status.pending;
}

// ── private context-builder helpers ─────────────────────────────────────────

interface EcoEntry { key: string; entry?: EcosystemConfig; pluginId: string; reportLabel: string; name: string }

/** Resolve the list of ecosystem entries from opts (new per-entry mode or registry fallback). */
function resolveEcoEntries(opts: ExecutiveReportOptions): EcoEntry[] {
  if (opts.ecosystems) {
    return opts.ecosystems.map((entry) => {
      const plugin = defaultRegistry.get(entry.id);
      const entryKey = ecosystemEntryKey(entry);
      const baseLabel = plugin?.reportLabel ?? entry.id;
      const reportLabel = entry.label ? `${baseLabel} (${entry.label})` : baseLabel;
      return {
        key: entryKey,
        entry,
        pluginId: entry.id,
        reportLabel,
        name: plugin?.name ?? entry.id,
      };
    });
  }
  return defaultRegistry.getAll().map((plugin) => ({
    key: plugin.id,
    entry: undefined,
    pluginId: plugin.id,
    reportLabel: plugin.reportLabel,
    name: plugin.name,
  }));
}

interface EcoScanEntry { vulnerabilities_total: number; auto_safe: number; breaking: number; manual: number; auto_safe_packages: string[]; breaking_packages: string[]; manual_packages: string[]; vulnerabilities: VulnerabilityEntry[] }

/** Create an empty ecosystem scan entry for when none exists yet. */
function emptyEcoScanEntry(): EcoScanEntry {
  return { vulnerabilities_total: 0, auto_safe: 0, breaking: 0, manual: 0, auto_safe_packages: [], breaking_packages: [], manual_packages: [], vulnerabilities: [] };
}

/** Append audit findings as synthetic VulnerabilityEntry rows into a cloned eco entry. */
function applyAuditFindingsToEco(
  ecoKey: string,
  findings: NonNullable<NonNullable<ExecutiveReportOptions['updates'][string]>['audit_findings']>,
  existing: EcoScanEntry | undefined,
): EcoScanEntry {
  const cloned: EcoScanEntry = existing ? structuredClone(existing) : emptyEcoScanEntry();
  for (const finding of findings) {
    cloned.vulnerabilities.push({
      ecosystem: ecoKey,
      package: finding.package,
      ghsaId: finding.cve || '',
      cvss: '—',
      risk: finding.title,
      currentVersion: finding.installedVersion ?? finding.affectedVersions,
      safeVersion: null,
      classification: 'auto_safe',
      reason: '',
    });
    cloned.vulnerabilities_total += 1;
    cloned.auto_safe += 1;
  }
  return cloned;
}

/** Inject audit_findings into a cloned scanBefore so downstream filters pick them up. */
function injectAuditFindings(opts: ExecutiveReportOptions, ecoEntries: EcoEntry[]): ScanResultJson {
  let effectiveScanBefore: ScanResultJson = opts.scanBefore;

  for (const eco of ecoEntries) {
    const auditFindings = opts.updates[eco.key]?.audit_findings;
    if (!auditFindings || auditFindings.length === 0) continue;

    if (effectiveScanBefore === opts.scanBefore) {
      effectiveScanBefore = { ...opts.scanBefore, ecosystems: { ...opts.scanBefore.ecosystems } };
    }

    effectiveScanBefore.ecosystems[eco.key] = applyAuditFindingsToEco(
      eco.key,
      auditFindings,
      effectiveScanBefore.ecosystems[eco.key] as EcoScanEntry | undefined,
    );
  }

  return effectiveScanBefore;
}

/** Build a map of entryKey -> Set of updated package names. */
function buildUpdatedNamesByEco(ecoEntries: EcoEntry[], updates: ExecutiveReportOptions['updates']): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const eco of ecoEntries) {
    const updatedPackages = updates[eco.key]?.packages_updated ?? [];
    map.set(eco.key, new Set(updatedPackages.map(parsePackageName)));
  }
  return map;
}

/** Build a map of entryKey -> Map<packageName, actualInstalledVersion>. */
function buildInstalledVersionsByEco(ecoEntries: EcoEntry[], updates: ExecutiveReportOptions['updates']): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>();
  for (const eco of ecoEntries) {
    const updatedPackages = updates[eco.key]?.packages_updated ?? [];
    const versionMap = new Map<string, string>();
    for (const ref of updatedPackages) {
      const name = parsePackageName(ref);
      const version = parsePackageVersion(ref);
      if (version) versionMap.set(name, version);
    }
    map.set(eco.key, versionMap);
  }
  return map;
}

/**
 * Resolve a display label for a vulnerability's ecosystem.
 * 4-fallback chain: ecoEntries -> findByOsvEcosystem -> get -> raw ecosystem id.
 */
function resolveReportLabel(ecoEntries: EcoEntry[], ecosystem: string): string {
  const eco = ecoEntries.find((e) => e.key === ecosystem);
  return eco?.reportLabel
    ?? defaultRegistry.findByOsvEcosystem(ecosystem)?.reportLabel
    ?? defaultRegistry.get(ecosystem)?.reportLabel
    ?? ecosystem;
}

/** Render a list of GHSA/CVE ids as linked markdown or '—' when empty. */
function formatGhsaLinks(ghsaIds: string[]): string {
  return ghsaIds.length > 0 ? ghsaIds.map((id) => vulnLink(id)).join(', ') : '—';
}

/** Resolve residual warning flag for a given ecosystem from the verification state. */
function resolveResidualWarning(residualVerification: ResidualVerification, ecosystem: string): boolean {
  if (residualVerification.status === 'skipped') return false;
  const count = residualVerification.summary[ecosystem] ?? 0;
  return residualVerification.status === 'unverified' && count > 0;
}

/** Resolve the installed version for a package, falling back to safeVersion then '—'. */
function resolveInstalledVersion(
  installedVersionsByEco: Map<string, Map<string, string>>,
  ecosystem: string,
  pkg: string,
  fallback: string | null,
): string {
  return installedVersionsByEco.get(ecosystem)?.get(pkg) ?? fallback ?? '—';
}

/** Map a single AggregatedVulnEntry to a fixed-vuln row object. */
function mapFixedVulnRow(
  v: AggregatedVulnEntry,
  ecoEntries: EcoEntry[],
  residualVerification: ResidualVerification,
  installedVersionsByEco: Map<string, Map<string, string>>,
): Record<string, unknown> {
  return {
    ecoLabel: resolveReportLabel(ecoEntries, v.ecosystem),
    ghsaLink: formatGhsaLinks(v.ghsaIds),
    ghsaId: v.ghsaIds.join(', '),
    cvss: v.cvss,
    package: v.package,
    affectedVersions: escapeMdTableCell(v.affectedVersions.join(', ')),
    safeVersion: resolveInstalledVersion(installedVersionsByEco, v.ecosystem, v.package, v.safeVersion),
    risk: v.risk,
    residualWarning: resolveResidualWarning(residualVerification, v.ecosystem),
  };
}

/** Build the fixedVulns rows array. */
function buildFixedVulnRows(
  allVulnsBefore: VulnerabilityEntry[],
  ecoEntries: EcoEntry[],
  updatedNamesByEco: Map<string, Set<string>>,
  residualVerification: ResidualVerification,
  installedVersionsByEco: Map<string, Map<string, string>>,
): Record<string, unknown>[] {
  return dedupVulns(
    allVulnsBefore.filter((v) => {
      const names = updatedNamesByEco.get(v.ecosystem) ?? new Set();
      return v.classification === 'auto_safe' && names.has(v.package);
    }),
  ).map((v) => mapFixedVulnRow(v, ecoEntries, residualVerification, installedVersionsByEco));
}

/** Map a single AggregatedVulnEntry to a pending-vuln row object. */
function mapPendingVulnRow(v: AggregatedVulnEntry, ecoEntries: EcoEntry[], locale: Locale): Record<string, unknown> {
  const reportLabel = resolveReportLabel(ecoEntries, v.ecosystem);
  return {
    ecoLabel: reportLabel,
    ghsaLink: v.ghsaIds.length > 0 ? v.ghsaIds.map((id) => vulnLink(id)).join(', ') : '—',
    ghsaId: v.ghsaIds.join(', '),
    cvss: v.cvss,
    package: v.package,
    affectedVersions: escapeMdTableCell(v.affectedVersions.join(', ')),
    motivoPt: motivoStr(v, locale),
  };
}

/** Build the pendingVulns rows array. */
function buildPendingVulnRows(
  pendingOriginal: VulnerabilityEntry[],
  ecoEntries: EcoEntry[],
  locale: Locale,
): Record<string, unknown>[] {
  return dedupVulns(pendingOriginal).map((v) => mapPendingVulnRow(v, ecoEntries, locale));
}

/** Map a single AggregatedVulnEntry (reachable === false) to a blocked-vuln row object. */
function mapBlockedVulnRow(
  v: AggregatedVulnEntry,
  ecoEntries: EcoEntry[],
): Record<string, unknown> {
  const reportLabel = resolveReportLabel(ecoEntries, v.ecosystem);
  return {
    ecoLabel: reportLabel,
    ghsaLink: v.ghsaIds.length > 0 ? v.ghsaIds.map((id) => vulnLink(id)).join(', ') : '—',
    ghsaId: v.ghsaIds.join(', '),
    cvss: v.cvss,
    package: v.package,
    affectedVersions: escapeMdTableCell(v.affectedVersions.join(', ')),
    blockReason: v.blockReason ?? 'Dependency constraint',
    blockedBy: v.blockedBy?.join(', ') ?? '—',
  };
}

/** Build the blockedVulns rows array (reachable === false entries). */
function buildBlockedVulnRows(
  allVulnsBefore: VulnerabilityEntry[],
  ecoEntries: EcoEntry[],
): Record<string, unknown>[] {
  return dedupVulns(
    allVulnsBefore.filter((v) => v.reachable === false),
  ).map((v) => mapBlockedVulnRow(v, ecoEntries));
}

/** Returns blocked_status string when v.reachable === false, null otherwise. */
function blockedStatusOrNull(v: VulnerabilityEntry, locale: Locale): string | null {
  if (v.reachable !== false) return null;
  const blockedBy = v.blockedBy?.join(', ') ?? '—';
  return locale.exec.blocked_status(blockedBy);
}

/** Compute the statusPt string for a single vuln row in an evidence section. */
function computeEvidenceStatusPt(
  v: VulnerabilityEntry,
  fixed: boolean,
  isUnverified: boolean,
  residualCount: number | null,
  installedVersions: Map<string, string>,
  locale: Locale,
): string {
  const blocked = blockedStatusOrNull(v, locale);
  if (blocked) return blocked;
  if (!fixed) return pendingStatus(v, locale);
  const fixedVersionLabel = locale.exec.fixed_version(installedVersions.get(v.package) ?? v.safeVersion ?? '—');
  if (isUnverified && residualCount !== null && residualCount > 0) {
    return fixedVersionLabel + ' ⚠ residual CVE unverified — post-update scan detected remaining vulnerabilities';
  }
  return fixedVersionLabel;
}

interface RawVulnAfterRow { ghsaId: string | null; cvss: string; package: string; currentVersion: string; statusPt: string; risk: string }

/** Deduplicate rawVulnsAfter rows by (package, statusPt), merging versions and ghsaIds. */
function deduplicateAfterRows(rawVulnsAfter: RawVulnAfterRow[]): Record<string, unknown>[] {
  const afterGroups = new Map<string, RawVulnAfterRow[]>();
  for (const row of rawVulnsAfter) {
    const key = `${row.package}|${row.statusPt}`;
    const group = afterGroups.get(key) ?? [];
    group.push(row);
    afterGroups.set(key, group);
  }
  return [...afterGroups.values()].map((group) => {
    const first = group[0]!;
    const affectedVersions = escapeMdTableCell([...new Set(group.map((r) => r.currentVersion))].join(', '));
    const groupGhsaIds = [...new Set(group.map((r) => r.ghsaId ?? '').filter((id) => id !== ''))];
    return {
      ghsaId: groupGhsaIds.join(', '),
      cvss: first.cvss,
      package: first.package,
      affectedVersions,
      statusPt: first.statusPt,
      risk: first.risk,
    };
  });
}

/** Build the evidence section for one ecosystem entry. */
function buildEvidenceSection(
  eco: EcoEntry,
  effectiveScanBefore: ScanResultJson,
  update: UpdateResultJson | null,
  updatedNames: Set<string>,
  installedVersions: Map<string, string>,
  residualVerification: ResidualVerification,
  locale: Locale,
): Record<string, unknown> {
  const ecoScan = effectiveScanBefore.ecosystems[eco.key];
  const residualCount = residualVerification.status !== 'skipped'
    ? (residualVerification.summary[eco.key] ?? 0)
    : null;
  const isUnverified = residualVerification.status === 'unverified';

  const rawVulnsAfter: RawVulnAfterRow[] = (ecoScan?.vulnerabilities ?? []).map((v) => {
    const fixed = updatedNames.has(v.package) && v.classification === 'auto_safe';
    const statusPt = computeEvidenceStatusPt(v, fixed, isUnverified, residualCount, installedVersions, locale);
    return {
      ghsaId: v.ghsaId,
      cvss: v.cvss,
      package: v.package,
      currentVersion: v.currentVersion,
      statusPt,
      risk: v.risk,
    };
  });

  const vulnsAfter = deduplicateAfterRows(rawVulnsAfter);
  const hasVulns = vulnsAfter.length > 0;

  const validationEntries = (update?.validations ?? [])
    .filter((v) => v.status === 'pass' && v.detail)
    .map((v) => {
      const detail = v.detail ?? '';
      const verifiedMsg = v.command
        ? `✅ **${v.name}** (\`${v.command}\`) — ${detail}`
        : locale.exec.validation_verified(v.name, detail);
      return { name: v.name, detail, command: v.command, verifiedMsg };
    });
  const showValidations = validationEntries.length > 0;

  return {
    id: eco.key,
    name: eco.name,
    reportLabel: eco.reportLabel,
    evidenceTitle: locale.exec.ecosystem_evidence_title(eco.reportLabel),
    hasVulns,
    vulnsAfter,
    showValidations,
    validationEntries,
  };
}

/** Build per-entry before/after summary labels. */
function buildSummaryLabels(
  ecoEntries: EcoEntry[],
  effectiveScanBefore: ScanResultJson,
  pendingOriginal: VulnerabilityEntry[],
  locale: Locale,
): { ecoBeforeLabels: string; ecoAfterLabels: string } {
  const ecoBeforeLabels = ecoEntries
    .map((eco) => {
      const ecoData = effectiveScanBefore.ecosystems[eco.key];
      const total = ecoData?.vulnerabilities_total ?? 0;
      const pkgCount = uniqueCount(ecoData?.vulnerabilities ?? []);
      return locale.pkg_count(total, pkgCount, eco.reportLabel);
    })
    .join(', ');

  const pendingByEco = new Map<string, VulnerabilityEntry[]>();
  for (const v of pendingOriginal) {
    const arr = pendingByEco.get(v.ecosystem) ?? [];
    arr.push(v);
    pendingByEco.set(v.ecosystem, arr);
  }

  const ecoAfterLabels = ecoEntries
    .map((eco) => {
      const pending = pendingByEco.get(eco.key) ?? [];
      const pkgCount = uniqueCount(pending);
      const pkgAfterNames = pkgCount === 1
        ? [...new Set(pending.map((v) => v.package))].join(', ')
        : undefined;
      return locale.pkg_count(pending.length, pkgCount, eco.reportLabel, pkgAfterNames);
    })
    .join(', ');

  return { ecoBeforeLabels, ecoAfterLabels };
}

// ── ViewModel ─────────────────────────────────────────────────────────────

/**
 * Typed replacement for the untyped `Record<string, unknown>` context
 * previously returned by `buildExecutiveReportContext`. Field-for-field
 * identical keys — the Handlebars templates need no changes.
 *
 * Carries an index signature so it remains a drop-in argument for the
 * Handlebars `render()` seam and for `docx-executive.ts`'s existing
 * `Record<string, unknown>`-typed helpers.
 */
export interface ExecutiveReportViewModel {
  [key: string]: unknown;
  t: Locale['exec'];
  client: string;
  project: string;
  monthFull: string;
  year: number;
  branch: string | null;
  hasBranch: boolean;
  scannerEngines: string | null;
  noVulns: boolean;
  fixedVulns: Record<string, unknown>[];
  blockedVulns: Record<string, unknown>[];
  hasBlockedVulns: boolean;
  pendingVulns: Record<string, unknown>[];
  totalBefore: number;
  scanBeforeSummary: string;
  evidenceSections: Record<string, unknown>[];
  scanAfterSummary: string;
  allFixed: boolean;
  hasPending: boolean;
  sonarSection: SonarQubeExecSectionData;
  advisorSection: AdvisorExecSectionData;
}

// ── context builder ──────────────────────────────────────────────────────────

export function buildExecutiveReportViewModel(opts: ExecutiveReportOptions): ExecutiveReportViewModel {
  const locale = getLocale(opts.locale);
  const now = new Date();

  const ecoEntries = resolveEcoEntries(opts);
  const residualVerification: ResidualVerification = opts.residualVerification ?? { status: 'skipped' };
  const effectiveScanBefore = injectAuditFindings(opts, ecoEntries);

  const updatedNamesByEco = buildUpdatedNamesByEco(ecoEntries, opts.updates);
  const installedVersionsByEco = buildInstalledVersionsByEco(ecoEntries, opts.updates);

  const allVulnsBefore = [
    ...Object.values(effectiveScanBefore.ecosystems).flatMap((e) => e.vulnerabilities),
  ];

  const fixedVulns = buildFixedVulnRows(allVulnsBefore, ecoEntries, updatedNamesByEco, residualVerification, installedVersionsByEco);

  const blockedVulns = buildBlockedVulnRows(allVulnsBefore, ecoEntries);

  const pendingOriginal = allVulnsBefore.filter((v) => {
    if (v.reachable === false) return false;
    if (v.classification !== 'auto_safe') return true;
    const names = updatedNamesByEco.get(v.ecosystem) ?? new Set();
    return !names.has(v.package);
  });

  const pendingVulns = buildPendingVulnRows(pendingOriginal, ecoEntries, locale);

  const evidenceSections = ecoEntries.map((eco) => {
    const update = opts.updates[eco.key] ?? null;
    const updatedNames = updatedNamesByEco.get(eco.key) ?? new Set();
    const installedVersions = installedVersionsByEco.get(eco.key) ?? new Map<string, string>();
    return buildEvidenceSection(eco, effectiveScanBefore, update, updatedNames, installedVersions, residualVerification, locale);
  });

  const { ecoBeforeLabels, ecoAfterLabels } = buildSummaryLabels(ecoEntries, effectiveScanBefore, pendingOriginal, locale);
  const totalBefore = allVulnsBefore.length;

  const sonarSection = buildSonarQubeExecSection(opts.engineResults, locale.exec, opts.sonarqubeMetrics);
  const advisorSection = buildAdvisorExecSection(opts.advisorResults, locale.exec);

  return {
    t: locale.exec,
    client: opts.client,
    project: opts.project,
    monthFull: locale.months[now.getMonth()],
    year: now.getFullYear(),
    branch: opts.branch ?? null,
    hasBranch: typeof opts.branch === 'string' && opts.branch.length > 0,
    scannerEngines: opts.scannerEngines && opts.scannerEngines.length > 0 ? opts.scannerEngines.join(', ') : null,
    noVulns: totalBefore === 0,
    fixedVulns,
    blockedVulns,
    hasBlockedVulns: blockedVulns.length > 0,
    pendingVulns,
    totalBefore,
    scanBeforeSummary: locale.exec.scan_summary(totalBefore, ecoBeforeLabels),
    evidenceSections,
    scanAfterSummary: locale.exec.scan_after_summary_generic(pendingOriginal.length, ecoAfterLabels),
    allFixed: fixedVulns.length > 0 && pendingOriginal.length === 0 && blockedVulns.length === 0,
    hasPending: pendingOriginal.length > 0,
    sonarSection,
    advisorSection,
  };
}

/**
 * Build an executive report view model scoped to a single ecosystem entry.
 *
 * Filters scanBefore.ecosystems to only the target entry's key and filters
 * the updates map to only that entry, then delegates to buildExecutiveReportViewModel
 * with a single-entry ecosystems array.
 */
export function buildEntryReportViewModel(
  opts: ExecutiveReportOptions,
  entryKey: string,
): ExecutiveReportViewModel {
  const entryEcosystems = (opts.ecosystems ?? []).filter(
    (e) => ecosystemEntryKey(e) === entryKey,
  );

  const filteredEcosystems: ScanResultJson['ecosystems'] = {};
  if (opts.scanBefore.ecosystems[entryKey] !== undefined) {
    filteredEcosystems[entryKey] = opts.scanBefore.ecosystems[entryKey]!;
  }
  const filteredScanBefore: ScanResultJson = {
    ...opts.scanBefore,
    ecosystems: filteredEcosystems,
  };

  const filteredScanAfter: ScanResultJson = {
    ...opts.scanAfter,
    ecosystems: opts.scanAfter.ecosystems[entryKey] !== undefined
      ? { [entryKey]: opts.scanAfter.ecosystems[entryKey]! }
      : {},
  };

  const filteredUpdates: Record<string, UpdateResultJson> = {};
  if (opts.updates[entryKey] !== undefined) {
    filteredUpdates[entryKey] = opts.updates[entryKey]!;
  }

  return buildExecutiveReportViewModel({
    ...opts,
    scanBefore: filteredScanBefore,
    scanAfter: filteredScanAfter,
    updates: filteredUpdates,
    ecosystems: entryEcosystems.length > 0 ? entryEcosystems : opts.ecosystems,
  });
}
