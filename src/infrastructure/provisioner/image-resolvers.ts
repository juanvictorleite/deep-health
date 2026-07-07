import { COMPOSER_DEFAULT_IMAGE } from './php-profiles';

/**
 * Default Node.js Docker image used when no specific Node version is configured or inferred.
 * Uses the full LTS image for broad compatibility including native modules (node-gyp).
 */
export const NPM_DEFAULT_IMAGE = 'node:lts';

/**
 * Default Python Docker image used when no specific Python version is configured or inferred.
 */
export const PIP_DEFAULT_IMAGE = 'python:3-slim';

/**
 * Declarative shape of one ecosystem's image-resolution rule: the base image
 * name, the tag suffix, how many leading numeric version segments to keep,
 * and the fallback image when no usable version is available.
 */
interface EcosystemImageSpec {
  readonly image: string;
  readonly suffix: string;
  readonly maxSegments: number;
  readonly default: string;
}

// One row per ecosystem — the entire resolution difference between npm, pip,
// and composer is data, not branching logic (ADR 0007).
const ECOSYSTEM_IMAGE_TABLE: Record<string, EcosystemImageSpec> = {
  npm: { image: 'node', suffix: '', maxSegments: 1, default: NPM_DEFAULT_IMAGE },
  pip: { image: 'python', suffix: '-slim', maxSegments: 2, default: PIP_DEFAULT_IMAGE },
  composer: { image: 'php', suffix: '-cli', maxSegments: 2, default: COMPOSER_DEFAULT_IMAGE },
};

/**
 * Take up to `maxSegments` leading numeric dot-segments from `version`,
 * stopping at the first non-numeric segment.
 */
function parseNumericSegments(version: string, maxSegments: number): string[] {
  const segments: string[] = [];
  for (const part of version.trim().split('.')) {
    if (!/^\d+$/.test(part)) break;
    segments.push(part);
    if (segments.length === maxSegments) break;
  }
  return segments;
}

/**
 * Resolve the Docker image to use for a given ecosystem and version hint.
 *
 * @param ecosystemId - One of the registered ecosystem ids (`'npm'`, `'pip'`, `'composer'`).
 * @param version - Inferred/configured version string (e.g. "20.11.1", "3.11", "8.2.1").
 *   When undefined or empty, falls back to the ecosystem's default image.
 * @returns Docker image name, e.g. `'node:20'`, `'python:3.11-slim'`, `'php:8.2-cli'`.
 * @throws {Error} When `ecosystemId` is not a registered ecosystem — a programming
 *   error, not a config error.
 *
 * @example
 * resolveEcosystemImage('npm', '20.11.1')      // → 'node:20'
 * resolveEcosystemImage('pip', '3.11.2')       // → 'python:3.11-slim'
 * resolveEcosystemImage('composer', '8.2.1')   // → 'php:8.2-cli'
 * resolveEcosystemImage('npm', undefined)      // → 'node:lts'
 */
export function resolveEcosystemImage(ecosystemId: string, version?: string): string {
  const spec = ECOSYSTEM_IMAGE_TABLE[ecosystemId];
  if (!spec) {
    throw new Error(`resolveEcosystemImage: unknown ecosystem id "${ecosystemId}"`);
  }

  if (!version || !version.trim()) return spec.default;

  const segments = parseNumericSegments(version, spec.maxSegments);
  if (segments.length === 0) return spec.default;

  return `${spec.image}:${segments.join('.')}${spec.suffix}`;
}
