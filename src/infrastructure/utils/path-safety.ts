import { isAbsolute, resolve, relative } from 'node:path';

import { ConfigLoadError } from '@core/errors';

/**
 * Validates that `relPath` is a safe relative lockfile path that stays within
 * the project `cwd` directory. Rejects absolute paths, path-traversal attempts
 * (any `..` segment that would escape `cwd`), and empty/whitespace-only strings.
 *
 * Returns the validated `relPath` unchanged when it is safe.
 * Throws `ConfigLoadError` with an actionable message when it is not.
 *
 * @param relPath  - the lockfile path to validate (from config or plugin default)
 * @param cwd      - the project root directory (must be an absolute path)
 * @returns the validated `relPath`
 */
export function assertLockfilePathWithinCwd(relPath: string, cwd: string): string {
  if (!relPath || !relPath.trim()) {
    throw new ConfigLoadError(
      `Invalid lockfile path: path must not be empty or whitespace-only.`,
      relPath,
    );
  }

  if (isAbsolute(relPath)) {
    throw new ConfigLoadError(
      `Invalid lockfile path "${relPath}": path must be relative to the project directory, not absolute.`,
      relPath,
    );
  }

  const resolved = resolve(cwd, relPath);
  const rel = relative(resolve(cwd), resolved);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ConfigLoadError(
      `Invalid lockfile path "${relPath}": path must not escape the project directory. ` +
        `Resolved to "${resolved}" which is outside "${cwd}".`,
      relPath,
    );
  }

  return relPath;
}
