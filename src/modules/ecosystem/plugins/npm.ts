import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CommandRunner } from '@core/types/common';
import type { ProjectConfig, ProtectedPackage, FixerStrategyId, EcosystemConfig } from '@core/types/config';
import type { EcosystemScanResult, ScanResultJson } from '@core/types/scan';
import { emptyEcosystem } from '@core/types/scan';
import type { UpdateResultJson } from '@core/types/update';
import { NPM_DEFAULT_FIXER } from '@infra/brand';
import { resolveEcosystemImage } from '@infra/provisioner/image-resolvers';
import type { VersionSource } from '@infra/utils/infer-version';
import { logger } from '@infra/utils/logger';
import { collectRootNpmLockfileVersions } from '@modules/ecosystem/utils/lockfile-inspect';
import { readNpmLockfileVersion } from '@modules/ecosystem/utils/lockfile-utils';

import { runNpmUpdater } from './npm-updater';
import type { EcosystemPlugin, EcosystemUpdaterContext } from '../types';

// ─── Version inference helpers ────────────────────────────────────────────────

/**
 * Sanitize a raw version string read from `.nvmrc` or `.node-version`.
 *
 * Rules:
 * - Trim whitespace; strip leading `v` (case-insensitive).
 * - Reject LTS aliases (`lts/*`, `lts/hydrogen`, `node`, `stable`, `latest`, `*`).
 * - Accept only bare numeric versions like "20", "20.11", "20.11.1".
 * - Returns undefined when the value is not a concrete version.
 */
function sanitizeNodeVersionFile(raw: string): string | undefined {
  const value = raw.trim().toLowerCase();

  if (
    !value ||
    value === '*' ||
    value === 'node' ||
    value === 'stable' ||
    value === 'latest' ||
    value.startsWith('lts/')
  ) {
    return undefined;
  }

  // Strip leading "v"
  const stripped = value.startsWith('v') ? value.slice(1) : value;

  // Must look like a numeric version (e.g. "20", "20.11", "20.11.1")
  if (!/^\d[\d.]*$/.test(stripped)) return undefined;

  return stripped;
}

/**
 * Parse a `package.json#engines.node` range into a best-effort version string.
 *
 * Supported patterns (non-exhaustive):
 * - `>=20.0.0` → "20.0.0"
 * - `>=20`     → "20"
 * - `^20`      → "20"
 * - `~20.11`   → "20.11"
 * - `20.x`     → "20"
 * - `20`       → "20"
 * - `*`        → undefined (too broad)
 *
 * Returns undefined when the range is too broad, empty, or unparseable.
 */
function parseEnginesNodeRange(range: string): string | undefined {
  const trimmed = range.trim();
  if (!trimmed || trimmed === '*') return undefined;

  // Extract the first numeric version segment from the range
  const match = trimmed.match(/[>=^~]*(\d[\d.x]*)/);
  if (!match) return undefined;

  // Normalise: drop trailing `.x` suffix → "20.x" becomes "20"
  const version = match[1]!.replace(/\.x$/i, '');
  if (!version || version === '*') return undefined;

  // Must look like a numeric version after normalisation
  if (!/^\d[\d.]*$/.test(version)) return undefined;

  return version;
}

/**
 * Extract the `package.json#engines.node` range as a best-effort version
 * string. Returns undefined on malformed JSON, a missing/non-string
 * `engines.node`, or a range `parseEnginesNodeRange` rejects.
 */
function extractEnginesNodeVersion(content: string): string | undefined {
  try {
    const pkg: unknown = JSON.parse(content);
    if (
      pkg !== null &&
      typeof pkg === 'object' &&
      'engines' in pkg &&
      typeof (pkg as Record<string, unknown>)['engines'] === 'object' &&
      (pkg as Record<string, unknown>)['engines'] !== null
    ) {
      const engines = (pkg as Record<string, unknown>)['engines'] as Record<string, unknown>;
      if (typeof engines['node'] === 'string') {
        return parseEnginesNodeRange(engines['node']);
      }
    }
  } catch {
    // malformed JSON — fall through
  }
  return undefined;
}

// ─── installBreakingPackages phase helpers ────────────────────────────────────

/**
 * Collect the authorized breaking-change packages (name → safe version) from
 * an ecosystem scan result, warning about any protected-constraint packages
 * that must be skipped (they cannot be installed automatically).
 */
function collectAuthorizedBreakingPackages(ecosystemResult: EcosystemScanResult): Map<string, string> {
  const skippedProtected = ecosystemResult.vulnerabilities
    .filter((v) => v.classification === 'breaking' && v.breakingReason === 'protected-constraint');
  if (skippedProtected.length > 0) {
    logger.warn(
      `[OSV strategy] Skipping ${skippedProtected.length} protected-constraint package(s) — cannot be installed automatically: ` +
      skippedProtected.map((v) => v.package).join(', '),
    );
  }

  return ecosystemResult.vulnerabilities
    .filter((v) => v.classification === 'breaking' && v.safeVersion && v.breakingReason !== 'protected-constraint')
    .reduce<Map<string, string>>((map, v) => {
      if (!map.has(v.package)) map.set(v.package, v.safeVersion!);
      return map;
    }, new Map());
}

/**
 * Read `package-lock.json` from `cwd` and collect its root package versions.
 * Returns an empty map (after logging `debugMessage`) when the lockfile is
 * missing or unreadable.
 */
async function readRootLockfileVersions(cwd: string, debugMessage: string): Promise<Map<string, string>> {
  let content: string | undefined;
  try {
    content = await readFile(join(cwd, 'package-lock.json'), 'utf-8') as string;
  } catch {
    logger.debug(debugMessage);
  }
  return content !== undefined ? collectRootNpmLockfileVersions(content) : new Map<string, string>();
}

/**
 * Verify each requested breaking package landed in the lockfile diff between
 * the pre- and post-install root version snapshots. Returns the count of
 * packages confirmed upgraded; warns (verbatim) for each that was not.
 */
function verifyBreakingUpgrades(
  breakingPkgs: Map<string, string>,
  rootBefore: Map<string, string>,
  rootAfter: Map<string, string>,
): number {
  let verifiedCount = 0;
  for (const spec of breakingPkgs.keys()) {
    // Extract name: everything before the last '@'
    const atIdx = spec.lastIndexOf('@');
    const name = atIdx > 0 ? spec.slice(0, atIdx) : spec;
    const versionAfter = rootAfter.get(name);
    const versionBefore = rootBefore.get(name);
    if (versionAfter === undefined || versionAfter === versionBefore) {
      logger.warn(
        `[breaking install] ${name} was requested but not found in lockfile diff after npm install`,
      );
    } else {
      verifiedCount++;
    }
  }
  return verifiedCount;
}

/**
 * Run `npm install` for the authorized breaking-change package specs,
 * snapshotting the root lockfile versions before and after and verifying
 * every requested package actually landed in the lockfile diff.
 */
async function performBreakingInstall(
  runner: CommandRunner,
  cwd: string,
  specArgs: string[],
  breakingPkgs: Map<string, string>,
): Promise<{ status: 'success' | 'error'; error?: string }> {
  const specs = specArgs.join(' ');

  const rootBefore = await readRootLockfileVersions(
    cwd,
    '[breaking install] Could not read package-lock.json before install — skipping pre-snapshot',
  );

  // SEC: use runArgs (shell: false) so package-name/version data never reaches a shell tokenizer
  const installResult = await runner.runArgs('npm', ['install', ...specArgs], { cwd, stream: true });
  if (installResult.exitCode !== 0) {
    logger.error(
      `[OSV strategy] npm install for breaking packages failed (exit ${installResult.exitCode}): ${installResult.stderr}`,
    );
    return { status: 'error', error: `npm install ${specs} failed: ${installResult.stderr}` };
  }

  const rootAfter = await readRootLockfileVersions(
    cwd,
    '[breaking install] Could not read package-lock.json after install — skipping post-snapshot',
  );

  const verifiedCount = verifyBreakingUpgrades(breakingPkgs, rootBefore, rootAfter);

  if (verifiedCount === 0 && breakingPkgs.size > 0) {
    const names = [...breakingPkgs.keys()].join(', ');
    logger.error(
      `[breaking install] None of the requested packages (${names}) were verified in the lockfile after npm install`,
    );
    return {
      status: 'error',
      error: `Breaking install produced no verified upgrades for: ${names}`,
    };
  }

  return { status: 'success' };
}

export const npmPlugin: EcosystemPlugin = {
  id: 'npm',
  name: 'npm',
  manifest: 'package.json',
  lockfile: 'package-lock.json',
  osvEcosystems: ['npm'],

  /** Label used in executive report evidence tables */
  reportLabel: 'npm',

  runtimeSpec: {
    defaultImage: 'node:lts',
    resolveImage: (version) => resolveEcosystemImage('npm', version),
    containerBinaries: ['npm'],
    runMode: { kind: 'direct-exec', binary: 'npm' },
  },

  osvFixSpec: {
    fixLockfile: 'package-lock.json',
    backupFiles: ['package.json', 'package-lock.json'],
  },

  postUpdateOsvVerify: 'osv-strategy-only',

  supportedFixers: ['osv', 'osv-then-audit', 'npm-audit'],

  defaultValidationCommands: [
    { name: 'build', command: 'npm run build' },
  ],

  defaultAdvisors: [
    { name: 'audit', command: 'npm audit --json', format: 'json' as const },
  ],

  buildScanArgs(): string[] {
    return ['--lockfile', 'package-lock.json'];
  },

  getProtectedPackages(config: ProjectConfig): ProtectedPackage[] {
    return config.protected_packages['npm'] ?? [];
  },

  /**
   * Resolve the effective fixer strategy for npm at runtime.
   *
   * If the configured strategy is `'osv'` or `'osv-then-audit'` and the
   * project's `package-lock.json` has `lockfileVersion: 1` (npm 6 / Node ≤12),
   * osv-scanner cannot patch the lockfile in-place. The strategy is
   * automatically demoted to `'npm-audit'` with a warning.
   *
   * Must not throw. Returns the original strategy when the lockfile is missing
   * or unreadable.
   */
  async resolveEffectiveFixer(_config: ProjectConfig, cwd: string, ecoEntry: EcosystemConfig): Promise<FixerStrategyId> {
    const strategy = (ecoEntry.fixer ?? NPM_DEFAULT_FIXER) as FixerStrategyId;

    if (strategy === 'osv' || strategy === 'osv-then-audit') {
      const lockVer = await readNpmLockfileVersion(cwd);
      if (lockVer === 1) {
        logger.tagged(
          'osv',
          'OSV fix',
          `package-lock.json has lockfileVersion: 1 (npm 6 / Node ≤12). ` +
            `osv-scanner cannot patch lockfileVersion 1 lockfiles in-place. ` +
            `Auto-switching fixer: '${strategy}' → 'npm-audit'.`,
          'warn',
        );
        return 'npm-audit';
      }
    }

    return strategy;
  },

  async runUpdater(ctx: EcosystemUpdaterContext): Promise<UpdateResultJson> {
    return runNpmUpdater(
      ctx.runner,
      ctx.config,
      ctx.scanResult,
      ctx.cwd,
      ctx.authorizeBreaking,
      ctx.validationCommands ?? [],
      ctx.fixerStrategy ?? 'osv',
      ctx.preFixBackups,
      ctx.osvFixOutcome,
      ctx.preRunSnapshots,
      ctx.advisorResults,
      ctx.ecosystemKey,
    );
  },

  async installBreakingPackages(args: {
    runner: CommandRunner;
    cwd: string;
    scanResult: ScanResultJson;
    dryRun: boolean;
    fixerStrategy: string;
    ecosystemKey?: string;
  }): Promise<{ status: 'success' | 'error'; error?: string } | null> {
    // Only applies for osv strategy
    if (args.fixerStrategy !== 'osv') return null;

    const ecosystemResult = args.scanResult.ecosystems[args.ecosystemKey ?? 'npm'] ?? emptyEcosystem();
    const breakingPkgs = collectAuthorizedBreakingPackages(ecosystemResult);

    if (breakingPkgs.size === 0) return { status: 'success' };

    const specArgs = [...breakingPkgs.entries()].map(([name, ver]) => `${name}@${ver}`);
    const specs = specArgs.join(' ');
    logger.tagged('npm', 'OSV strategy', `Installing authorized breaking-change packages via npm: ${specs}`);

    if (args.dryRun) {
      logger.tagged('npm', 'DRY-RUN', `Would execute: npm install ${specs}`);
      return { status: 'success' };
    }

    return performBreakingInstall(args.runner, args.cwd, specArgs, breakingPkgs);
  },

  /**
   * Declarative version sources for Node.js version inference.
   *
   * Precedence:
   * 1. `.nvmrc`
   * 2. `.node-version`
   * 3. `package.json#engines.node`
   */
  versionSources: [
    {
      file: '.nvmrc',
      label: '.nvmrc',
      extract: (content: string) => sanitizeNodeVersionFile(content),
    },
    {
      file: '.node-version',
      label: '.node-version',
      extract: (content: string) => sanitizeNodeVersionFile(content),
    },
    {
      file: 'package.json',
      label: 'package.json#engines.node',
      extract: extractEnginesNodeVersion,
    },
  ] satisfies VersionSource[],
};
