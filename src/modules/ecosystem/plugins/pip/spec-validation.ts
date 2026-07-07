import type { CommandRunner } from '@core/types/common';
import { logger } from '@infra/utils/logger';

/**
 * Run pip install --dry-run --quiet to test whether the given specs are installable.
 *
 * Returns:
 *   'pass'        — exit 0; all specs are installable.
 *   'unsupported' — pip does not recognise --dry-run (old pip); skip validation.
 *   'fail'        — specs are not installable in this environment.
 */
async function dryRunCheck(
  runner: CommandRunner,
  cwd: string,
  specs: string[],
): Promise<'pass' | 'fail' | 'unsupported'> {
  try {
    const result = await runner.runArgs('pip', ['install', '--dry-run', '--quiet', ...specs], { cwd });
    if (result.exitCode === 0) return 'pass';
    const stderr = (result.stderr ?? '').toLowerCase();
    if (stderr.includes('no such option') || stderr.includes('unrecognized arguments')) {
      return 'unsupported';
    }
    return 'fail';
  } catch {
    return 'unsupported';
  }
}

/**
 * Try alternative safe versions for a package whose primary spec failed dry-run.
 * Returns the first passing spec string, or null when all alternatives fail.
 */
async function tryFallbackVersions(
  runner: CommandRunner,
  cwd: string,
  pkg: string,
  versions: string[],
  alreadyTried: string,
): Promise<string | null> {
  for (const ver of versions) {
    if (ver === alreadyTried) continue;
    const spec = `${pkg}==${ver}`;
    const check = await dryRunCheck(runner, cwd, [spec]);
    if (check === 'pass') return spec;
  }
  return null;
}

/** Resolve the best installable spec for a single package. Returns null when nothing installs. */
async function resolveSpec(
  runner: CommandRunner,
  cwd: string,
  spec: string,
  sortedSafeVersions: Map<string, string[]>,
): Promise<string | null> {
  const pkgName = spec.split('==')[0] ?? spec;
  const primaryVersion = spec.split('==')[1] ?? '';
  const perResult = await dryRunCheck(runner, cwd, [spec]);
  if (perResult === 'pass') return spec;
  const alternatives = sortedSafeVersions.get(pkgName) ?? [];
  return tryFallbackVersions(runner, cwd, pkgName, alternatives, primaryVersion);
}

/**
 * Find the largest compatible subset of specs using greedy addition.
 *
 * Start with an empty compatible set. For each spec, try adding it to the current
 * compatible set with a batch dry-run. Keep specs that pass, exclude specs that fail.
 */
export async function findCompatibleSubset(
  runner: CommandRunner,
  cwd: string,
  validated: string[],
): Promise<{ compatible: string[]; excluded: string[] }> {
  const compatible: string[] = [];
  const excluded: string[] = [];

  for (const spec of validated) {
    const result = await dryRunCheck(runner, cwd, [...compatible, spec]);
    if (result === 'pass' || result === 'unsupported') {
      compatible.push(spec);
    } else {
      excluded.push(spec);
    }
  }

  return { compatible, excluded };
}

/**
 * Re-batch validated specs to detect cross-package conflicts.
 *
 * If the re-batch dry-run fails, runs greedy subset selection via findCompatibleSubset.
 * Returns the final { validated, skipped } after resolving any cross-conflicts.
 */
async function applyReBatchValidation(
  runner: CommandRunner,
  cwd: string,
  validated: string[],
  skipped: { pkg: string; reason: string }[],
): Promise<{ validated: string[]; skipped: { pkg: string; reason: string }[] }> {
  const reBatchResult = await dryRunCheck(runner, cwd, validated);
  if (reBatchResult !== 'fail') {
    return { validated, skipped };
  }

  logger.warn(`Cross-package conflict detected: re-batch of ${validated.length} validated specs failed. Running greedy subset selection.`);
  const { compatible, excluded } = await findCompatibleSubset(runner, cwd, validated);
  if (compatible.length === 0) {
    // Fallback: let the actual install attempt and report the real error
    return { validated, skipped };
  }
  for (const spec of excluded) {
    const pkgName = spec.split('==')[0] ?? spec;
    skipped.push({ pkg: pkgName, reason: 'Cross-package conflict detected in batch validation' });
  }
  return { validated: compatible, skipped };
}

/**
 * Validate a list of version-pinned pip specs using --dry-run before the actual install.
 *
 * Fast path: batch dry-run. If all pass, return them all as validated.
 * Slow path: per-package dry-run + fallback version tries when batch fails.
 * Cross-conflict check: re-batch validated specs; if re-batch fails use greedy subset.
 * Graceful degradation: if pip does not support --dry-run, return all as validated.
 */
export async function validatePipSpecs(
  runner: CommandRunner,
  cwd: string,
  primarySpecs: string[],
  sortedSafeVersions: Map<string, string[]>,
): Promise<{ validated: string[]; skipped: { pkg: string; reason: string }[] }> {
  const batchResult = await dryRunCheck(runner, cwd, primarySpecs);

  if (batchResult !== 'fail') return { validated: primarySpecs, skipped: [] };

  // Batch failed — validate per-package and try fallback versions
  const validated: string[] = [];
  const skipped: { pkg: string; reason: string }[] = [];

  for (const spec of primarySpecs) {
    const pkgName = spec.split('==')[0] ?? spec;
    const resolved = await resolveSpec(runner, cwd, spec, sortedSafeVersions);
    if (resolved !== null) {
      validated.push(resolved);
    } else {
      const alternatives = sortedSafeVersions.get(pkgName) ?? [];
      skipped.push({ pkg: pkgName, reason: `No installable version found (tried ${spec} and ${alternatives.length} alternative(s))` });
    }
  }

  // Re-batch check: when multiple specs passed per-package validation individually,
  // they might still conflict with each other (cross-package conflict).
  if (validated.length > 1) {
    return applyReBatchValidation(runner, cwd, validated, skipped);
  }

  return { validated, skipped };
}
