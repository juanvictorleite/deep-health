import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';

import { CLI_NAME } from '@infra/brand';
import { OsvDockerRunner } from '@infra/provisioner/osv-runner';
import { backupFiles } from '@infra/utils/fs-backup';
import { logger } from '@infra/utils/logger';
import { assertLockfilePathWithinCwd } from '@infra/utils/path-safety';
import { collectNpmLockfileVersions, collectRootNpmLockfileVersions } from '@modules/ecosystem/utils/lockfile-inspect';

import { parseOsvFixJson, reconcileFixClaims, type PackageUpdate } from './osv-fix-claims';

export { parseOsvFixJson } from './osv-fix-claims';

export interface OsvFixApplyInput {
  cwd: string;
  osvConfig?: { image?: string; platform?: string };
  osvFixSpec: {
    fixLockfile: string;            // e.g. 'package-lock.json'
    backupFiles: readonly string[]; // files to stage
  };
  /**
   * When `scan.paths` is configured, the caller may supply an explicit lockfile
   * path (relative to /project) that overrides `osvFixSpec.fixLockfile`.
   * For example: 'app/package-lock.json' instead of 'package-lock.json'.
   * When absent, `osvFixSpec.fixLockfile` is used (default behaviour).
   */
  fixLockfileOverride?: string;
  dryRun: boolean;
}

export interface OsvFixApplyResult {
  /** true iff we wrote a new lockfile to the host (verified upgrades present). */
  applied: boolean;
  /**
   * Packages whose `versionTo` was verified to be present in the host lockfile
   * after the fix was written. Never contains unverifiable claims from osv-scanner.
   */
  packagesUpdated: PackageUpdate[];
  /** Pre-fix snapshot of all osvFixSpec.backupFiles, for downstream rollback */
  backups: Map<string, string>;
  rawFixStdout: string;
  rawFixStderr: string;
}

interface OsvFixRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function emptyFixResult(
  rawFixStdout = '',
  rawFixStderr = '',
  backups: Map<string, string> = new Map(),
): OsvFixApplyResult {
  return { applied: false, packagesUpdated: [], backups, rawFixStdout, rawFixStderr };
}

/**
 * Resolve the lockfile path this run targets and reject anything that would
 * escape the project cwd before any runner is spawned or file is written.
 */
function resolveEffectiveLockfile(input: OsvFixApplyInput): string {
  const { cwd, osvFixSpec, fixLockfileOverride } = input;
  const effectiveFixLockfile = fixLockfileOverride ?? osvFixSpec.fixLockfile;

  assertLockfilePathWithinCwd(effectiveFixLockfile, cwd);

  if (fixLockfileOverride && fixLockfileOverride !== osvFixSpec.fixLockfile) {
    logger.debug(
      `[OSV fix] scan.paths override: using lockfile "${effectiveFixLockfile}" instead of "${osvFixSpec.fixLockfile}"`,
    );
  }

  return effectiveFixLockfile;
}

/**
 * Take pre-fix backups for downstream rollback and copy them into a fresh
 * isolated staging temp dir.
 */
async function stageFixInputs(
  cwd: string,
  filesToBackup: readonly string[],
): Promise<{ backups: Map<string, string>; stagingDir: string }> {
  const backups = await backupFiles(Array.from(filesToBackup), cwd);
  const stagingDir = await mkdtemp(join(os.tmpdir(), `${CLI_NAME}-osv-fix-`));

  for (const file of filesToBackup) {
    if (backups.has(file)) {
      await writeFile(join(stagingDir, file), backups.get(file)!, 'utf-8');
    }
  }

  return { backups, stagingDir };
}

async function runOsvFix(
  stagingDir: string,
  osvConfig: OsvFixApplyInput['osvConfig'],
  effectiveFixLockfile: string,
): Promise<OsvFixRunResult> {
  const runner = new OsvDockerRunner({
    projectDir: stagingDir,
    image: osvConfig?.image,
    platform: osvConfig?.platform,
    readonly: false,
  });

  const result = await runner.run([
    'fix',
    '--strategy=in-place',
    '--format=json',
    '-L',
    effectiveFixLockfile,
  ]);

  logger.tagged('osv', 'OSV fix', `osv-scanner fix exited with code ${result.exitCode}`, 'debug');

  return result;
}

/**
 * The staging dir contains the lockfile at effectiveFixLockfile (which may include
 * a subdirectory prefix, e.g. 'app/package-lock.json'). Use the basename to resolve
 * the staging path because files were copied by filename only.
 */
async function readStagingLockfile(stagingDir: string, effectiveFixLockfile: string): Promise<string> {
  const stagingLockfileName = effectiveFixLockfile.includes('/')
    ? effectiveFixLockfile.split('/').pop()!
    : effectiveFixLockfile;
  return readFile(join(stagingDir, stagingLockfileName), 'utf-8');
}

/**
 * osv-scanner produced no byte-level change to the lockfile. Any claims in JSON
 * are false (this is the lockfileVersion 1 quirk) — drop them so the report
 * does not overclaim.
 */
function logNoLockfileChange(claimedUpdates: PackageUpdate[]): void {
  if (claimedUpdates.length > 0) {
    logger.tagged('osv', 'OSV fix', `osv-scanner reported ${claimedUpdates.length} patch(es) in JSON but the staging lockfile is byte-identical to the host lockfile. This is a known osv-scanner limitation on lockfileVersion 1 (npm 6). Dropping unverifiable claims.`, 'warn');
  } else {
    logger.tagged('osv', 'OSV fix', 'No lockfile changes produced (lockfile already compliant or no patches found)');
  }
}

async function writeVerifiedLockfile(cwd: string, effectiveFixLockfile: string, fixedContent: string): Promise<void> {
  await writeFile(resolve(cwd, effectiveFixLockfile), fixedContent, 'utf-8');
}

/** Propagate package.json to host disk if osv-scanner fix also modified it. */
async function propagateManifestIfChanged(
  cwd: string,
  stagingDir: string,
  backups: Map<string, string>,
): Promise<void> {
  if (!backups.has('package.json')) return;

  try {
    const stagingManifest = await readFile(join(stagingDir, 'package.json'), 'utf-8');
    if (stagingManifest === backups.get('package.json')) {
      logger.tagged('osv', 'OSV fix', 'package.json unchanged in staging', 'debug');
    } else {
      await writeFile(resolve(cwd, 'package.json'), stagingManifest, 'utf-8');
      logger.tagged('osv', 'OSV fix', 'package.json also updated on host disk (manifest range changed by osv-scanner fix)');
    }
  } catch {
    // Staging package.json does not exist — skip silently.
  }
}

function logDroppedClaims(dropped: PackageUpdate[], totalClaims: number): void {
  if (dropped.length === 0) return;
  logger.tagged('osv', 'OSV fix', `${dropped.length} of ${totalClaims} osv-scanner patch(es) could not be verified in the lockfile and were excluded from the report: ` +
      dropped.map((p) => `${p.name}@${p.versionTo}`).join(', '), 'warn');
}

/**
 * Case B: bytes changed — verify each claimed update against the actual
 * staging lockfile contents before propagating to host disk.
 */
async function applyVerifiedLockfileChange(
  input: OsvFixApplyInput,
  effectiveFixLockfile: string,
  stagingDir: string,
  backups: Map<string, string>,
  claimedUpdates: PackageUpdate[],
  fixedContent: string,
  result: OsvFixRunResult,
): Promise<OsvFixApplyResult> {
  const versionsInStaging = collectNpmLockfileVersions(fixedContent);
  const rootVersionsInStaging = collectRootNpmLockfileVersions(fixedContent);

  if (versionsInStaging.size === 0) {
    // Parser could not extract any package versions from the patched lockfile.
    // We refuse to write changes we cannot reason about.
    logger.tagged('osv', 'OSV fix', `Staging lockfile differs from host but could not be parsed; refusing to propagate ${claimedUpdates.length} unverifiable claim(s) to host disk.`, 'warn');
    return emptyFixResult(result.stdout, result.stderr, backups);
  }

  const { verified, dropped } = reconcileFixClaims(claimedUpdates, versionsInStaging, rootVersionsInStaging);

  if (verified.length === 0) {
    // Bytes changed but nothing we can attribute to a concrete upgrade.
    // Refuse to write a change we cannot explain.
    logger.tagged('osv', 'OSV fix', `Staging lockfile differs from host but none of the ${claimedUpdates.length} claimed upgrade(s) were verifiable in its contents. Refusing to write host disk — likely a non-functional normalization from osv-scanner.`, 'warn');
    return emptyFixResult(result.stdout, result.stderr, backups);
  }

  await writeVerifiedLockfile(input.cwd, effectiveFixLockfile, fixedContent);
  await propagateManifestIfChanged(input.cwd, stagingDir, backups);
  logDroppedClaims(dropped, claimedUpdates.length);

  logger.tagged('osv', 'OSV fix', `Applied and verified ${verified.length} package upgrade(s) on host disk`);

  return {
    applied: true,
    packagesUpdated: verified,
    backups,
    rawFixStdout: result.stdout,
    rawFixStderr: result.stderr,
  };
}

async function interpretFixResult(
  input: OsvFixApplyInput,
  effectiveFixLockfile: string,
  stagingDir: string,
  backups: Map<string, string>,
  result: OsvFixRunResult,
): Promise<OsvFixApplyResult> {
  if (result.exitCode !== 0) {
    logger.tagged('osv', 'OSV fix', 'osv-scanner fix exited with non-zero exit code (no changes applied)', 'warn');
    return emptyFixResult(result.stdout, result.stderr, backups);
  }

  const claimedUpdates = parseOsvFixJson(result.stdout);
  const fixedContent = await readStagingLockfile(stagingDir, effectiveFixLockfile);
  const backupContent = backups.get(input.osvFixSpec.fixLockfile) ?? '';
  const bytesChanged = fixedContent !== backupContent;

  if (!bytesChanged) {
    logNoLockfileChange(claimedUpdates);
    return emptyFixResult(result.stdout, result.stderr, backups);
  }

  return applyVerifiedLockfileChange(
    input,
    effectiveFixLockfile,
    stagingDir,
    backups,
    claimedUpdates,
    fixedContent,
    result,
  );
}

/**
 * Apply `osv-scanner fix` using a staging temp directory approach.
 *
 * Instead of bind-mounting the real project directory (unreliable on macOS /Volumes),
 * we copy the relevant files into a temp dir, run osv-scanner fix there, then write
 * the result back to the host via Node.js fs.writeFile.
 *
 * `packagesUpdated` is an intersection of (a) osv-scanner's JSON patch list and
 * (b) what the staging lockfile actually contains. Osv-scanner has been observed
 * to emit patches in its JSON output that never reach the lockfile on disk — most
 * commonly on `lockfileVersion: 1` (npm 6) projects. The verification step below
 * protects reporting from those false claims. Claim interpretation and reconciliation
 * live in `osv-fix-claims.ts`; this module owns staging I/O only.
 */
export async function applyOsvFixViaStaging(
  input: OsvFixApplyInput,
): Promise<OsvFixApplyResult> {
  const effectiveFixLockfile = resolveEffectiveLockfile(input);

  if (input.dryRun) {
    logger.tagged('osv', 'DRY-RUN', 'Would run osv-scanner fix in staging temp dir');
    return emptyFixResult();
  }

  const { backups, stagingDir } = await stageFixInputs(input.cwd, input.osvFixSpec.backupFiles);

  try {
    const result = await runOsvFix(stagingDir, input.osvConfig, effectiveFixLockfile);
    return await interpretFixResult(input, effectiveFixLockfile, stagingDir, backups, result);
  } finally {
    try {
      await rm(stagingDir, { recursive: true, force: true });
    } catch (e) {
      logger.tagged('osv', 'OSV fix', `Failed to clean staging dir: ${e}`, 'warn');
    }
  }
}
