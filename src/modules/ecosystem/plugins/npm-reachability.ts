import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import type { ReachabilityAdapter, ReachabilityCheck } from '@core/policy/reachability';
import { collectNpmLockfileConstraints } from '@modules/ecosystem/utils/lockfile-inspect';

export class NpmReachabilityAdapter implements ReachabilityAdapter {
  readonly ecosystemId = 'npm';

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
        const satisfies = semver.satisfies(safeVersion, constraint, {
          includePrerelease: false,
        });
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
