import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import semver from 'semver';

import type { ReachabilityAdapter, ReachabilityCheck } from '@core/policy/reachability';
import { collectComposerLockfileConstraints } from '@modules/ecosystem/utils/lockfile-inspect';

/**
 * Normalizes a Composer constraint string into a semver-compatible range string.
 *
 * Transformations applied:
 *   - Commas → spaces  (Composer AND operator → semver range)
 *   - Single pipe      → ||  (Composer OR operator → semver OR)
 *   - v prefix stripped from version-like tokens (v1.2.3 → 1.2.3)
 */
export function normalizeComposerConstraint(constraint: string): string {
  // Replace single pipes that are not already double-pipes with ||
  // Use a negative lookahead/lookbehind approach: replace `|` not adjacent to another `|`
  let normalized = constraint.replace(/(?<!\|)\|(?!\|)/g, '||');

  // Replace commas (Composer AND) with spaces (semver range AND)
  normalized = normalized.replace(/,/g, ' ');

  // Strip 'v' prefix from version tokens: match v followed by digits
  // e.g. v1.2.3 → 1.2.3, >=v1.0 → >=1.0
  normalized = normalized.replace(/\bv(\d)/g, '$1');

  return normalized;
}

/** Returns true for php, ext-*, and lib-* platform requirements. */
function isComposerPlatformReq(name: string): boolean {
  return name === 'php' || name.startsWith('ext-') || name.startsWith('lib-');
}

/**
 * Parses a composer.lock string and returns the root record, or null on failure.
 */
function parseComposerLockfileRoot(content: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * Validates a raw array entry as a composer package object.
 * Returns [pkgName, requireRecord] or null when invalid.
 */
function readComposerEntryFields(
  entry: unknown,
): [string, Record<string, unknown>] | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const pkg = entry as Record<string, unknown>;
  const pkgName = pkg['name'];
  if (typeof pkgName !== 'string' || !pkgName) return null;
  const require = pkg['require'];
  if (!require || typeof require !== 'object' || Array.isArray(require)) return null;
  return [pkgName, require as Record<string, unknown>];
}

/**
 * Extracts the name and dependency map from a single composer.lock package entry.
 *
 * Filters out platform requirements (php, ext-*, lib-*).
 * Returns [pkgName, depMap] tuple, or null when the entry is invalid or has no deps.
 */
function extractComposerPkgDeps(entry: unknown): [string, Map<string, string>] | null {
  const fields = readComposerEntryFields(entry);
  if (!fields) return null;
  const [pkgName, requireRecord] = fields;

  const depMap = new Map<string, string>();
  for (const [depName, constraint] of Object.entries(requireRecord)) {
    if (isComposerPlatformReq(depName)) continue;
    if (typeof constraint === 'string') {
      depMap.set(depName, constraint);
    }
  }
  return depMap.size > 0 ? [pkgName, depMap] : null;
}

/**
 * Extracts the forward dependencies of each package from a composer.lock string.
 *
 * Scans both `packages` and `packages-dev` arrays.
 * Filters out php, ext-*, and lib-* platform requirements.
 *
 * Returns Map<pkgName, Map<depName, rawConstraint>>.
 * Returns empty map on parse error.
 */
function collectComposerForwardDeps(lockfileContent: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();

  const root = parseComposerLockfileRoot(lockfileContent);
  if (!root) return out;

  const processArray = (arr: unknown): void => {
    if (!Array.isArray(arr)) return;
    for (const entry of arr) {
      const result = extractComposerPkgDeps(entry);
      if (result !== null) {
        const [pkgName, depMap] = result;
        out.set(pkgName, depMap);
      }
    }
  };

  processArray(root['packages']);
  processArray(root['packages-dev']);

  return out;
}

/**
 * Returns the list of parent names that block upgrading `depName` to `safeVersion`.
 */
function buildComposerBlockingParents(
  safeVersion: string,
  parentConstraints: Map<string, string>,
): string[] {
  const blockingParents: string[] = [];
  for (const [parentName, constraint] of parentConstraints) {
    const normalizedConstraint = normalizeComposerConstraint(constraint);
    const satisfies = semver.satisfies(safeVersion, normalizedConstraint, { loose: true });
    if (!satisfies) {
      blockingParents.push(`${parentName} (${constraint})`);
    }
  }
  return blockingParents;
}

/**
 * Runs the cross-conflict check when deep mode is active.
 * Returns a blocked ReachabilityCheck or null when there is no conflict.
 */
function tryComposerCrossConflict(
  ref: string,
  depName: string,
  safeVersionByName: Map<string, string> | null,
  forwardDeps: Map<string, Map<string, string>> | null,
  deep: boolean,
): ReachabilityCheck | null {
  if (!deep || !safeVersionByName || !forwardDeps) return null;
  const crossConflict = checkComposerCrossConflict(depName, safeVersionByName, forwardDeps);
  return crossConflict ? { ...crossConflict, packageRef: ref } : null;
}

/**
 * Handles per-package reachability logic for a single composer package ref.
 *
 * Checks parent constraints and, when deep mode is active, also checks cross-package conflicts.
 */
function checkSingleComposerPackage(
  ref: string,
  constraints: Map<string, Map<string, string>>,
  safeVersionByName: Map<string, string> | null,
  forwardDeps: Map<string, Map<string, string>> | null,
  deep: boolean,
): ReachabilityCheck {
  const atIdx = ref.lastIndexOf('@', ref.length - 1);
  if (atIdx <= 0) return { packageRef: ref, reachable: true };

  const depName = ref.slice(0, atIdx);
  const safeVersion = ref.slice(atIdx + 1);

  const parentConstraints = constraints.get(depName);
  if (!parentConstraints || parentConstraints.size === 0) {
    return (
      tryComposerCrossConflict(ref, depName, safeVersionByName, forwardDeps, deep) ?? {
        packageRef: ref,
        reachable: true,
      }
    );
  }

  const blockingParents = buildComposerBlockingParents(safeVersion, parentConstraints);
  if (blockingParents.length > 0) {
    return {
      packageRef: ref,
      reachable: false,
      blockReason: `Parent constraint blocks upgrade to ${safeVersion}: ${blockingParents.join(', ')}`,
      blockedBy: blockingParents,
    };
  }

  return (
    tryComposerCrossConflict(ref, depName, safeVersionByName, forwardDeps, deep) ?? {
      packageRef: ref,
      reachable: true,
    }
  );
}

export class ComposerReachabilityAdapter implements ReachabilityAdapter {
  readonly ecosystemId = 'composer';
  private readonly deep: boolean;

  constructor(options?: { deep?: boolean }) {
    this.deep = options?.deep === true;
  }

  async checkReachability(
    packages: string[],
    context: { cwd: string },
  ): Promise<ReachabilityCheck[]> {
    const allReachable = (): ReachabilityCheck[] =>
      packages.map((ref) => ({ packageRef: ref, reachable: true }));

    const raw = await readFile(join(context.cwd, 'composer.lock'), 'utf-8').catch(
      () => null,
    );
    const lockfileContent = typeof raw === 'string' ? raw : null;
    if (lockfileContent === null) return allReachable();

    const constraints = collectComposerLockfileConstraints(lockfileContent);

    // Build safeVersionByName for cross-conflict checking (deep mode only)
    let safeVersionByName: Map<string, string> | null = null;
    let forwardDeps: Map<string, Map<string, string>> | null = null;
    if (this.deep) {
      safeVersionByName = new Map<string, string>();
      for (const ref of packages) {
        const atIdx = ref.lastIndexOf('@', ref.length - 1);
        if (atIdx <= 0) continue;
        const name = ref.slice(0, atIdx);
        const version = ref.slice(atIdx + 1);
        safeVersionByName.set(name, version);
      }
      forwardDeps = collectComposerForwardDeps(lockfileContent);
    }

    return packages.map((ref) =>
      checkSingleComposerPackage(ref, constraints, safeVersionByName, forwardDeps, this.deep),
    );
  }
}

/**
 * Checks if a package's forward dependencies have safe-version conflicts.
 *
 * For each forward dep of `pkgName` that is ALSO in the auto_safe list,
 * verifies that the dep's safe version satisfies the constraint declared by `pkgName`
 * (using Composer constraint normalization + semver loose mode).
 *
 * Returns a partial ReachabilityCheck (without packageRef) when a conflict is found,
 * or null when no conflict exists.
 */
function checkComposerCrossConflict(
  pkgName: string,
  safeVersionByName: Map<string, string>,
  forwardDeps: Map<string, Map<string, string>>,
): Omit<ReachabilityCheck, 'packageRef'> | null {
  const pkgForwardDeps = forwardDeps.get(pkgName);
  if (!pkgForwardDeps) return null;

  for (const [depName, rawConstraint] of pkgForwardDeps) {
    const depSafeVersion = safeVersionByName.get(depName);
    if (depSafeVersion === undefined) continue;
    const normalizedConstraint = normalizeComposerConstraint(rawConstraint);
    const satisfies = semver.satisfies(depSafeVersion, normalizedConstraint, { loose: true });
    if (!satisfies) {
      return {
        reachable: false,
        blockReason: `Cross-package conflict: ${depName} (requires ${rawConstraint}, safe version is ${depSafeVersion})`,
        blockedBy: [`${depName} (requires ${rawConstraint}, safe version is ${depSafeVersion})`],
      };
    }
  }
  return null;
}
