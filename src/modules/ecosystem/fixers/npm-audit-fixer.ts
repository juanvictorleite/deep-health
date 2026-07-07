import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import semver from 'semver';

import type { CommandRunner } from '@core/types/common';
import type { ScanResultJson, VulnerabilityEntry } from '@core/types/scan';
import { emptyEcosystem } from '@core/types/scan';
import { logger } from '@infra/utils/logger';
import { collectNpmLockfileVersions, collectRootNpmLockfileVersions } from '@modules/ecosystem/utils/lockfile-inspect';

import { isUpgraded, semverMax } from './semver-utils';

export interface NpmAuditFixerOptions {
  runner: CommandRunner;
  cwd: string;
  scanResult: ScanResultJson;
  authorizeBreaking: boolean;
  /** The ecosystem key used to look up scan results (e.g. "npm", "npm:web"). Defaults to "npm". */
  ecosystemKey?: string;
}

export interface NpmAuditFixerResult {
  /** Breaking packages install error, if any */
  breakingInstallError: string | null;
  /** Packages that were updated */
  packagesUpdated: string[];
}

interface PreFixSnapshot {
  content: string;
  rootVersionsBefore: Map<string, string>;
  treeVersionsBefore: Map<string, Set<string>>;
}

interface UpgradeVerification {
  verified: string[];
  falsePositives: string[];
}

interface BreakingInstallOutcome {
  breakingInstallError: string | null;
  verified: string[];
}

/**
 * Read and parse the pre-fix lockfile. Returns null (after logging why) when the
 * lockfile is missing/unreadable or unparseable — callers treat that as "skip the fix".
 */
async function loadPreFixSnapshot(cwd: string): Promise<PreFixSnapshot | null> {
  let content: string;
  try {
    content = await readFile(join(cwd, 'package-lock.json'), 'utf-8');
  } catch (err) {
    logger.warn(
      `[npm-audit fix] package-lock.json not found or unreadable before fix (${err}); skipping npm audit fix`,
    );
    return null;
  }

  const rootVersionsBefore = collectRootNpmLockfileVersions(content);
  if (rootVersionsBefore.size === 0) {
    logger.warn(
      '[npm-audit fix] Could not parse package-lock.json before fix; skipping npm audit fix',
    );
    return null;
  }

  return { content, rootVersionsBefore, treeVersionsBefore: collectNpmLockfileVersions(content) };
}

async function runAutoSafeAuditFix(runner: CommandRunner, cwd: string): Promise<void> {
  logger.info('Applying npm audit fix for auto-safe vulnerabilities...');
  // SEC: use runArgs (shell: false) — 'npm audit fix' has no variable data but
  // runArgs is used for consistency with all other npm invocations in this module.
  const fixResult = await runner.runArgs('npm', ['audit', 'fix'], { cwd, stream: true });
  if (fixResult.exitCode !== 0) {
    // npm audit fix applies partial patches before failing in many cases — do not abort.
    logger.warn(
      `[npm-audit fix] npm audit fix exited with ${fixResult.exitCode}; checking lockfile for partial upgrades`,
    );
  }
}

/**
 * Read the current package-lock.json, falling back to `fallback` (and warning) when
 * the file cannot be read — used after both the auto-safe and breaking-install steps.
 */
async function readLockfileAfter(cwd: string, fallback: string, stage: string): Promise<string> {
  try {
    return await readFile(join(cwd, 'package-lock.json'), 'utf-8');
  } catch (err) {
    logger.tagged('npm', 'npm-audit fix', `Could not read package-lock.json after ${stage} (${err})`, 'warn');
    return fallback;
  }
}

/**
 * auto_safe_packages is a string[] of "name@version" or bare "name" strings from the scanner.
 * We only care about the package name for verification — the lockfile is the authority on which
 * version actually landed.
 *
 * Hybrid rule: packages present at root level (in EITHER pre or post lockfile) use the existing
 * root-only comparison — this preserves the nested-dedup false-positive guard for lockfileVersion 1.
 * Packages that are purely transitive (absent at root both before and after) use the full-tree
 * max-version comparison so genuine transitive upgrades (e.g. elliptic, ip) are counted.
 */
function classifyAutoSafeUpgrade(
  name: string,
  rootVersionsBefore: Map<string, string>,
  rootVersionsAfter: Map<string, string>,
  treeVersionsBefore: Map<string, Set<string>>,
  treeVersionsAfter: Map<string, Set<string>>,
): { upgraded: boolean; version: string | undefined } {
  const rootBefore = rootVersionsBefore.get(name);
  const rootAfter = rootVersionsAfter.get(name);

  if (rootBefore !== undefined || rootAfter !== undefined) {
    return { upgraded: isUpgraded(rootBefore, rootAfter), version: rootAfter };
  }

  const treeBeforeMax = semverMax(treeVersionsBefore.get(name) ?? new Set());
  const treeAfterMax = semverMax(treeVersionsAfter.get(name) ?? new Set());
  return { upgraded: isUpgraded(treeBeforeMax, treeAfterMax), version: treeAfterMax };
}

function verifyAutoSafeUpgrades(
  autoSafePackages: string[],
  rootVersionsBefore: Map<string, string>,
  rootVersionsAfter: Map<string, string>,
  treeVersionsBefore: Map<string, Set<string>>,
  treeVersionsAfter: Map<string, Set<string>>,
): UpgradeVerification {
  const verified: string[] = [];
  const falsePositives: string[] = [];

  for (const pkgSpec of autoSafePackages) {
    const name = pkgSpec.includes('@') && pkgSpec.lastIndexOf('@') > 0
      ? pkgSpec.slice(0, pkgSpec.lastIndexOf('@'))
      : pkgSpec;

    const { upgraded, version } = classifyAutoSafeUpgrade(
      name, rootVersionsBefore, rootVersionsAfter, treeVersionsBefore, treeVersionsAfter,
    );

    if (upgraded) {
      verified.push(`${name}@${version!}`);
    } else {
      falsePositives.push(name);
    }
  }

  return { verified, falsePositives };
}

function selectBreakingPackages(vulnerabilities: VulnerabilityEntry[]): Map<string, string> {
  const skippedProtected = vulnerabilities
    .filter((v) => v.classification === 'breaking' && v.breakingReason === 'protected-constraint');
  if (skippedProtected.length > 0) {
    logger.tagged('npm', 'npm-audit fix', `Skipping ${skippedProtected.length} protected-constraint package(s) — cannot be installed automatically: ` +
      skippedProtected.map((v) => v.package).join(', '), 'warn');
  }

  return vulnerabilities
    .filter((v) => v.classification === 'breaking' && v.safeVersion && v.breakingReason !== 'protected-constraint')
    .reduce<Map<string, string>>((map, v) => {
      if (!map.has(v.package)) map.set(v.package, v.safeVersion!);
      return map;
    }, new Map());
}

function isExactDiskMatch(targetVersion: string, diskVersions: Set<string> | undefined): boolean {
  return diskVersions !== undefined && diskVersions.has(targetVersion);
}

function isSemverAtLeastTarget(targetVersion: string, diskMax: string | undefined): boolean {
  if (!diskMax) return false;
  const targetValid = semver.valid(targetVersion);
  const diskValid = semver.valid(diskMax);
  if (!targetValid || !diskValid) return false;
  return semver.gte(diskValid, targetValid);
}

// Exact match, or disk has a version >= target (semver-aware).
function classifyBreakingUpgrade(
  targetVersion: string,
  diskVersions: Set<string> | undefined,
): { verified: boolean; version: string | undefined } {
  const diskMax = semverMax(diskVersions ?? new Set());
  const verified = isExactDiskMatch(targetVersion, diskVersions) || isSemverAtLeastTarget(targetVersion, diskMax);
  return { verified, version: verified ? (diskMax ?? targetVersion) : targetVersion };
}

function verifyBreakingUpgrades(
  breakingPkgs: Map<string, string>,
  versionsAfterBreaking: Map<string, Set<string>>,
): { verified: string[]; unverified: string[] } {
  const verified: string[] = [];
  const unverified: string[] = [];

  for (const [name, targetVersion] of breakingPkgs) {
    const outcome = classifyBreakingUpgrade(targetVersion, versionsAfterBreaking.get(name));
    if (outcome.verified) {
      verified.push(`${name}@${outcome.version}`);
    } else {
      unverified.push(`${name}@${targetVersion}`);
    }
  }

  return { verified, unverified };
}

/**
 * Install the authorized breaking-change packages and verify what actually landed on disk.
 * Returns `breakingInstallError` only when the install failed AND nothing verified —
 * partial success (some packages verified) is not treated as a hard failure.
 */
async function applyBreakingInstall(
  runner: CommandRunner,
  cwd: string,
  breakingPkgs: Map<string, string>,
  postAutoSafeLockfile: string,
): Promise<BreakingInstallOutcome> {
  const specs = [...breakingPkgs.entries()].map(([name, ver]) => `${name}@${ver}`);
  const specsStr = specs.join(' ');
  logger.info(`Installing authorized breaking-change packages: ${specsStr}`);
  // SEC: use runArgs (shell: false) — package-name@version data must not reach a shell tokenizer
  const installResult = await runner.runArgs('npm', ['install', ...specs], { cwd, stream: true });

  const postBreakingLockfile = await readLockfileAfter(cwd, postAutoSafeLockfile, 'breaking install');
  const versionsAfterBreaking = collectNpmLockfileVersions(postBreakingLockfile);

  const { verified, unverified } = verifyBreakingUpgrades(breakingPkgs, versionsAfterBreaking);

  if (unverified.length > 0) {
    logger.tagged('npm', 'npm-audit fix', `${verified.length} of ${breakingPkgs.size} authorized breaking upgrade(s) verified on disk; unverified: ${unverified.join(', ')}`, 'warn');
  }

  const breakingInstallError = installResult.exitCode !== 0 && verified.length === 0
    ? `npm install ${specsStr} failed: ${installResult.stderr}`
    : null;

  return { breakingInstallError, verified };
}

/**
 * Apply npm audit fix to address vulnerabilities.
 *
 * Uses `npm audit fix` for auto-safe packages and targeted npm install for authorized breaking
 * changes. Both phases verify the resulting package-lock.json on disk before claiming any
 * package was updated — preventing false-positive entries in the executive report when
 * `npm audit fix` applies partial patches, hits peer-dep constraints, or exits non-zero.
 */
export async function applyNpmAuditFix(opts: NpmAuditFixerOptions): Promise<NpmAuditFixerResult> {
  const { runner, cwd, scanResult, authorizeBreaking } = opts;
  const npmEcosystem = scanResult.ecosystems[opts.ecosystemKey ?? 'npm'] ?? emptyEcosystem();

  const preFix = await loadPreFixSnapshot(cwd);
  if (!preFix) {
    return { breakingInstallError: null, packagesUpdated: [] };
  }

  await runAutoSafeAuditFix(runner, cwd);

  const postAutoSafeLockfile = await readLockfileAfter(cwd, preFix.content, 'npm audit fix');
  const rootVersionsAfterAutoSafe = collectRootNpmLockfileVersions(postAutoSafeLockfile);
  const treeVersionsAfterAutoSafe = collectNpmLockfileVersions(postAutoSafeLockfile);

  const { verified: autoSafeVerified, falsePositives: autoSafeFalsePositives } = verifyAutoSafeUpgrades(
    npmEcosystem.auto_safe_packages,
    preFix.rootVersionsBefore,
    rootVersionsAfterAutoSafe,
    preFix.treeVersionsBefore,
    treeVersionsAfterAutoSafe,
  );

  logger.tagged('npm', 'npm-audit fix', `Verified ${autoSafeVerified.length} of ${npmEcosystem.auto_safe_packages.length} auto-safe upgrade(s) on host disk`);
  if (autoSafeFalsePositives.length > 0) {
    logger.tagged('npm', 'npm-audit fix', `Scanner classified ${autoSafeFalsePositives.length} package(s) as auto_safe but post-fix lockfile has no newer version: ${autoSafeFalsePositives.join(', ')}`, 'warn');
  }

  const packagesUpdated = [...autoSafeVerified];

  if (!authorizeBreaking) {
    return { breakingInstallError: null, packagesUpdated };
  }

  const breakingPkgs = selectBreakingPackages(npmEcosystem.vulnerabilities);
  if (breakingPkgs.size === 0) {
    return { breakingInstallError: null, packagesUpdated };
  }

  const { breakingInstallError, verified: breakingVerified } = await applyBreakingInstall(
    runner,
    cwd,
    breakingPkgs,
    postAutoSafeLockfile,
  );

  packagesUpdated.push(...breakingVerified);

  return { breakingInstallError, packagesUpdated };
}
