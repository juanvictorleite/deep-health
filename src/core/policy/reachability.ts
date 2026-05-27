import type { EcosystemScanResult, VulnerabilityEntry } from '@core/types/scan';

export interface ReachabilityCheck {
  packageRef: string;
  reachable: boolean;
  blockReason?: string;
  blockedBy?: string[];
}

export interface ReachabilityAdapter {
  ecosystemId: string;
  /**
   * packages is a list of "name@safeVersion" refs — the upgrade targets to check.
   * The adapter checks whether any parent constraint blocks upgrading to that version.
   */
  checkReachability(
    packages: string[],
    context: { cwd: string },
  ): Promise<ReachabilityCheck[]>;
}

function buildCheckByCurrentRef(
  currentRefToSafeRef: Map<string, string>,
  checks: ReachabilityCheck[],
): Map<string, ReachabilityCheck> {
  const checkBySafeRef = new Map<string, ReachabilityCheck>();
  for (const check of checks) {
    checkBySafeRef.set(check.packageRef, check);
  }

  const checkByCurrentRef = new Map<string, ReachabilityCheck>();
  for (const [currentRef, safeRef] of currentRefToSafeRef) {
    const check = checkBySafeRef.get(safeRef);
    if (check) {
      checkByCurrentRef.set(currentRef, check);
    }
  }
  return checkByCurrentRef;
}

function annotateVulnerabilities(
  vulns: VulnerabilityEntry[],
  checkByCurrentRef: Map<string, ReachabilityCheck>,
): VulnerabilityEntry[] {
  return vulns.map((v) => {
    const currentRef = `${v.package}@${v.currentVersion}`;
    const check = checkByCurrentRef.get(currentRef);
    if (!check) return v;
    if (!check.reachable) {
      return {
        ...v,
        reachable: false,
        blockReason: check.blockReason,
        blockedBy: check.blockedBy,
      };
    }
    return { ...v, reachable: true };
  });
}

function applyBlockedToResult(
  ecosystem: EcosystemScanResult,
  checkByCurrentRef: Map<string, ReachabilityCheck>,
): EcosystemScanResult {
  const blockedCurrentRefs = new Set<string>();
  for (const [currentRef, check] of checkByCurrentRef) {
    if (!check.reachable) {
      blockedCurrentRefs.add(currentRef);
    }
  }

  const cloned = structuredClone(ecosystem);
  cloned.auto_safe_packages = cloned.auto_safe_packages.filter(
    (ref) => !blockedCurrentRefs.has(ref),
  );
  cloned.auto_safe = cloned.auto_safe_packages.length;
  cloned.blocked_packages = [...(cloned.blocked_packages ?? []), ...blockedCurrentRefs];
  cloned.blocked = cloned.blocked_packages.length;
  cloned.vulnerabilities = annotateVulnerabilities(cloned.vulnerabilities, checkByCurrentRef);
  return cloned;
}

function buildSafeRefs(
  ecosystem: EcosystemScanResult,
): { safeRefs: string[]; currentRefToSafeRef: Map<string, string> } {
  const pkgSafeVersions = new Map<string, string>();
  for (const v of ecosystem.vulnerabilities) {
    if (v.classification === 'auto_safe' && v.safeVersion) {
      pkgSafeVersions.set(v.package, v.safeVersion);
    }
  }

  const currentRefToSafeRef = new Map<string, string>();
  const safeRefs: string[] = [];
  for (const currentRef of ecosystem.auto_safe_packages) {
    const atIdx = currentRef.lastIndexOf('@');
    const pkgName = atIdx > 0 ? currentRef.slice(0, atIdx) : currentRef;
    const safeVersion = pkgSafeVersions.get(pkgName);
    const safeRef = safeVersion ? `${pkgName}@${safeVersion}` : currentRef;
    currentRefToSafeRef.set(currentRef, safeRef);
    safeRefs.push(safeRef);
  }

  return { safeRefs, currentRefToSafeRef };
}

export async function enrichWithReachability(
  ecosystems: Record<string, EcosystemScanResult>,
  adapters: Map<string, ReachabilityAdapter>,
  cwd: string,
): Promise<Record<string, EcosystemScanResult>> {
  const result: Record<string, EcosystemScanResult> = {};

  for (const [key, ecosystem] of Object.entries(ecosystems)) {
    const ecosystemId = key.includes(':') ? key.split(':')[0]! : key;
    const adapter = adapters.get(ecosystemId);

    if (!adapter || ecosystem.auto_safe_packages.length === 0) {
      result[key] = structuredClone(ecosystem);
      continue;
    }

    const { safeRefs, currentRefToSafeRef } = buildSafeRefs(ecosystem);
    const checks = await adapter.checkReachability(safeRefs, { cwd });
    const checkByCurrentRef = buildCheckByCurrentRef(currentRefToSafeRef, checks);
    result[key] = applyBlockedToResult(ecosystem, checkByCurrentRef);
  }

  return result;
}
