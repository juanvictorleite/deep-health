import semver from 'semver';

/**
 * Return the semver-maximum version string from a set, or undefined if the set is empty
 * or contains no valid semver versions. Falls back to an arbitrary element for non-semver
 * sets (rare; non-semver packages are handled by exact-match verification elsewhere).
 */
export function semverMax(versions: Set<string>): string | undefined {
  if (versions.size === 0) return undefined;
  let best: string | undefined;
  for (const v of versions) {
    if (!best) { best = v; continue; }
    const vValid = semver.valid(v);
    const bestValid = semver.valid(best);
    if (vValid && bestValid) {
      if (semver.gt(vValid, bestValid)) best = v;
    } else if (vValid && !bestValid) {
      best = v;
    }
  }
  return best;
}

/**
 * Return true iff `versionAfter` is strictly newer than `versionBefore` by semver,
 * or `packageName` appeared post-fix but not pre-fix (net-new install counts as update).
 *
 * For non-semver strings we require `versionAfter !== versionBefore && versionBefore !== undefined`.
 */
export function isUpgraded(
  versionBefore: string | undefined,
  versionAfter: string | undefined,
): boolean {
  if (!versionAfter) return false;
  // Package appeared post-fix but was absent pre-fix: counts as an upgrade.
  if (!versionBefore) return true;
  if (versionBefore === versionAfter) return false;

  const afterValid = semver.valid(versionAfter);
  const beforeValid = semver.valid(versionBefore);
  if (afterValid && beforeValid) {
    return semver.gt(afterValid, beforeValid);
  }
  // Non-semver: any string change is conservatively rejected (we cannot order them).
  return false;
}
