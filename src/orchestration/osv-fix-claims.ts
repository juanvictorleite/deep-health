import semver from 'semver';

import { logger } from '@infra/utils/logger';

/**
 * A single package upgrade claimed by `osv-scanner fix --format=json`, or
 * verified as actually present in a lockfile after reconciliation.
 */
export interface PackageUpdate {
  name: string;
  versionFrom: string;
  versionTo: string;
}

export interface ClaimReconciliation {
  /** Claims confirmed present (or superseded) in the on-disk version maps. */
  verified: PackageUpdate[];
  /** Claims that could not be attributed to a concrete on-disk upgrade. */
  dropped: PackageUpdate[];
}

function updateFromRaw(u: Record<string, unknown>): PackageUpdate | null {
  const name = String(u['name'] ?? '');
  if (!name) return null;
  return { name, versionFrom: String(u['versionFrom'] ?? ''), versionTo: String(u['versionTo'] ?? '') };
}

function collectPackageUpdates(packageUpdates: unknown, dedupe: Map<string, PackageUpdate>): void {
  if (!Array.isArray(packageUpdates)) return;

  for (const update of packageUpdates) {
    if (!update || typeof update !== 'object') continue;
    const parsed = updateFromRaw(update as Record<string, unknown>);
    if (parsed) dedupe.set(parsed.name, parsed);
  }
}

function collectPatches(patches: unknown[], dedupe: Map<string, PackageUpdate>): void {
  for (const patch of patches) {
    if (!patch || typeof patch !== 'object') continue;
    collectPackageUpdates((patch as Record<string, unknown>)['packageUpdates'], dedupe);
  }
}

/**
 * Parse the JSON output from `osv-scanner fix --format=json`.
 *
 * Accesses top-level patches[].packageUpdates[] and returns a deduplicated
 * (by name, last-wins) list of { name, versionFrom, versionTo }.
 */
export function parseOsvFixJson(stdout: string): PackageUpdate[] {
  try {
    const parsed: unknown = JSON.parse(stdout);

    if (!parsed || typeof parsed !== 'object') return [];

    const patches = (parsed as Record<string, unknown>)['patches'];
    if (!Array.isArray(patches)) return [];

    const dedupe = new Map<string, PackageUpdate>();
    collectPatches(patches, dedupe);

    return Array.from(dedupe.values());
  } catch (err) {
    logger.tagged('osv', 'OSV fix', `Could not parse osv-scanner fix JSON output: ${err}`, 'warn');
    return [];
  }
}

/**
 * Return true iff `versionTo` (or something strictly newer by semver) appears
 * among the versions we found in the lockfile for that package name. Non-semver
 * strings must match exactly — we refuse to speculate.
 */
export function claimIsSatisfiedOnDisk(
  claim: PackageUpdate,
  versionsOnDisk: Set<string> | undefined,
): boolean {
  if (!versionsOnDisk || versionsOnDisk.size === 0) return false;
  if (versionsOnDisk.has(claim.versionTo)) return true;

  const claimedValid = semver.valid(claim.versionTo);
  if (!claimedValid) return false;

  for (const onDisk of versionsOnDisk) {
    const onDiskValid = semver.valid(onDisk);
    if (onDiskValid && semver.gte(onDiskValid, claimedValid)) return true;
  }
  return false;
}

/**
 * Reconcile claimed package updates against the (packageName -> versions) maps
 * collected from a lockfile. A claim is `verified` when `claimIsSatisfiedOnDisk`
 * holds for its name; the reported `versionTo` is then replaced by the root
 * version on disk when one is known (falling back to the claimed value).
 * Everything else is `dropped`.
 */
export function reconcileFixClaims(
  claims: readonly PackageUpdate[],
  versionsOnDisk: Map<string, Set<string>>,
  rootVersionsOnDisk: Map<string, string>,
): ClaimReconciliation {
  const verified: PackageUpdate[] = [];
  const dropped: PackageUpdate[] = [];

  for (const claim of claims) {
    const diskVersions = versionsOnDisk.get(claim.name);
    if (claimIsSatisfiedOnDisk(claim, diskVersions)) {
      const rootVersion = rootVersionsOnDisk.get(claim.name);
      verified.push({ ...claim, versionTo: rootVersion ?? claim.versionTo });
    } else {
      dropped.push(claim);
    }
  }

  return { verified, dropped };
}
