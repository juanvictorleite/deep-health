import { readdir } from 'node:fs/promises';
import { resolve, relative, join, basename } from 'node:path';
import type { Dirent } from 'node:fs';
import type { EcosystemPlugin } from '@modules/ecosystem/types';

// ── Public types ─────────────────────────────────────────────────────────────

export interface DiscoveredEcosystem {
  /** Plugin ID, e.g. 'npm', 'composer', 'pip' */
  pluginId: string;
  /** Relative path from cwd to the directory containing the lockfile. Empty string = root. */
  path: string;
  /** Filename that was found (e.g. 'package-lock.json') */
  lockfile: string;
  /** Auto-derived label from directory name; undefined for root discoveries. */
  suggestedLabel?: string;
}

export interface DiscoveredDockerfile {
  /** Relative path from cwd to the directory containing the Dockerfile. Empty string = root. */
  path: string;
  /** Filename (e.g. 'Dockerfile', 'Dockerfile.prod') */
  filename: string;
}

export interface DiscoveryResult {
  ecosystems: DiscoveredEcosystem[];
  dockerfiles: DiscoveredDockerfile[];
}

export interface DiscoverProjectOptions {
  /** Maximum directory depth to recurse into. Default: 4. */
  maxDepth?: number;
  /** Directory names to skip entirely. Default: see DEFAULT_EXCLUDE. */
  exclude?: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_EXCLUDE: string[] = [
  'node_modules',
  'vendor',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  '.tox',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derives a suggested label from a directory path relative to cwd.
 * Takes the immediate parent directory name, lowercases it, replaces
 * non-[a-z0-9-] chars with hyphens, collapses consecutive hyphens,
 * and strips leading/trailing hyphens.
 *
 * Returns undefined for root (empty relDir).
 */
function deriveSuggestedLabel(relDir: string): string | undefined {
  if (relDir === '') return undefined;
  const dirName = basename(relDir);
  return dirName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '') || undefined;
}

/**
 * Normalises an absolute path to a relative path from cwd.
 * Strips any leading './' prefix so the result is always bare (or '').
 */
function toRelPath(cwd: string, absPath: string): string {
  const rel = relative(cwd, absPath);
  // relative() returns '' when absPath === cwd; never starts with './' for sub-dirs
  // but guard anyway in case of edge cases on some platforms.
  if (rel === '.') return '';
  if (rel.startsWith('./')) return rel.slice(2);
  return rel;
}

// ── Core walker ───────────────────────────────────────────────────────────────

/** Context object passed through the recursive walk to reduce parameter count. */
interface WalkContext {
  readonly cwd: string;
  readonly maxDepth: number;
  readonly exclude: string[];
  readonly plugins: EcosystemPlugin[];
  readonly result: DiscoveryResult;
}

/**
 * Classifies directory entries into files (Set for O(1) lookup) and
 * non-excluded subdirectory paths.
 */
function classifyEntries(
  entries: Dirent[],
  absDir: string,
  exclude: string[],
): { fileNames: Set<string>; subDirs: string[] } {
  const fileNames = new Set<string>();
  const subDirs: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!exclude.includes(entry.name)) {
        subDirs.push(join(absDir, entry.name));
      }
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      fileNames.add(entry.name);
    }
  }

  return { fileNames, subDirs };
}

/**
 * Matches discovered files against plugin lockfile patterns.
 * Pushes matching DiscoveredEcosystem entries into result.
 */
function matchPluginLockfiles(
  fileNames: Set<string>,
  relDir: string,
  plugins: EcosystemPlugin[],
  result: DiscoveryResult,
): void {
  for (const plugin of plugins) {
    for (const lockfile of plugin.lockfiles ?? []) {
      if (fileNames.has(lockfile)) {
        result.ecosystems.push({
          pluginId: plugin.id,
          path: relDir,
          lockfile,
          suggestedLabel: deriveSuggestedLabel(relDir),
        });
        break; // one match per plugin per directory is enough
      }
    }
  }
}

/**
 * Matches filenames starting with 'Dockerfile' (case-sensitive).
 * Pushes matching DiscoveredDockerfile entries into result.
 */
function matchDockerfiles(
  fileNames: Set<string>,
  relDir: string,
  result: DiscoveryResult,
): void {
  for (const name of fileNames) {
    if (name.startsWith('Dockerfile')) {
      result.dockerfiles.push({ path: relDir, filename: name });
    }
  }
}

/**
 * Recursively walks a directory tree, discovering lockfiles and Dockerfiles.
 * Uses WalkContext to keep parameter count low (2 positional + context).
 */
async function walk(ctx: WalkContext, absDir: string, depth: number): Promise<void> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip silently
  }

  const relDir = toRelPath(ctx.cwd, absDir);
  const { fileNames, subDirs } = classifyEntries(entries, absDir, ctx.exclude);

  matchPluginLockfiles(fileNames, relDir, ctx.plugins, ctx.result);
  matchDockerfiles(fileNames, relDir, ctx.result);

  if (depth < ctx.maxDepth) {
    await Promise.all(
      subDirs.map((subDir) => walk(ctx, subDir, depth + 1)),
    );
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Recursively walks the directory tree rooted at `cwd`, discovering:
 *   - Lockfiles declared by each plugin (returns DiscoveredEcosystem entries)
 *   - Files whose names start with 'Dockerfile' (returns DiscoveredDockerfile entries)
 *
 * All returned paths are relative to `cwd` with no leading './' or '/'.
 * Root-level discoveries have `path: ''`.
 */
export async function discoverProject(
  cwd: string,
  plugins: EcosystemPlugin[],
  options?: DiscoverProjectOptions,
): Promise<DiscoveryResult> {
  const ctx: WalkContext = {
    cwd,
    maxDepth: options?.maxDepth ?? 4,
    exclude: options?.exclude ?? DEFAULT_EXCLUDE,
    plugins,
    result: { ecosystems: [], dockerfiles: [] },
  };
  await walk(ctx, resolve(cwd), 0);
  return ctx.result;
}

