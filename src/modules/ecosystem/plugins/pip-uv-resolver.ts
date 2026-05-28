import { execFile as execFileCb } from 'node:child_process';
import { resolve } from 'node:path';
import { logger } from '@infra/utils/logger';
import { parseViaAnnotations } from './pip-dep-graph';
import type { PythonDependencyGraph } from './pip-dep-graph';

const UV_REGISTRY_ENV_KEYS = [
  'UV_INDEX_URL',
  'PIP_INDEX_URL',
  'PIP_EXTRA_INDEX_URL',
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

function execAsync(
  cmd: string,
  args: string[],
  cwd?: string,
  timeout = 30_000,
  env?: Record<string, string>,
): Promise<string> {
  return new Promise((res, rej) => {
    const opts: { cwd?: string; timeout: number; env?: NodeJS.ProcessEnv } = { timeout };
    if (cwd) opts.cwd = cwd;
    if (env && Object.keys(env).length > 0) {
      opts.env = { ...process.env, ...env };
    }
    execFileCb(cmd, args, opts, (err, stdout) => {
      if (err) rej(err);
      else res(typeof stdout === 'string' ? stdout : '');
    });
  });
}

export async function checkUvAvailable(): Promise<string | undefined> {
  try {
    const path = (await execAsync('which', ['uv'], undefined, 5_000)).trim();
    if (!path) return undefined;
    await execAsync(path, ['--version'], undefined, 5_000);
    return path;
  } catch {
    return undefined;
  }
}

function buildUvCompileArgs(requirementsTxt: string, pythonVersion?: string): string[] {
  const args = ['pip', 'compile', requirementsTxt, '--no-header'];
  if (!pythonVersion) return args;

  const [major, minor] = pythonVersion.split('.').map(Number);
  if (major !== undefined && minor !== undefined && (major < 3 || (major === 3 && minor < 8))) {
    logger.warn(
      `Python version ${pythonVersion} < 3.8 detected; uv pip compile resolution is best-effort`,
    );
  }
  args.push(`--python-version=${pythonVersion}`);
  return args;
}

export async function resolveWithUv(
  cwd: string,
  pythonVersion?: string,
): Promise<PythonDependencyGraph | undefined> {
  const uvPath = await checkUvAvailable();
  if (!uvPath) return undefined;

  const requirementsTxt = resolve(cwd, 'requirements.txt');
  const args = buildUvCompileArgs(requirementsTxt, pythonVersion);
  const registryEnv = pickRegistryEnvVars();

  try {
    const stdout = await execAsync(uvPath, args, cwd, 30_000, registryEnv);
    return parseViaAnnotations(stdout);
  } catch (firstErr) {
    logger.debug('uv pip compile failed; retrying with --no-build');
    try {
      const stdout = await execAsync(uvPath, [...args, '--no-build'], cwd, 30_000, registryEnv);
      return parseViaAnnotations(stdout);
    } catch (retryErr) {
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      logger.warn(`uv pip compile failed; skipping dependency graph resolution: ${msg}`);
      return undefined;
    }
  }
}
