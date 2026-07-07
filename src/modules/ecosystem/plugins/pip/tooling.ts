import { basename } from 'node:path';

import type { CommandRunner } from '@core/types/common';
import { logger } from '@infra/utils/logger';

import type { PipToolingDetection } from '../pip-tooling-detector';
import { applyPipInstall } from './fixers';
import type { PipFixerResult } from './fixers';

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

export async function applyToolingFix(
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
