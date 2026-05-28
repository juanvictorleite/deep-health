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

export class ComposerReachabilityAdapter implements ReachabilityAdapter {
  readonly ecosystemId = 'composer';

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

    return packages.map((ref): ReachabilityCheck => {
      const atIdx = ref.lastIndexOf('@', ref.length - 1);
      if (atIdx <= 0) return { packageRef: ref, reachable: true };

      const depName = ref.slice(0, atIdx);
      const safeVersion = ref.slice(atIdx + 1);

      const parentConstraints = constraints.get(depName);
      if (!parentConstraints || parentConstraints.size === 0) {
        return { packageRef: ref, reachable: true };
      }

      const blockingParents: string[] = [];
      for (const [parentName, constraint] of parentConstraints) {
        const normalizedConstraint = normalizeComposerConstraint(constraint);
        const satisfies = semver.satisfies(safeVersion, normalizedConstraint, { loose: true });
        if (!satisfies) {
          blockingParents.push(`${parentName} (${constraint})`);
        }
      }

      if (blockingParents.length === 0) {
        return { packageRef: ref, reachable: true };
      }

      return {
        packageRef: ref,
        reachable: false,
        blockReason: `Parent constraint blocks upgrade to ${safeVersion}: ${blockingParents.join(', ')}`,
        blockedBy: blockingParents,
      };
    });
  }
}
