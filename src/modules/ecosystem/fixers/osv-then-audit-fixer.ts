import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CommandRunner } from '@core/types/common';
import { emptyEcosystem } from '@core/types/scan';
import { logger } from '@infra/utils/logger';
import { collectNpmLockfileVersions, collectRootNpmLockfileVersions } from '@modules/ecosystem/utils/lockfile-inspect';
import { revertWithBootstrap, type BootstrapSpec } from '@modules/ecosystem/utils/updater-transaction';

import { isUpgraded, semverMax } from './semver-utils';
import type { FixerCallOptions, FixerCallResult } from './types';
import { mergeOsvFirstWins } from './types';

interface OsvSnapshot {
  content: string;
  versionsPreAudit: Map<string, Set<string>>;
  intermediateBackup: Map<string, string>;
}

interface AuditVerification {
  verified: string[];
  falsePositives: string[];
}

/**
 * Snapshot the post-OSV state: the pre-audit lockfile (for version comparison) and
 * the intermediateBackup (lockfile + manifest, when present) used for partial revert.
 * Returns null (after logging why) when the lockfile is missing/unparseable — callers
 * treat that as "skip the audit fix".
 */
async function loadOsvSnapshot(cwd: string): Promise<OsvSnapshot | null> {
  let postOsvContent: string;
  try {
    postOsvContent = await readFile(join(cwd, 'package-lock.json'), 'utf-8');
  } catch (err) {
    logger.warn(
      `[osv-then-audit] package-lock.json not found before npm audit fix (${err}); skipping audit fix`,
    );
    return null;
  }

  const versionsPreAudit = collectNpmLockfileVersions(postOsvContent);
  if (versionsPreAudit.size === 0) {
    logger.tagged('npm', 'osv-then-audit', 'Could not parse package-lock.json before audit fix; skipping', 'warn');
    return null;
  }

  let postOsvManifest: string | undefined;
  try {
    postOsvManifest = await readFile(join(cwd, 'package.json'), 'utf-8');
    logger.tagged('npm', 'osv-then-audit', 'package.json included in intermediateBackup', 'debug');
  } catch {
    logger.tagged('npm', 'osv-then-audit', 'package.json not found before audit fix; partial revert will not restore manifest', 'warn');
  }

  const intermediateBackup = new Map<string, string>([
    ['package-lock.json', postOsvContent],
    ...(postOsvManifest ? [['package.json', postOsvManifest] as [string, string]] : []),
  ]);

  return { content: postOsvContent, versionsPreAudit, intermediateBackup };
}

async function runAuditFixPass(runner: CommandRunner, cwd: string): Promise<void> {
  logger.tagged('npm', 'osv-then-audit', 'Running npm audit fix on top of OSV changes...');
  const auditResult = await runner.runArgs('npm', ['audit', 'fix'], { cwd, stream: true });
  if (auditResult.exitCode !== 0) {
    logger.tagged('npm', 'osv-then-audit', `npm audit fix exited with ${auditResult.exitCode}; checking lockfile for partial upgrades`, 'warn');
  }
}

async function readPostAuditLockfile(cwd: string, fallback: string): Promise<string> {
  try {
    return await readFile(join(cwd, 'package-lock.json'), 'utf-8');
  } catch (err) {
    logger.tagged('npm', 'osv-then-audit', `Could not read package-lock.json after audit fix (${err})`, 'warn');
    return fallback;
  }
}

function classifyAuditUpgrade(
  name: string,
  versionsPreAudit: Map<string, Set<string>>,
  versionsPostAudit: Map<string, Set<string>>,
  rootVersionsPostAudit: Map<string, string>,
): { upgraded: boolean; version: string | undefined } {
  const before = semverMax(versionsPreAudit.get(name) ?? new Set());
  const after = semverMax(versionsPostAudit.get(name) ?? new Set());
  const rootAfter = rootVersionsPostAudit.get(name);
  return { upgraded: isUpgraded(before, after), version: rootAfter ?? after };
}

/**
 * Verify which auto_safe packages the audit-fix pass upgraded beyond the OSV pass.
 * Reports the root-level version to avoid false positives from transitive nested copies.
 */
function verifyAuditUpgrades(
  autoSafePackages: string[],
  versionsPreAudit: Map<string, Set<string>>,
  versionsPostAudit: Map<string, Set<string>>,
  rootVersionsPostAudit: Map<string, string>,
): AuditVerification {
  const verified: string[] = [];
  const falsePositives: string[] = [];

  for (const pkgSpec of autoSafePackages) {
    const name = pkgSpec.includes('@') && pkgSpec.lastIndexOf('@') > 0
      ? pkgSpec.slice(0, pkgSpec.lastIndexOf('@'))
      : pkgSpec;

    const { upgraded, version } = classifyAuditUpgrade(name, versionsPreAudit, versionsPostAudit, rootVersionsPostAudit);

    if (upgraded) {
      verified.push(`${name}@${version!}`);
    } else {
      falsePositives.push(name);
    }
  }

  return { verified, falsePositives };
}

/**
 * Build the partial-revert callable: restores to the post-OSV intermediate state and
 * re-runs npm ci. Closed over intermediateBackup and the bootstrap spec. Follows the
 * same restore -> bootstrap -> restore-again protocol as the full revert.
 */
function buildPartialRevert(
  intermediateBackup: Map<string, string>,
): (runner: CommandRunner, cwd: string) => Promise<void> {
  const bootstrapSpec: BootstrapSpec = { binary: 'npm', args: ['ci'], label: 'npm ci' };
  return (partialRunner: CommandRunner, partialCwd: string): Promise<void> =>
    revertWithBootstrap(partialRunner, bootstrapSpec, intermediateBackup, partialCwd);
}

/**
 * Apply npm audit fix on top of an already-applied OSV fix.
 *
 * This fixer is called after the orchestrator has already run osv-scanner fix. It:
 * 1. Snapshots the current (post-OSV) lockfile as `intermediateBackup` for partial rollback.
 * 2. Runs `npm audit fix` to pick up any vulnerabilities osv-scanner could not address
 *    (e.g. lockfileVersion: 1 projects, or packages not in the OSV database).
 * 3. Verifies which auto_safe packages were actually upgraded by comparing lockfile versions
 *    before and after the audit-fix step.
 *
 * Returns `intermediateBackup` so the updater can attempt a partial revert (back to OSV-only
 * state) before falling back to a full pre-fix revert if validation fails.
 */
export async function applyOsvThenAuditFix(opts: FixerCallOptions): Promise<FixerCallResult> {
  const { runner, cwd, scanResult } = opts;
  const npmEcosystem = scanResult.ecosystems[opts.ecosystemKey ?? 'npm'] ?? emptyEcosystem();

  const osvSnapshot = await loadOsvSnapshot(cwd);
  if (!osvSnapshot) {
    return { breakingInstallError: null, packagesUpdated: [] };
  }

  await runAuditFixPass(runner, cwd);

  const postAuditContent = await readPostAuditLockfile(cwd, osvSnapshot.content);
  const versionsPostAudit = collectNpmLockfileVersions(postAuditContent);
  const rootVersionsPostAudit = collectRootNpmLockfileVersions(postAuditContent);

  const { verified: auditVerified, falsePositives: auditFalsePositives } = verifyAuditUpgrades(
    npmEcosystem.auto_safe_packages,
    osvSnapshot.versionsPreAudit,
    versionsPostAudit,
    rootVersionsPostAudit,
  );

  logger.tagged('npm', 'osv-then-audit', `Verified ${auditVerified.length} of ${npmEcosystem.auto_safe_packages.length} audit-fix upgrade(s) on disk`);
  if (auditFalsePositives.length > 0) {
    logger.tagged('npm', 'osv-then-audit', `${auditFalsePositives.length} package(s) classified auto_safe but not upgraded by audit fix: ${auditFalsePositives.join(', ')}`, 'warn');
  }

  // OSV-first-wins: OSV packages are verified against the staging lockfile (ground truth).
  // Audit packages complement — only packages NOT already covered by OSV are added.
  // When osvFixOutcome is absent (e.g. fixer was demoted to npm-audit only), returns
  // auditVerified as-is (same behaviour as before).
  const packagesUpdated = mergeOsvFirstWins(opts.osvFixOutcome, auditVerified);

  return {
    breakingInstallError: null,
    packagesUpdated,
    intermediateBackup: osvSnapshot.intermediateBackup,
    partialRevert: buildPartialRevert(osvSnapshot.intermediateBackup),
  };
}
