import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * A script detected from the project's package manager manifest.
 */
export interface DetectedScript {
  name: string;
  command: string;
  /** True when the script name matches common validation patterns (test, build, lint, etc.). */
  recommended: boolean;
}

/**
 * Script names that are development servers or lifecycle hooks — not suitable
 * for use as validation commands.
 */
const EXCLUDED_SCRIPTS = new Set([
  'dev',
  'start',
  'serve',
  'watch',
  'preview',
  'prepare',
  'postinstall',
  'preinstall',
]);

/**
 * Script name patterns that indicate a validation command.
 * Matched as full name or as substring via startsWith/includes.
 */
const RECOMMENDED_PATTERNS = ['test', 'build', 'lint', 'check', 'typecheck', 'ci', 'verify'];

function isRecommended(name: string): boolean {
  const lower = name.toLowerCase();
  return RECOMMENDED_PATTERNS.some(
    (pattern) => lower === pattern || lower.startsWith(pattern + ':') || lower.includes(':' + pattern),
  );
}

/**
 * npm has special built-in commands for some script names.
 * "npm test" is the canonical short form of "npm run test".
 */
const NPM_BUILT_IN_SHORT_FORMS = new Set(['test', 'start', 'stop', 'restart']);

function formatNpmCommand(scriptName: string): string {
  if (NPM_BUILT_IN_SHORT_FORMS.has(scriptName)) {
    return `npm ${scriptName}`;
  }
  return `npm run ${scriptName}`;
}

function formatComposerCommand(scriptName: string): string {
  return `composer run-script ${scriptName}`;
}

/**
 * Detects scripts from the project's package manager manifest and returns
 * them as an array of DetectedScript objects.
 *
 * Supports:
 * - npm: reads package.json#scripts
 * - composer: reads composer.json#scripts
 * - pip and unknown ecosystems: returns []
 *
 * Scripts in EXCLUDED_SCRIPTS are omitted from the result.
 * The `recommended` flag is set for scripts matching common validation patterns.
 *
 * Never throws — returns [] on any error (file not found, parse error, etc.).
 */
export async function detectProjectScripts(
  cwd: string,
  ecosystemId: string,
): Promise<DetectedScript[]> {
  if (ecosystemId === 'npm') {
    return detectNpmScripts(cwd);
  }

  if (ecosystemId === 'composer') {
    return detectComposerScripts(cwd);
  }

  // pip and all other ecosystems: no standardised scripts mechanism
  return [];
}

async function detectNpmScripts(cwd: string): Promise<DetectedScript[]> {
  try {
    const raw = await readFile(resolve(cwd, 'package.json'), 'utf-8');
    const pkg: unknown = JSON.parse(raw as string);

    if (
      pkg === null ||
      typeof pkg !== 'object' ||
      !('scripts' in pkg) ||
      typeof (pkg as Record<string, unknown>)['scripts'] !== 'object' ||
      (pkg as Record<string, unknown>)['scripts'] === null
    ) {
      return [];
    }

    const scripts = (pkg as Record<string, unknown>)['scripts'] as Record<string, unknown>;
    const result: DetectedScript[] = [];

    for (const [name, value] of Object.entries(scripts)) {
      if (typeof value !== 'string') continue;
      if (EXCLUDED_SCRIPTS.has(name)) continue;

      result.push({
        name,
        command: formatNpmCommand(name),
        recommended: isRecommended(name),
      });
    }

    return result;
  } catch {
    return [];
  }
}

async function detectComposerScripts(cwd: string): Promise<DetectedScript[]> {
  try {
    const raw = await readFile(resolve(cwd, 'composer.json'), 'utf-8');
    const pkg: unknown = JSON.parse(raw as string);

    if (
      pkg === null ||
      typeof pkg !== 'object' ||
      !('scripts' in pkg) ||
      typeof (pkg as Record<string, unknown>)['scripts'] !== 'object' ||
      (pkg as Record<string, unknown>)['scripts'] === null
    ) {
      return [];
    }

    const scripts = (pkg as Record<string, unknown>)['scripts'] as Record<string, unknown>;
    const result: DetectedScript[] = [];

    for (const [name, value] of Object.entries(scripts)) {
      // composer.json scripts can be a string or an array of strings
      if (typeof value !== 'string' && !Array.isArray(value)) continue;
      if (EXCLUDED_SCRIPTS.has(name)) continue;

      result.push({
        name,
        command: formatComposerCommand(name),
        recommended: isRecommended(name),
      });
    }

    return result;
  } catch {
    return [];
  }
}
