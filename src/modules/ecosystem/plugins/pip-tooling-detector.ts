import { access, constants } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readTextFile } from '@infra/utils/infer-version';
import { hasViaAnnotations } from './pip-dep-graph';

export interface PipToolingDetection {
  tier: 1 | 2 | 3;
  tooling: 'poetry' | 'uv' | 'pipenv' | 'pdm' | 'pip-tools' | 'bare-pip';
  lockfile?: string;
  manifest: string;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectPipTooling(cwd: string): Promise<PipToolingDetection> {
  const manifest = resolve(cwd, 'requirements.txt');

  // Tier 1: lockfile-based tooling
  const tier1Checks: Array<{ file: string; tooling: PipToolingDetection['tooling'] }> = [
    { file: 'uv.lock', tooling: 'uv' },
    { file: 'poetry.lock', tooling: 'poetry' },
    { file: 'pdm.lock', tooling: 'pdm' },
    { file: 'Pipfile.lock', tooling: 'pipenv' },
  ];

  for (const { file, tooling } of tier1Checks) {
    const lockfilePath = resolve(cwd, file);
    if (await fileExists(lockfilePath)) {
      return {
        tier: 1,
        tooling,
        lockfile: lockfilePath,
        manifest,
      };
    }
  }

  // Tier 2: pip-tools (requirements.in + '# via' annotations in requirements.txt)
  const requirementsIn = resolve(cwd, 'requirements.in');
  if (await fileExists(requirementsIn)) {
    const reqContent = await readTextFile(manifest);
    if (reqContent !== undefined && hasViaAnnotations(reqContent)) {
      return {
        tier: 2,
        tooling: 'pip-tools',
        manifest,
      };
    }
  }

  // Tier 3: bare-pip
  if (!(await fileExists(manifest))) {
    throw new Error(`No requirements.txt found in ${cwd}`);
  }

  return {
    tier: 3,
    tooling: 'bare-pip',
    manifest,
  };
}
