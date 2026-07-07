/**
 * npm package-lock.json format adapters.
 *
 * Two shapes exist in the wild: lockfileVersion 1 (a recursive, name-keyed
 * `dependencies` tree) and lockfileVersion 2/3 (a flat, path-keyed `packages`
 * map, e.g. "node_modules/foo", "node_modules/@scope/bar"). Both adapters
 * expose the same traversal interface so `lockfile-inspect.ts` can fold over
 * whichever one applies without branching on the format itself.
 */

export interface NpmLockfileEntry {
  name: string;
  version: string;
}

export interface NpmLockfileFormatAdapter {
  /** Every (name, version) pair reachable in this format's section, at any depth. */
  collectAll(root: Record<string, unknown>): NpmLockfileEntry[];
  /** Only the (name, version) pairs installed at the root of the dependency tree. */
  collectRootLevel(root: Record<string, unknown>): NpmLockfileEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readStringVersion(entry: Record<string, unknown>): string | undefined {
  const version = entry["version"];
  return typeof version === "string" ? version : undefined;
}

// v1: recursive name-keyed `dependencies` tree.

function walkV1Deps(deps: unknown, onEntry: (name: string, version: string) => void): void {
  if (!isPlainObject(deps)) return;
  for (const [name, val] of Object.entries(deps)) {
    if (!isPlainObject(val)) continue;
    const version = readStringVersion(val);
    if (version) onEntry(name, version);
    walkV1Deps(val["dependencies"], onEntry);
  }
}

function collectV1All(root: Record<string, unknown>): NpmLockfileEntry[] {
  const out: NpmLockfileEntry[] = [];
  walkV1Deps(root["dependencies"], (name, version) => out.push({ name, version }));
  return out;
}

function collectV1RootLevel(root: Record<string, unknown>): NpmLockfileEntry[] {
  const out: NpmLockfileEntry[] = [];
  const deps = root["dependencies"];
  if (!isPlainObject(deps)) return out;
  for (const [name, val] of Object.entries(deps)) {
    if (!isPlainObject(val)) continue;
    const version = readStringVersion(val);
    if (version && name) out.push({ name, version });
  }
  return out;
}

// v2/v3: flat path-keyed `packages` map.

const NODE_MODULES_MARKER = "node_modules/";

function deriveV2PathName(pathKey: string): string | undefined {
  const idx = pathKey.lastIndexOf(NODE_MODULES_MARKER);
  if (idx < 0) return undefined;
  return pathKey.slice(idx + NODE_MODULES_MARKER.length) || undefined;
}

function resolveV2EntryName(pathKey: string, entry: Record<string, unknown>): string | undefined {
  const explicit = entry["name"];
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return deriveV2PathName(pathKey);
}

function isV2RootLevelPath(pathKey: string): boolean {
  if (!pathKey.startsWith(NODE_MODULES_MARKER)) return false;
  const afterFirst = pathKey.slice(NODE_MODULES_MARKER.length);
  return !afterFirst.includes("/node_modules/");
}

function collectV2V3All(root: Record<string, unknown>): NpmLockfileEntry[] {
  const out: NpmLockfileEntry[] = [];
  const pkgs = root["packages"];
  if (!isPlainObject(pkgs)) return out;
  for (const [pathKey, val] of Object.entries(pkgs)) {
    if (pathKey === "" || !isPlainObject(val)) continue;
    const version = readStringVersion(val);
    if (!version) continue;
    const name = resolveV2EntryName(pathKey, val);
    if (name) out.push({ name, version });
  }
  return out;
}

function collectV2V3RootLevel(root: Record<string, unknown>): NpmLockfileEntry[] {
  const out: NpmLockfileEntry[] = [];
  const pkgs = root["packages"];
  if (!isPlainObject(pkgs)) return out;
  for (const [pathKey, val] of Object.entries(pkgs)) {
    if (pathKey === "" || !isPlainObject(val)) continue;
    const version = readStringVersion(val);
    if (!version || !isV2RootLevelPath(pathKey)) continue;
    const name = pathKey.slice(NODE_MODULES_MARKER.length);
    if (name) out.push({ name, version });
  }
  return out;
}

export const v1Adapter: NpmLockfileFormatAdapter = {
  collectAll: collectV1All,
  collectRootLevel: collectV1RootLevel,
};

export const v2v3Adapter: NpmLockfileFormatAdapter = {
  collectAll: collectV2V3All,
  collectRootLevel: collectV2V3RootLevel,
};

/**
 * Format detection, chosen once per document: a `packages` map means v2/v3,
 * its absence means v1. Mirrors the shape-based branch `collectRootNpmLockfileVersions`
 * used before this module existed.
 */
export function hasV2V3Packages(root: Record<string, unknown>): boolean {
  return isPlainObject(root["packages"]);
}

export function selectRootLevelAdapter(root: Record<string, unknown>): NpmLockfileFormatAdapter {
  return hasV2V3Packages(root) ? v2v3Adapter : v1Adapter;
}
