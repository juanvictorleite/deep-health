import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import semver from 'semver';

import type { ReachabilityAdapter, ReachabilityCheck } from '@core/policy/reachability';
import { collectNpmLockfileConstraints } from '@modules/ecosystem/utils/lockfile-inspect';

/**
 * Parses a package-lock.json string and returns the `packages` record, or null on failure.
 */
function parseNpmLockfilePackages(content: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  const pkgs = root['packages'];
  if (!pkgs || typeof pkgs !== 'object' || Array.isArray(pkgs)) return null;
  return pkgs as Record<string, unknown>;
}

/**
 * Validates a packages-map path key and returns the package name, or null to skip.
 *
 * Skips:
 *   - the root entry (key '')
 *   - keys not starting with 'node_modules/'
 *   - nested entries (e.g. "node_modules/a/node_modules/b")
 */
function extractNpmPkgName(pathKey: string): string | null {
  const prefix = 'node_modules/';
  if (pathKey === '') return null;
  if (!pathKey.startsWith(prefix)) return null;
  const afterFirst = pathKey.slice(prefix.length);
  if (afterFirst.includes('/node_modules/')) return null;
  return afterFirst;
}

/**
 * Reads the `dependencies` field from a packages-map entry and builds a Map.
 * Returns null when the entry has no valid dependencies object.
 */
function extractDepsMap(entry: unknown): Map<string, string> | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const obj = entry as Record<string, unknown>;
  const deps = obj['dependencies'];
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return null;
  const depMap = new Map<string, string>();
  for (const [depName, constraint] of Object.entries(deps as Record<string, unknown>)) {
    if (typeof constraint === 'string') {
      depMap.set(depName, constraint);
    }
  }
  return depMap.size > 0 ? depMap : null;
}

/**
 * Extracts the forward dependencies of each package from a package-lock.json string.
 *
 * Returns Map<pkgName, Map<depName, constraint>>.
 *
 * Supports v2/v3 (packages section). Skips:
 *   - the root entry (key '')
 *   - nested node_modules entries (keys containing /node_modules/ after the first segment)
 *
 * For scoped packages (@scope/name), the full scoped name is used as the key.
 * Returns empty map on parse error.
 */
function collectNpmForwardDeps(lockfileContent: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();

  const pkgs = parseNpmLockfilePackages(lockfileContent);
  if (!pkgs) return out;

  for (const [pathKey, val] of Object.entries(pkgs)) {
    const pkgName = extractNpmPkgName(pathKey);
    if (pkgName === null) continue;
    const depMap = extractDepsMap(val);
    if (depMap !== null) {
      out.set(pkgName, depMap);
    }
  }

  return out;
}

/**
 * Returns the list of parent names that block upgrading `depName` to `safeVersion`.
 */
function buildNpmBlockingParents(
  safeVersion: string,
  parentConstraints: Map<string, string>,
): string[] {
  const blockingParents: string[] = [];
  for (const [parentName, constraint] of parentConstraints) {
    const satisfies = semver.satisfies(safeVersion, constraint, {
      includePrerelease: false,
    });
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
function tryNpmCrossConflict(
  ref: string,
  depName: string,
  safeVersionByName: Map<string, string> | null,
  forwardDeps: Map<string, Map<string, string>> | null,
  deep: boolean,
): ReachabilityCheck | null {
  if (!deep || !safeVersionByName || !forwardDeps) return null;
  const crossConflict = checkNpmCrossConflict(depName, safeVersionByName, forwardDeps);
  return crossConflict ? { ...crossConflict, packageRef: ref } : null;
}

/**
 * Handles per-package reachability logic for a single npm package ref.
 *
 * Checks parent constraints and, when deep mode is active, also checks cross-package conflicts.
 */
function checkSingleNpmPackage(
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
      tryNpmCrossConflict(ref, depName, safeVersionByName, forwardDeps, deep) ?? {
        packageRef: ref,
        reachable: true,
      }
    );
  }

  const blockingParents = buildNpmBlockingParents(safeVersion, parentConstraints);
  if (blockingParents.length > 0) {
    return {
      packageRef: ref,
      reachable: false,
      blockReason: `Parent constraint blocks upgrade to ${safeVersion}: ${blockingParents.join(', ')}`,
      blockedBy: blockingParents,
    };
  }

  return (
    tryNpmCrossConflict(ref, depName, safeVersionByName, forwardDeps, deep) ?? {
      packageRef: ref,
      reachable: true,
    }
  );
}

export class NpmReachabilityAdapter implements ReachabilityAdapter {
  readonly ecosystemId = 'npm';
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

    const raw = await readFile(join(context.cwd, 'package-lock.json'), 'utf-8').catch(
      () => null,
    );
    const lockfileContent = typeof raw === 'string' ? raw : null;
    if (lockfileContent === null) return allReachable();

    const constraints = collectNpmLockfileConstraints(lockfileContent);

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
      forwardDeps = collectNpmForwardDeps(lockfileContent);
    }

    return packages.map((ref) =>
      checkSingleNpmPackage(ref, constraints, safeVersionByName, forwardDeps, this.deep),
    );
  }
}

/**
 * Checks if a package's forward dependencies have safe-version conflicts.
 *
 * For each forward dep of `pkgName` that is ALSO in the auto_safe list,
 * verifies that the dep's safe version satisfies the constraint declared by `pkgName`.
 *
 * Returns a partial ReachabilityCheck (without packageRef) when a conflict is found,
 * or null when no conflict exists.
 */
function checkNpmCrossConflict(
  pkgName: string,
  safeVersionByName: Map<string, string>,
  forwardDeps: Map<string, Map<string, string>>,
): Omit<ReachabilityCheck, 'packageRef'> | null {
  const pkgForwardDeps = forwardDeps.get(pkgName);
  if (!pkgForwardDeps) return null;

  for (const [depName, constraint] of pkgForwardDeps) {
    const depSafeVersion = safeVersionByName.get(depName);
    if (depSafeVersion === undefined) continue;
    const satisfies = semver.satisfies(depSafeVersion, constraint, {
      includePrerelease: false,
    });
    if (!satisfies) {
      return {
        reachable: false,
        blockReason: `Cross-package conflict: ${depName} (requires ${constraint}, safe version is ${depSafeVersion})`,
        blockedBy: [`${depName} (requires ${constraint}, safe version is ${depSafeVersion})`],
      };
    }
  }
  return null;
}
