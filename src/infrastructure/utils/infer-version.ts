import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * A declarative version source descriptor.
 *
 * Each source points to a file relative to the ecosystem directory and
 * provides a pure extraction function that parses the file content.
 */
export interface VersionSource {
  /** File path relative to the ecosystem directory (e.g. '.python-version') */
  file: string;
  /**
   * Pure extraction function. Given the trimmed file content, returns a version
   * string or undefined when the content is not parseable or not useful.
   * Must never throw.
   */
  extract: (content: string) => string | undefined;
  /** Human-readable label for debug/logging (e.g. '.python-version') */
  label: string;
}

/**
 * Read a UTF-8 text file and return its trimmed contents, or undefined on any error.
 * Exported so callers can use it directly for file reading without duplicating error handling.
 */
export async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return (content as string).trim();
  } catch {
    return undefined;
  }
}

/**
 * Iterate through `sources` in order and return the first version that can be
 * successfully extracted.
 *
 * For each source:
 * 1. Reads `resolve(cwd, source.file)` via `readTextFile`.
 * 2. If content is available, calls `source.extract(content)`.
 * 3. Returns the first non-undefined result.
 *
 * Returns undefined when no source yields a version. Never throws.
 */
export async function inferVersionFromSources(
  cwd: string,
  sources: VersionSource[],
): Promise<string | undefined> {
  for (const source of sources) {
    const content = await readTextFile(resolve(cwd, source.file));
    if (content !== undefined) {
      const version = source.extract(content);
      if (version !== undefined) return version;
    }
  }
  return undefined;
}
