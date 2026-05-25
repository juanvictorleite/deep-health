/**
 * Shared config fixture helpers for unit and integration tests.
 *
 * Provides:
 *  - `minimalConfigJson` — a valid minimal security-scan.config.json object (as string)
 *  - `minimalConfigYaml` — alias kept for backward compatibility (returns JSON now)
 *  - `withTempConfig(content, fn)` — writes a uniquely named temp .json file, runs `fn`, then cleans up
 *  - `minimalConfigWith(overrides)` — builds a minimal JSON string with extra top-level fields merged in
 */

import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** Minimal valid config object used as the base for all fixtures. */
const MINIMAL_CONFIG_OBJ = {
  config_version: '1',
  project: { name: 'test', client: 'test' },
  ecosystems: [{ id: 'npm' }],
  protected_packages: {},
  safe_update_policy: {
    allow_patch_and_minor_within_constraints: true,
    require_authorization_for_constraint_change: false,
  },
  conflict_resolution: 'fail',
};

/**
 * A minimal valid security-scan.config.json JSON string with a single npm ecosystem.
 */
export const minimalConfigJson: string = JSON.stringify(MINIMAL_CONFIG_OBJ, null, 2) + '\n';

/**
 * Backward-compatible alias — callers that imported minimalConfigYaml now receive
 * JSON content. The loader now parses JSON, so this is transparent.
 */
export const minimalConfigYaml: string = minimalConfigJson;

/**
 * Builds a minimal valid config JSON string with extra top-level fields merged in.
 *
 * @param extra - Additional fields as a JSON object string appended as top-level keys.
 *                For simple string fields (e.g. `'unknown_top_key: oops'` YAML-style),
 *                callers should instead pass an object to `minimalConfigWithObj`.
 *
 * NOTE: `extra` is treated as a raw JSON object string and merged at the top level.
 * Use `minimalConfigWithObj` for structured merges.
 */
export function minimalConfigWith(extraJson: string): string {
  // Parse the minimal base
  const base = { ...MINIMAL_CONFIG_OBJ } as Record<string, unknown>;

  // Parse the extra JSON fragment
  let extraObj: Record<string, unknown>;
  try {
    extraObj = JSON.parse(extraJson) as Record<string, unknown>;
  } catch {
    // If the extra is not valid JSON on its own, treat it as a literal top-level
    // field string in `key: value` format (legacy YAML-style callers).
    // We convert simple `key: value` patterns for backward compat.
    extraObj = parseLegacyYamlLike(extraJson);
  }

  const merged = { ...base, ...extraObj };
  return JSON.stringify(merged, null, 2) + '\n';
}

/**
 * Merges extra fields (as a plain object) into the minimal base config.
 */
export function minimalConfigWithObj(extra: Record<string, unknown>): string {
  const base = { ...MINIMAL_CONFIG_OBJ } as Record<string, unknown>;
  const merged = { ...base, ...extra };
  return JSON.stringify(merged, null, 2) + '\n';
}

/**
 * Very limited YAML-style `key: value` parser for backward compat with test
 * callers that used to pass YAML snippets to minimalConfigWith.
 *
 * Handles only simple single-depth patterns like:
 *   `unknown_top_key: oops`
 *   `scanners:\n  osv:\n    runner: docker`
 *
 * For complex nested structures use `minimalConfigWithObj` instead.
 */
function parseLegacyYamlLike(raw: string): Record<string, unknown> {
  // Very naive approach: try to handle the test cases that relied on YAML strings.
  // The tests that pass YAML snippets to minimalConfigWith in loader.test.ts now
  // pass JSON objects directly, so this fallback path is only for any remaining
  // callers not yet migrated.
  const result: Record<string, unknown> = {};
  const firstLine = raw.trim().split('\n')[0] ?? '';
  const colonIdx = firstLine.indexOf(':');
  if (colonIdx > 0) {
    const key = firstLine.slice(0, colonIdx).trim();
    const val = firstLine.slice(colonIdx + 1).trim();
    result[key] = val || {};
  }
  return result;
}

/**
 * Writes a uniquely named temp config file (.json) to the OS temp directory,
 * runs the provided callback with the absolute path and filename,
 * then unconditionally deletes the file (even on error).
 *
 * Parallel-safe: uses `randomUUID()` to prevent filename collisions.
 *
 * @param content - JSON content to write
 * @param fn      - Callback receiving `(absolutePath: string, filename: string)`
 */
export async function withTempConfig<T>(
  content: string,
  fn: (absolutePath: string, filename: string) => Promise<T>,
): Promise<T> {
  const filename = `_temp_cfg_${randomUUID().replace(/-/g, '_')}.json`;
  const absolutePath = resolve(tmpdir(), filename);
  await writeFile(absolutePath, content, 'utf-8');
  try {
    return await fn(absolutePath, filename);
  } finally {
    await unlink(absolutePath).catch(() => {});
  }
}
