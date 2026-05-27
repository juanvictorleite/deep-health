import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import semver from 'semver';
import type { CommandRunner, VulnerabilityClass } from '@core/types/common';
import type { FixerStrategyId, ValidationCommandConfig } from '@core/types/config';
import type { UpdateResultJson } from '@core/types/update';
import type { ScanResultJson, VulnerabilityEntry } from '@core/types/scan';
import type { AdvisorResult } from '@core/types/report';
import { emptyEcosystem } from '@core/types/scan';
import { logger } from '@infra/utils/logger';
import { mergeOsvFirstWins } from '../fixers/index';
import type { OsvFixOutcome } from '../fixers/index';
import { runUpdaterLifecycle } from '../utils/updater-lifecycle';
import type { PipToolingDetection } from './pip-tooling-detector';

const PIP_FILES = ['requirements.txt'];

const UV_REGISTRY_ENV_KEYS = [
  'PIP_INDEX_URL',
  'PIP_EXTRA_INDEX_URL',
  'UV_INDEX_URL',
  'UV_EXTRA_INDEX_URL',
] as const;

function pickRegistryEnvVars(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of UV_REGISTRY_ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

export function resolveBackupFiles(det?: PipToolingDetection): string[] {
  if (!det || det.tooling === 'bare-pip') return PIP_FILES;
  if (det.tooling === 'pip-tools') return ['requirements.txt', 'requirements.in'];
  if (det.lockfile) return ['requirements.txt', basename(det.lockfile)];
  return PIP_FILES;
}

export function resolveBootstrapSpec(det?: PipToolingDetection): { binary: string; args: string[]; label: string } {
  if (!det || det.tooling === 'bare-pip' || det.tooling === 'pip-tools') {
    return { binary: 'pip', args: ['install', '-r', 'requirements.txt'], label: 'pip install -r requirements.txt (revert)' };
  }
  if (det.tooling === 'poetry') return { binary: 'poetry', args: ['install', '--no-interaction'], label: 'poetry install (revert)' };
  if (det.tooling === 'uv') return { binary: 'uv', args: ['pip', 'install', '-r', 'requirements.txt'], label: 'uv pip install -r requirements.txt (revert)' };
  if (det.tooling === 'pipenv') return { binary: 'pipenv', args: ['install'], label: 'pipenv install (revert)' };
  if (det.tooling === 'pdm') return { binary: 'pdm', args: ['install', '--no-isolation'], label: 'pdm install (revert)' };
  return { binary: 'pip', args: ['install', '-r', 'requirements.txt'], label: 'pip install -r requirements.txt (revert)' };
}

/** Typed result from applyFix — discriminates pip-audit vs pip-install path. */
export type PipFixerResult =
  | { mode: 'pip-audit'; stdout: string }
  | { mode: 'pip-install'; stdout: string };

/**
 * Strip pip version specifiers and extras from a package reference.
 *
 * Rules (applied in order):
 * 1. Strip trailing `[extras]` group (e.g. `pkg[security]` → `pkg`)
 * 2. Split on first occurrence of `==|>=|<=|~=|!=|>|<|@` — keep left side
 * 3. Trim whitespace
 *
 * Examples:
 *   'requests==2.31'         → 'requests'
 *   'requests>=2.0'          → 'requests'
 *   'requests[security]==2'  → 'requests'
 *   'requests[a,b]>=1'       → 'requests'
 *   'requests@1.0'           → 'requests'
 *   'requests'               → 'requests'
 */
export function stripPipVersion(ref: string): string {
  // Strip extras brackets first
  let cleaned = ref.replace(/\[[^\]]*\]/g, '');
  // Split on first version specifier operator
  const match = cleaned.match(/^([^=!<>~@]*)/);
  cleaned = match ? (match[1] ?? cleaned) : cleaned;
  return cleaned.trim();
}

/**
 * Convert a scan entry to a pip install spec with a pinned version.
 *
 * Handles both '@' and '==' separators used in scan data:
 *   'pillow==9.5.0'    → 'pillow==9.5.0'
 *   'pillow@9.5.0'     → 'pillow==9.5.0'
 *   'pillow'           → 'pillow'  (no version found)
 *
 * The '-U' flag is intentionally omitted — we install the exact OSV-recommended version.
 */
export function toPipInstallSpec(scanEntry: string): string {
  const name = stripPipVersion(scanEntry);
  const match = scanEntry.match(/(?:==|@)([^\s,;@=]+)/);
  if (!match) return name;
  const version = match[1]!;
  return `${name}==${version}`;
}

/**
 * Compute the maximum safe version for each package from the vulnerabilities array.
 *
 * Algorithm:
 *   1. Filter entries by the provided classifications set.
 *   2. Skip entries with null safeVersion.
 *   3. Group by lowercase package name.
 *   4. For each group, pick the MAX safeVersion using semver.coerce + semver.gt.
 *      Falls back to localeCompare when both versions are non-semver-coercible.
 *
 * @param vulnerabilities - Array of VulnerabilityEntry from the ecosystem scan.
 * @param classifications - Set of VulnerabilityClass values to include (e.g. {'auto_safe'} or {'auto_safe','breaking'}).
 * @returns Map<lowercasePkgName, maxSafeVersion>
 */
export function computeMaxSafeVersions(
  vulnerabilities: VulnerabilityEntry[],
  classifications: Set<VulnerabilityClass>,
): Map<string, string> {
  const result = new Map<string, string>();

  for (const entry of vulnerabilities) {
    if (!classifications.has(entry.classification)) continue;
    if (entry.safeVersion === null) continue;

    const pkg = entry.package.toLowerCase();
    const candidate = entry.safeVersion;
    const existing = result.get(pkg);

    if (existing === undefined) {
      result.set(pkg, candidate);
      continue;
    }

    // Compare candidate vs existing — pick the larger one
    const semCandidate = semver.coerce(candidate);
    const semExisting = semver.coerce(existing);

    if (semCandidate !== null && semExisting !== null) {
      if (semver.gt(semCandidate, semExisting)) {
        result.set(pkg, candidate);
      }
    } else {
      // Fallback for non-semver versions: use localeCompare
      if (candidate.localeCompare(existing) > 0) {
        result.set(pkg, candidate);
      }
    }
  }

  return result;
}

/**
 * Compute all unique safe versions for each package from the vulnerabilities array,
 * sorted descending (highest first).
 *
 * Algorithm:
 *   1. Filter entries by the provided classifications set.
 *   2. Skip entries with null safeVersion.
 *   3. Group by lowercase package name — collect all unique safeVersions per package.
 *   4. Sort each group descending: semver.coerce + semver.gt for semver-parseable versions,
 *      with localeCompare fallback for non-semver pip versions.
 *
 * @param vulnerabilities - Array of VulnerabilityEntry from the ecosystem scan.
 * @param classifications - Set of VulnerabilityClass values to include.
 * @returns Map<lowercasePkgName, string[]> where the array is sorted descending.
 */
export function computeSortedSafeVersions(
  vulnerabilities: VulnerabilityEntry[],
  classifications: Set<VulnerabilityClass>,
): Map<string, string[]> {
  const result = new Map<string, Set<string>>();

  for (const entry of vulnerabilities) {
    if (!classifications.has(entry.classification)) continue;
    if (entry.safeVersion === null) continue;

    const pkg = entry.package.toLowerCase();
    const existing = result.get(pkg);
    if (existing === undefined) {
      result.set(pkg, new Set([entry.safeVersion]));
    } else {
      existing.add(entry.safeVersion);
    }
  }

  const sorted = new Map<string, string[]>();
  for (const [pkg, versions] of result) {
    sorted.set(pkg, [...versions].sort(compareVersionsDescending));
  }
  return sorted;
}

function compareVersionsDescending(a: string, b: string): number {
  const semA = semver.coerce(a);
  const semB = semver.coerce(b);
  if (semA !== null && semB !== null) {
    return semver.gt(semA, semB) ? -1 : semver.gt(semB, semA) ? 1 : 0;
  }
  return b.localeCompare(a);
}

/**
 * Rewrite requirements.txt content with newly installed versions.
 *
 * For each package line:
 *   - Preserve comments (#), blank lines, and options (-r, -e, --)
 *   - Split on ';' to separate environment markers
 *   - Extract package name (and optional extras) from the left side
 *   - Look up lowercase name in installedVersions
 *   - If found: replace version specifier with ==<installedVersion>
 *   - If not found: keep line as-is
 *
 * @param content - Current requirements.txt content
 * @param installedVersions - Map of lowercase package name → installed version
 */
export function updateRequirementsContent(
  content: string,
  installedVersions: Map<string, string>,
): string {
  if (installedVersions.size === 0) return content;

  const lines = content.split('\n');
  const result = lines.map((line) => {
    const trimmed = line.trim();

    // Preserve blank lines, comments, and options (-r, -e, --)
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('-')) {
      return line;
    }

    // Split on ';' to preserve environment markers
    const semicolonIdx = line.indexOf(';');
    const packagePart = semicolonIdx === -1 ? line : line.slice(0, semicolonIdx);
    const markerPart = semicolonIdx === -1 ? '' : line.slice(semicolonIdx);

    // Extract extras (e.g. [security]) from the package part
    const extrasMatch = packagePart.match(/(\[[^\]]*\])/);
    const extras = extrasMatch ? extrasMatch[1]! : '';

    // Get lowercase package name for map lookup
    const pkgName = stripPipVersion(packagePart.trim()).toLowerCase();

    const installedVersion = installedVersions.get(pkgName);
    if (installedVersion === undefined) return line;

    // Reconstruct: originalName[extras]==newVersion; marker
    return `${pkgName}${extras}==${installedVersion}${markerPart}`;
  });

  return result.join('\n');
}

/**
 * Parse the `Successfully installed` line emitted by pip after a successful install.
 *
 * Format: `Successfully installed pkg1-1.0.0 pkg2-2.3.4 django-debug-toolbar-6.3.0`
 *
 * Splitting on the last hyphen that precedes a digit sequence handles packages
 * with hyphens in their names (e.g. `django-debug-toolbar-6.3.0`).
 *
 * Returns a Map of lowercase-normalized package name → installed version.
 * Returns an empty Map when the line is absent or unparseable.
 */
export function parsePipInstalledVersions(stdout: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('Successfully installed ')) continue;

    const tokens = trimmed.slice('Successfully installed '.length).split(/\s+/);
    for (const token of tokens) {
      // Find the last hyphen that is immediately followed by a digit
      const match = token.match(/^(.*)-(\d[\d.]*)$/);
      if (!match) continue;
      const name = match[1]!.toLowerCase();
      const version = match[2]!;
      if (name) {
        result.set(name, version);
      }
    }
    break; // Only one "Successfully installed" line expected
  }
  return result;
}

/**
 * Build the `packages_updated` array for pip using installed versions from pip stdout.
 *
 * For each auto_safe package (e.g. "pillow==8.0.1"), look up the name in the
 * installed-versions map and use the real installed version. Falls back to the
 * scan's safeVersion when the package is not found in the map.
 *
 * Returns an empty array when `installedVersions` is empty (nothing was installed).
 */
export function buildPipPackagesUpdated(
  autoSafePackages: string[],
  installedVersions: Map<string, string>,
): string[] {
  if (installedVersions.size === 0) return [];

  const updated: string[] = [];
  for (const pkg of autoSafePackages) {
    const name = stripPipVersion(pkg).toLowerCase();
    const installedVersion = installedVersions.get(name);
    if (installedVersion !== undefined) {
      // Use the real installed version
      updated.push(`${name}@${installedVersion}`);
    } else {
      // Fallback: extract safeVersion from scan string (e.g. "pillow==8.0.1" → "pillow@8.0.1")
      const versionMatch = pkg.match(/==([^\s,;]+)/);
      const safeVersion = versionMatch ? versionMatch[1] : undefined;
      if (safeVersion) {
        updated.push(`${name}@${safeVersion}`);
      } else {
        updated.push(name);
      }
    }
  }
  return updated;
}

/**
 * Parse pip-audit --fix JSON output.
 *
 * pip-audit JSON structure:
 *   { fixes?: Array<{ name?: string; version?: string; fix_version?: string; is_skipped?: boolean }> }
 *
 * Returns 'name@fix_version' (lowercase name) for each entry where:
 *   - is_skipped is falsy
 *   - fix_version is present and non-empty
 *
 * Returns empty array on parse failure, missing fixes array, or any unexpected shape.
 */
function parseSingleFixEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const fix = entry as Record<string, unknown>;
  if (fix['is_skipped']) return null;
  const name = typeof fix['name'] === 'string' ? fix['name'].toLowerCase() : undefined;
  const fixVersion = typeof fix['fix_version'] === 'string' ? fix['fix_version'] : undefined;
  if (name && fixVersion) return `${name}@${fixVersion}`;
  return null;
}

export function parsePipAuditFixJson(stdout: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object') return [];

    const obj = parsed as Record<string, unknown>;
    const fixes = obj['fixes'];
    if (!Array.isArray(fixes)) return [];

    return fixes.map(parseSingleFixEntry).filter((r): r is string => r !== null);
  } catch {
    return [];
  }
}

/**
 * Rewrite requirements.txt on disk after a successful pip install.
 * No-op when installedVersions is empty or the file cannot be read.
 */
async function rewriteRequirementsTxt(
  cwd: string,
  installedVersions: Map<string, string>,
): Promise<void> {
  if (installedVersions.size === 0) return;

  const filePath = resolve(cwd, 'requirements.txt');
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    logger.debug('requirements.txt not found — skipping rewrite');
    return;
  }

  const updated = updateRequirementsContent(content, installedVersions);
  if (updated !== content) {
    await writeFile(filePath, updated, 'utf-8');
    logger.debug('requirements.txt rewritten with installed versions');
  }
}

/**
 * Check if pip-audit is available in the runner environment.
 * Returns true when pip-audit --version exits 0.
 */
async function isPipAuditAvailable(runner: CommandRunner, cwd: string): Promise<boolean> {
  try {
    const result = await runner.runArgs('pip-audit', ['--version'], { cwd });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Run pip-audit --fix -r requirements.txt --format json.
 *
 * pip-audit exits 1 when some vulnerabilities remain unfixed after a partial fix.
 * This is treated as partial success when stdout contains parseable JSON.
 */
async function applyPipAudit(
  runner: CommandRunner,
  cwd: string,
): Promise<{ ok: true; value: PipFixerResult } | { ok: false; error: string }> {
  const result = await runner.runArgs(
    'pip-audit',
    ['--fix', '-r', 'requirements.txt', '--format', 'json'],
    { cwd, stream: true },
  );

  const stdout = result.stdout ?? '';

  // Exit 0 = all fixed. Exit 1 with JSON stdout = partial fix (some vulns remain).
  if (result.exitCode === 0 || (result.exitCode === 1 && stdout.trim().startsWith('{'))) {
    return { ok: true, value: { mode: 'pip-audit', stdout } };
  }

  return { ok: false, error: `pip-audit --fix failed: ${result.stderr ?? ''}` };
}

/**
 * Fallback path: run pip install with version-pinned specs from auto_safe_packages.
 * Uses exact versions from OSV scan data (e.g. 'pillow==9.5.0') instead of -U bare names.
 */
async function applyPipInstall(
  runner: CommandRunner,
  cwd: string,
  packageSpecs: string[],
): Promise<{ ok: true; value: PipFixerResult } | { ok: false; error: string }> {
  const pkgList = packageSpecs.join(' ');
  logger.info(`Updating packages: ${pkgList}`);
  // SEC: use runArgs (shell: false) — package specs from scanner are variable data
  const updateResult = await runner.runArgs(
    'pip',
    ['install', ...packageSpecs],
    { cwd, stream: true },
  );

  if (updateResult.exitCode !== 0) {
    logger.error('pip install failed — reverting pip changes...');
    return { ok: false, error: `pip install failed: ${updateResult.stderr}` };
  }

  return { ok: true, value: { mode: 'pip-install', stdout: updateResult.stdout ?? '' } };
}

async function applyPoetryUpdate(
  runner: CommandRunner,
  cwd: string,
  packageNames: string[],
): Promise<{ ok: true; value: PipFixerResult } | { ok: false; error: string }> {
  logger.info(`Updating packages via poetry: ${packageNames.join(' ')}`);
  const result = await runner.runArgs(
    'poetry',
    ['update', ...packageNames, '--no-interaction'],
    { cwd, stream: true },
  );
  if (result.exitCode !== 0) {
    return { ok: false, error: `poetry update failed: ${result.stderr ?? ''}` };
  }
  return { ok: true, value: { mode: 'pip-install', stdout: result.stdout ?? '' } };
}

async function applyUvUpdate(
  runner: CommandRunner,
  cwd: string,
  specs: string[],
): Promise<{ ok: true; value: PipFixerResult } | { ok: false; error: string }> {
  logger.info(`Updating packages via uv: ${specs.join(' ')}`);
  const envVars = pickRegistryEnvVars();
  const env = Object.keys(envVars).length > 0 ? envVars : undefined;
  const result = await runner.runArgs(
    'uv',
    ['pip', 'install', ...specs],
    { cwd, stream: true, env },
  );
  if (result.exitCode !== 0) {
    return { ok: false, error: `uv pip install failed: ${result.stderr ?? ''}` };
  }
  return { ok: true, value: { mode: 'pip-install', stdout: result.stdout ?? '' } };
}

async function applyPipenvUpdate(
  runner: CommandRunner,
  cwd: string,
  specs: string[],
): Promise<{ ok: true; value: PipFixerResult } | { ok: false; error: string }> {
  logger.info(`Updating packages via pipenv: ${specs.join(' ')}`);
  const result = await runner.runArgs(
    'pipenv',
    ['install', ...specs],
    { cwd, stream: true },
  );
  if (result.exitCode !== 0) {
    return { ok: false, error: `pipenv install failed: ${result.stderr ?? ''}` };
  }
  return { ok: true, value: { mode: 'pip-install', stdout: result.stdout ?? '' } };
}

async function applyPdmUpdate(
  runner: CommandRunner,
  cwd: string,
  packageNames: string[],
): Promise<{ ok: true; value: PipFixerResult } | { ok: false; error: string }> {
  logger.info(`Updating packages via pdm: ${packageNames.join(' ')}`);
  const result = await runner.runArgs(
    'pdm',
    ['update', ...packageNames, '--no-isolation'],
    { cwd, stream: true },
  );
  if (result.exitCode !== 0) {
    return { ok: false, error: `pdm update failed: ${result.stderr ?? ''}` };
  }
  return { ok: true, value: { mode: 'pip-install', stdout: result.stdout ?? '' } };
}

async function applyPipToolsUpdate(
  runner: CommandRunner,
  cwd: string,
  specs: string[],
): Promise<{ ok: true; value: PipFixerResult } | { ok: false; error: string }> {
  logger.info(`Updating packages via pip-tools: ${specs.join(' ')}`);
  const upgradeArgs = specs.map((s) => `--upgrade-package=${s}`);
  const compileResult = await runner.runArgs(
    'pip-compile',
    [...upgradeArgs, '-o', 'requirements.txt', 'requirements.in'],
    { cwd, stream: true },
  );
  if (compileResult.exitCode !== 0) {
    return { ok: false, error: `pip-compile failed: ${compileResult.stderr ?? ''}` };
  }
  const syncResult = await runner.runArgs(
    'pip-sync',
    ['requirements.txt'],
    { cwd, stream: true },
  );
  if (syncResult.exitCode !== 0) {
    return { ok: false, error: `pip-sync failed: ${syncResult.stderr ?? ''}` };
  }
  return { ok: true, value: { mode: 'pip-install', stdout: syncResult.stdout ?? '' } };
}

async function applyToolingFix(
  runner: CommandRunner,
  cwd: string,
  detection: PipToolingDetection,
  packageNames: string[],
  specs: string[],
): Promise<{ ok: true; value: PipFixerResult } | { ok: false; error: string }> {
  try {
    switch (detection.tooling) {
      case 'poetry': return await applyPoetryUpdate(runner, cwd, packageNames);
      case 'uv': return await applyUvUpdate(runner, cwd, specs);
      case 'pipenv': return await applyPipenvUpdate(runner, cwd, specs);
      case 'pdm': return await applyPdmUpdate(runner, cwd, packageNames);
      case 'pip-tools': return await applyPipToolsUpdate(runner, cwd, specs);
      default: return await applyPipInstall(runner, cwd, specs);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      logger.warn(`${detection.tooling} not available — falling back to pip install`);
      return applyPipInstall(runner, cwd, specs);
    }
    throw err;
  }
}

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
 * Validate a list of version-pinned pip specs using --dry-run before the actual install.
 *
 * Fast path: batch dry-run. If all pass, return them all as validated.
 * Slow path: per-package dry-run + fallback version tries when batch fails.
 * Graceful degradation: if pip does not support --dry-run, return all as validated.
 */
async function validatePipSpecs(
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

  return { validated, skipped };
}

export async function runPipUpdater(
  runner: CommandRunner,
  _config: unknown,
  scanResult: ScanResultJson,
  cwd: string,
  authorizeBreaking = false,
  validationCommands: ValidationCommandConfig[] = [],
  _fixerStrategy: FixerStrategyId = 'osv',
  preFixBackups?: Map<string, string>,
  osvFixOutcome?: OsvFixOutcome,
  preRunSnapshots?: Map<string, string>,
  _advisorResults?: AdvisorResult[],
  ecosystemKey = 'pip',
  detection?: PipToolingDetection,
): Promise<UpdateResultJson> {
  logger.info('Running pip safe updates...');

  const pipEcosystem = scanResult.ecosystems[ecosystemKey] ?? emptyEcosystem();

  const autoSafePackageNames = pipEcosystem.auto_safe_packages.map(stripPipVersion);
  const breakingPackageNames = authorizeBreaking
    ? pipEcosystem.breaking_packages.map(stripPipVersion)
    : [];
  const packageNamesToUpdate = [...new Set([...autoSafePackageNames, ...breakingPackageNames])];

  // Compute MAX safe versions per package from the vulnerabilities array
  const classifications = new Set<VulnerabilityClass>(
    authorizeBreaking ? ['auto_safe', 'breaking'] : ['auto_safe'],
  );
  const maxSafeVersions = computeMaxSafeVersions(pipEcosystem.vulnerabilities, classifications);
  const sortedSafeVersions = computeSortedSafeVersions(pipEcosystem.vulnerabilities, classifications);

  // Build the list of all package entries (auto_safe + optionally breaking) for fallback
  const allPackageEntries = [
    ...pipEcosystem.auto_safe_packages,
    ...(authorizeBreaking ? pipEcosystem.breaking_packages : []),
  ];

  // Version-pinned specs for pip install (e.g. 'pillow==9.5.0') — no -U flag.
  // Primary: use computeMaxSafeVersions result (picks max safeVersion across all vulns).
  // Fallback: toPipInstallSpec from scan entry string (for backward compat when vulnerabilities[] is empty).
  const packageSpecsToInstall = [
    ...new Set(
      packageNamesToUpdate.map((pkgName) => {
        const maxSafeVersion = maxSafeVersions.get(pkgName);
        if (maxSafeVersion !== undefined) {
          return `${pkgName}==${maxSafeVersion}`;
        }
        // Fallback: find the original scan entry and convert it
        const entry = allPackageEntries.find(
          (e) => stripPipVersion(e).toLowerCase() === pkgName,
        );
        return entry !== undefined ? toPipInstallSpec(entry) : pkgName;
      }),
    ),
  ];

  const backupFiles = resolveBackupFiles(detection);
  const revertSpec = resolveBootstrapSpec(detection);

  return runUpdaterLifecycle<PipFixerResult>(
    {
      agentName: 'pip-safe-update',
      ecosystemKey,
      backupPaths: backupFiles,
      bootstrapSpec: revertSpec,

      async probe(ctx) {
        if (packageNamesToUpdate.length === 0) {
          return {
            $schema: 'osv-update-result/v1',
            agent: 'pip-safe-update',
            status: 'success',
            packages_updated: [],
            packages_skipped: [],
            packages_pending_breaking: pipEcosystem.breaking_packages,
            validations: [{ name: 'validation', status: 'skipped', detail: 'No packages to update' }],
            error: null,
          };
        }
        if (ctx.runner.dryRun) {
          logger.tagged('pip', 'DRY-RUN', `Would execute: pip install ${packageSpecsToInstall.join(' ')}`);
          for (const vc of validationCommands) {
            logger.tagged('pip', 'DRY-RUN', `Would execute: ${vc.command}`);
          }
        }
        return null;
      },

      async applyFix(ctx) {
        // Non-bare-pip tooling: route to native tool, skip pip-audit
        if (detection && detection.tooling !== 'bare-pip') {
          const result = await applyToolingFix(
            ctx.runner, ctx.cwd, detection, packageNamesToUpdate, packageSpecsToInstall,
          );
          if (result.ok && detection.tooling === 'uv') {
            // uv pip install does not rewrite requirements.txt automatically
            const installedVersions = parsePipInstalledVersions(result.value.stdout);
            await rewriteRequirementsTxt(ctx.cwd, installedVersions);
          }
          return result;
        }

        const pipAuditAvailable = await isPipAuditAvailable(ctx.runner, ctx.cwd);

        if (pipAuditAvailable) {
          logger.info('pip-audit available — using pip-audit --fix for vulnerability remediation');
          return applyPipAudit(ctx.runner, ctx.cwd);
        }

        logger.info('pip-audit not available — falling back to pip install (version-pinned)');

        let specsToInstall = packageSpecsToInstall;

        // Only run dry-run validation when we have vulnerability data with fallback versions.
        // Without sortedSafeVersions entries, there are no alternatives to try, so validation
        // adds no value over the install itself.
        if (sortedSafeVersions.size > 0) {
          const { validated, skipped } = await validatePipSpecs(
            ctx.runner,
            ctx.cwd,
            packageSpecsToInstall,
            sortedSafeVersions,
          );

          for (const s of skipped) {
            logger.warn(`Skipping ${s.pkg}: ${s.reason}`);
          }

          if (validated.length === 0) {
            return { ok: false, error: 'All package specs failed dry-run validation' };
          }

          specsToInstall = validated;
        }

        const installResult = await applyPipInstall(ctx.runner, ctx.cwd, specsToInstall);

        if (installResult.ok) {
          // Rewrite requirements.txt with the installed versions (pip install does not do this)
          const installedVersions = parsePipInstalledVersions(installResult.value.stdout);
          await rewriteRequirementsTxt(ctx.cwd, installedVersions);
        }

        return installResult;
      },

      async derivePackagesUpdated(_ctx, fixerResult) {
        let packages: string[];
        if (fixerResult.mode === 'pip-audit') {
          packages = parsePipAuditFixJson(fixerResult.stdout);
        } else {
          const installedVersions = parsePipInstalledVersions(fixerResult.stdout);
          packages = buildPipPackagesUpdated(pipEcosystem.auto_safe_packages, installedVersions);
        }
        return mergeOsvFirstWins(osvFixOutcome, packages);
      },
    },
    { runner, cwd, scanResult, ecosystemId: ecosystemKey, validationCommands, authorizeBreaking },
    { preFixBackups, preRunSnapshots },
  );
}
