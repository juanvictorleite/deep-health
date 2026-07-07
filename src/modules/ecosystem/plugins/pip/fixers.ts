import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CommandRunner } from '@core/types/common';
import { logger } from '@infra/utils/logger';

import { updateRequirementsContent } from './transforms';

/** Typed result from applyFix — discriminates pip-audit vs pip-install path. */
export type PipFixerResult =
  | { mode: 'pip-audit'; stdout: string }
  | { mode: 'pip-install'; stdout: string };

/**
 * Rewrite requirements.txt on disk after a successful pip install.
 * No-op when installedVersions is empty or the file cannot be read.
 */
export async function rewriteRequirementsTxt(
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
export async function isPipAuditAvailable(runner: CommandRunner, cwd: string): Promise<boolean> {
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
export async function applyPipAudit(
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
export async function applyPipInstall(
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
