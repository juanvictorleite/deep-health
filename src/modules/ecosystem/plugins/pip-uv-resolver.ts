import { execFile as execFileCb } from 'node:child_process';
import { resolve } from 'node:path';
import { logger } from '@infra/utils/logger';
import { parseViaAnnotations } from './pip-dep-graph';
import type { PythonDependencyGraph } from './pip-dep-graph';

function execAsync(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((res, rej) => {
    const opts = cwd ? { cwd } : {};
    execFileCb(cmd, args, opts, (err, stdout) => {
      if (err) rej(err);
      else res(typeof stdout === 'string' ? stdout : '');
    });
  });
}

export async function checkUvAvailable(): Promise<string | undefined> {
  try {
    const path = (await execAsync('which', ['uv'])).trim();
    if (!path) return undefined;
    await execAsync(path, ['--version']);
    return path;
  } catch {
    return undefined;
  }
}

function buildUvCompileArgs(requirementsTxt: string, pythonVersion?: string): string[] {
  const args = ['pip', 'compile', requirementsTxt, '--output-file=-', '--no-header'];
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
  try {
    const uvPath = await checkUvAvailable();
    if (!uvPath) return undefined;

    const requirementsTxt = resolve(cwd, 'requirements.txt');
    const args = buildUvCompileArgs(requirementsTxt, pythonVersion);
    const stdout = await execAsync(uvPath, args, cwd);
    return parseViaAnnotations(stdout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`uv pip compile failed; skipping dependency graph resolution: ${msg}`);
    return undefined;
  }
}
