import type { ExecutiveReportOptions, ResidualVerification } from '@core/types/report';
import type { VulnerabilityEntry, ScanResultJson } from '@core/types/scan';
import type { UpdateResultJson } from '@core/types/update';
import type { EcosystemConfig } from '@core/types/config';
import { ecosystemEntryKey } from '@core/types/config';
import type { Locale } from './i18n/index';
import { defaultRegistry } from '@modules/ecosystem/index';
import { getLocale } from './i18n/index';
import { render } from './renderer';
import executiveTemplate from './templates/executive.hbs';
import { buildSonarQubeExecSection } from './sonarqube-exec-section';
import { buildAdvisorExecSection } from './advisor-exec-section';

// ── deduplication ───────────────────────────────────────────────────────────

type VulnerabilityClass = 'auto_safe' | 'breaking' | 'manual';

type AggregatedVulnEntry = VulnerabilityEntry & {
  affectedVersions: string[];
  instanceCount: number;
};

const CLASS_RANK: Record<VulnerabilityClass, number> = { auto_safe: 0, breaking: 1, manual: 2 };

function dedupVulns(entries: VulnerabilityEntry[]): AggregatedVulnEntry[] {
  const groups = new Map<string, VulnerabilityEntry[]>();
  for (const entry of entries) {
    const key = `${entry.ecosystem}|${entry.ghsaId ?? 'no-ghsa'}|${entry.package}`;
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

    const safeVersion = group.find((v) => v.safeVersion != null)?.safeVersion ?? null;

    const worstClass = group.reduce<VulnerabilityClass>((worst, v) => {
      return (CLASS_RANK[v.classification] ?? 0) > (CLASS_RANK[worst] ?? 0) ? v.classification : worst;
    }, first.classification);

    const minVersion = affectedVersions.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0] ?? first.currentVersion;

    return {
      ...first,
      currentVersion: minVersion,
      cvss: maxCvss ?? first.cvss,
      safeVersion,
      classification: worstClass,
      affectedVersions,
      instanceCount: group.length,
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

function monthName(date: Date): string {
  return date.toLocaleString('en-US', { month: 'long' });
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

// ── context builder ──────────────────────────────────────────────────────────

export function buildExecutiveReportContext(opts: ExecutiveReportOptions): Record<string, unknown> {
  const locale = getLocale(opts.locale);
  const now = new Date();

  // Resolve the list of ecosystem entries to iterate.
  // When opts.ecosystems is provided (new per-entry mode), use it directly.
  // Otherwise fall back to defaultRegistry.getAll() for backward compatibility.
  const ecoEntries: Array<{ key: string; entry?: EcosystemConfig; pluginId: string; reportLabel: string; name: string }> =
    opts.ecosystems
      ? opts.ecosystems.map((entry) => {
          const plugin = defaultRegistry.get(entry.id);
          const entryKey = ecosystemEntryKey(entry);
          const baseLabel = plugin?.reportLabel ?? entry.id;
          // When entry has a label, show 'npm (frontend)'; otherwise show plugin's reportLabel.
          const reportLabel = entry.label ? `${baseLabel} (${entry.label})` : baseLabel;
          return {
            key: entryKey,
            entry,
            pluginId: entry.id,
            reportLabel,
            name: plugin?.name ?? entry.id,
          };
        })
      : defaultRegistry.getAll().map((plugin) => ({
          key: plugin.id,
          entry: undefined,
          pluginId: plugin.id,
          reportLabel: plugin.reportLabel,
          name: plugin.name,
        }));

  // Resolve residual verification state — use the explicit union type.
  const residualVerification: ResidualVerification = opts.residualVerification ?? { status: 'skipped' };

  // Clone the top-level scanBefore so we never mutate the original. For each entry
  // that carries audit_findings, deep-clone its ecosystem entry and push synthetic
  // entries so the existing fixedVulns/pendingVulns filters naturally include them.
  let effectiveScanBefore: ScanResultJson = opts.scanBefore;

  for (const eco of ecoEntries) {
    const auditFindings = opts.updates[eco.key]?.audit_findings;
    if (!auditFindings || auditFindings.length === 0) continue;

    // Clone the top-level object (shallow) plus the ecosystems map on first mutation.
    if (effectiveScanBefore === opts.scanBefore) {
      effectiveScanBefore = { ...opts.scanBefore, ecosystems: { ...opts.scanBefore.ecosystems } };
    }

    // Deep-clone the specific ecosystem entry we need to mutate.
    const existingEco = effectiveScanBefore.ecosystems[eco.key];
    const clonedEco = existingEco
      ? structuredClone(existingEco)
      : { vulnerabilities_total: 0, auto_safe: 0, breaking: 0, manual: 0, auto_safe_packages: [], breaking_packages: [], manual_packages: [], vulnerabilities: [] };

    for (const finding of auditFindings) {
      const syntheticEntry: VulnerabilityEntry = {
        ecosystem: eco.key,
        package: finding.package,
        ghsaId: finding.cve || '',
        cvss: '—',
        risk: finding.title,
        currentVersion: finding.installedVersion ?? finding.affectedVersions,
        safeVersion: null,
        classification: 'auto_safe',
        reason: '',
      };
      clonedEco.vulnerabilities.push(syntheticEntry);
      clonedEco.vulnerabilities_total += 1;
      clonedEco.auto_safe += 1;
    }

    effectiveScanBefore.ecosystems[eco.key] = clonedEco;
  }

  // Map: entryKey -> Set of updated package names
  const updatedNamesByEco = new Map<string, Set<string>>();
  for (const eco of ecoEntries) {
    const update = opts.updates[eco.key] ?? null;
    const updatedPackages = update?.packages_updated ?? [];
    updatedNamesByEco.set(eco.key, new Set(updatedPackages.map(parsePackageName)));
  }

  // Map: entryKey -> Map<packageName, actualInstalledVersion>
  const installedVersionsByEco = new Map<string, Map<string, string>>();
  for (const eco of ecoEntries) {
    const updatedPackages = opts.updates[eco.key]?.packages_updated ?? [];
    const versionMap = new Map<string, string>();
    for (const ref of updatedPackages) {
      const name = parsePackageName(ref);
      const version = parsePackageVersion(ref);
      if (version) versionMap.set(name, version);
    }
    installedVersionsByEco.set(eco.key, versionMap);
  }

  const allVulnsBefore = [
    ...Object.values(effectiveScanBefore.ecosystems).flatMap((e) => e.vulnerabilities),
  ];

  // Fixed vulns: auto_safe and in the updated set for their ecosystem
  const fixedVulns = dedupVulns(
    allVulnsBefore.filter((v) => {
      const names = updatedNamesByEco.get(v.ecosystem) ?? new Set();
      return v.classification === 'auto_safe' && names.has(v.package);
    }),
  ).map((v) => {
    // Look up reportLabel — prefer from ecoEntries map, fall back to registry
    const eco = ecoEntries.find((e) => e.key === v.ecosystem);
    const reportLabel = eco?.reportLabel
      ?? defaultRegistry.findByOsvEcosystem(v.ecosystem)?.reportLabel
      ?? defaultRegistry.get(v.ecosystem)?.reportLabel
      ?? v.ecosystem;
    // Render residual warning distinctly: only when verification ran and CVEs remain
    const residualCount = residualVerification.status !== 'skipped'
      ? (residualVerification.summary[v.ecosystem] ?? 0)
      : null;
    const residualWarning = residualVerification.status === 'unverified' && residualCount !== null && residualCount > 0;
    return {
      ecoLabel: reportLabel,
      ghsaLink: vulnLink(v.ghsaId),
      ghsaId: v.ghsaId,
      cvss: v.cvss,
      package: v.package,
      affectedVersions: escapeMdTableCell(v.affectedVersions.join(', ')),
      safeVersion: installedVersionsByEco.get(v.ecosystem)?.get(v.package) ?? v.safeVersion ?? '—',
      risk: v.risk,
      residualWarning,
    };
  });

  const pendingOriginal = allVulnsBefore.filter((v) => {
    if (v.classification !== 'auto_safe') return true;
    const names = updatedNamesByEco.get(v.ecosystem) ?? new Set();
    return !names.has(v.package);
  });

  const pendingVulns = dedupVulns(pendingOriginal).map((v) => {
    const eco = ecoEntries.find((e) => e.key === v.ecosystem);
    const reportLabel = eco?.reportLabel
      ?? defaultRegistry.findByOsvEcosystem(v.ecosystem)?.reportLabel
      ?? defaultRegistry.get(v.ecosystem)?.reportLabel
      ?? v.ecosystem;
    return {
      ecoLabel: reportLabel,
      ghsaLink: vulnLink(v.ghsaId),
      ghsaId: v.ghsaId,
      cvss: v.cvss,
      package: v.package,
      affectedVersions: escapeMdTableCell(v.affectedVersions.join(', ')),
      motivoPt: motivoStr(v, locale),
    };
  });

  // Per-entry evidence sections
  const evidenceSections = ecoEntries.map((eco) => {
    const ecoScan = effectiveScanBefore.ecosystems[eco.key];
    const update = opts.updates[eco.key] ?? null;
    const updatedNames = updatedNamesByEco.get(eco.key) ?? new Set();

    const installedVersions = installedVersionsByEco.get(eco.key) ?? new Map<string, string>();
    // Use the explicit verification state: only show residual warning when 'unverified'
    const residualCount = residualVerification.status !== 'skipped'
      ? (residualVerification.summary[eco.key] ?? 0)
      : null;
    const isUnverified = residualVerification.status === 'unverified';
    const rawVulnsAfter = (ecoScan?.vulnerabilities ?? []).map((v) => {
      const fixed = updatedNames.has(v.package) && v.classification === 'auto_safe';
      let statusPt: string;
      if (fixed) {
        const fixedVersionLabel = locale.exec.fixed_version(installedVersions.get(v.package) ?? v.safeVersion ?? '—');
        statusPt = (isUnverified && residualCount !== null && residualCount > 0)
          ? fixedVersionLabel + ' ⚠ residual CVE unverified — post-update scan detected remaining vulnerabilities'
          : fixedVersionLabel;
      } else {
        statusPt = pendingStatus(v, locale);
      }
      return {
        ghsaId: v.ghsaId,
        cvss: v.cvss,
        package: v.package,
        currentVersion: v.currentVersion,
        statusPt,
        risk: v.risk,
      };
    });
    // Deduplicate by (ghsaId, package, statusPt) — keep separate rows when status differs
    const afterGroups = new Map<string, typeof rawVulnsAfter>();
    for (const row of rawVulnsAfter) {
      const key = `${row.ghsaId ?? 'no-ghsa'}|${row.package}|${row.statusPt}`;
      const group = afterGroups.get(key) ?? [];
      group.push(row);
      afterGroups.set(key, group);
    }
    const vulnsAfter = [...afterGroups.values()].map((group) => {
      const first = group[0]!;
      const affectedVersions = escapeMdTableCell([...new Set(group.map((r) => r.currentVersion))].join(', '));
      return {
        ghsaId: first.ghsaId,
        cvss: first.cvss,
        package: first.package,
        affectedVersions,
        statusPt: first.statusPt,
        risk: first.risk,
      };
    });

    const hasVulns = vulnsAfter.length > 0;

    // Render all validations generically — no fixed names assumed
    const validationEntries = (update?.validations ?? [])
      .filter((v) => v.status === 'pass' && v.detail)
      .map((v) => ({
        name: v.name,
        detail: v.detail ?? '',
        verifiedMsg: locale.exec.validation_verified(v.name, v.detail ?? ''),
      }));
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
  });

  // Summary: per-entry before/after labels
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

  const totalBefore = allVulnsBefore.length;

  // pendingByPkg for Summary section
  const pendingByPkgMap = new Map<string, VulnerabilityEntry[]>();
  for (const v of pendingOriginal) {
    const key = `${v.ecosystem}:${v.package}`;
    const arr = pendingByPkgMap.get(key) ?? [];
    arr.push(v);
    pendingByPkgMap.set(key, arr);
  }
  const pendingByPkg = [...pendingByPkgMap.values()].map((vulns) => {
    const v = vulns[0]!;
    const maxCvss = vulns.reduce((max, x) => {
      const n = parseFloat(x.cvss);
      const m = parseFloat(max);
      return !isNaN(n) && n > (isNaN(m) ? 0 : m) ? x.cvss : max;
    }, '0');
    return {
      package: v.package,
      currentVersion: v.currentVersion,
      motivoPt: motivoStr(v, locale),
      riskLabel: 'Risk',
      risk: v.risk,
      cvssDisplay: maxCvss !== '0' ? ` CVSS ${maxCvss}` : '',
    };
  });

  // Build SonarQube section (graceful: absent when engineResults not provided)
  const sonarSection = buildSonarQubeExecSection(opts.engineResults, locale.exec);

  // Build advisor section (graceful: absent when advisorResults not provided)
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
    pendingVulns,
    allVulnsBefore: dedupVulns(allVulnsBefore).map((v) => {
      const eco = ecoEntries.find((e) => e.key === v.ecosystem);
      const reportLabel = eco?.reportLabel
        ?? defaultRegistry.findByOsvEcosystem(v.ecosystem)?.reportLabel
        ?? defaultRegistry.get(v.ecosystem)?.reportLabel
        ?? v.ecosystem;
      return {
        ecoLabel: reportLabel,
        ghsaId: v.ghsaId,
        cvss: v.cvss,
        package: v.package,
        affectedVersions: escapeMdTableCell(v.affectedVersions.join(', ')),
        risk: v.risk,
      };
    }),
    totalBefore,
    scanBeforeSummary: locale.exec.scan_summary(totalBefore, ecoBeforeLabels),
    evidenceSections,
    scanAfterSummary: locale.exec.scan_after_summary_generic(pendingOriginal.length, ecoAfterLabels),
    allFixed: fixedVulns.length > 0 && pendingOriginal.length === 0,
    pendingByPkg,
    sonarSection,
    advisorSection,
  };
}

export function generateExecutiveReport(opts: ExecutiveReportOptions): string {
  const context = buildExecutiveReportContext(opts);
  return render(executiveTemplate, context);
}

export function executiveReportFilename(client: string, project: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `[${client} ${project}] Security Report - ${year}-${month} - ${monthName(now)}.md`;
}

/**
 * Generate an executive report scoped to a single ecosystem entry.
 * Convenience wrapper around buildEntryReportContext + render.
 */
export function generateEntryReport(opts: ExecutiveReportOptions, entryKey: string): string {
  const context = buildEntryReportContext(opts, entryKey);
  return render(executiveTemplate, context);
}

/**
 * Build an executive report context scoped to a single ecosystem entry.
 *
 * Filters scanBefore.ecosystems to only the target entry's key and filters
 * the updates map to only that entry, then delegates to buildExecutiveReportContext
 * with a single-entry ecosystems array.
 */
export function buildEntryReportContext(
  opts: ExecutiveReportOptions,
  entryKey: string,
): Record<string, unknown> {
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

  return buildExecutiveReportContext({
    ...opts,
    scanBefore: filteredScanBefore,
    scanAfter: filteredScanAfter,
    updates: filteredUpdates,
    ecosystems: entryEcosystems.length > 0 ? entryEcosystems : opts.ecosystems,
  });
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
