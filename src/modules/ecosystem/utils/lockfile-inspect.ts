/**
 * Lockfile inspector: parses `package-lock.json` (v1, v2, v3) and extracts the
 * (packageName -> Set<version>) map of everything present in the tree.
 *
 * Used by the OSV fix applier to verify that claimed `versionTo` values from
 * `osv-scanner fix --format=json` are actually present in the lockfile. This
 * protects downstream reporting from osv-scanner quirks (e.g. lockfileVersion 1
 * behavior where the JSON output lists patches that never get written).
 */

import { v1Adapter, v2v3Adapter, selectRootLevelAdapter } from "./lockfile-formats";

function parseLockfileRoot(content: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;
  return parsed as Record<string, unknown>;
}

/**
 * Collect all (packageName, version) pairs from an npm package-lock.json string.
 *
 * Returns an empty map when:
 *  - content is not valid JSON
 *  - content is JSON but not an object
 *  - the object has no recognizable `dependencies` or `packages` section
 *
 * Tolerates unknown fields and mixed v1/v2 lockfiles: both formats' sections
 * are collected when present, not chosen exclusively.
 */
export function collectNpmLockfileVersions(
  content: string,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const root = parseLockfileRoot(content);
  if (!root) return out;

  const add = (name: string, version: string): void => {
    if (!name || !version) return;
    const set = out.get(name) ?? new Set<string>();
    set.add(version);
    out.set(name, set);
  };

  for (const entry of v1Adapter.collectAll(root)) add(entry.name, entry.version);
  for (const entry of v2v3Adapter.collectAll(root)) add(entry.name, entry.version);

  return out;
}

/**
 * Collect only root-level (packageName -> version) pairs from an npm package-lock.json string.
 *
 * Unlike `collectNpmLockfileVersions`, this function returns at most one version per package
 * name — the version installed at the root of the dependency tree, not transitive copies
 * nested under other packages.
 *
 * For v2/v3 lockfiles (has `packages` key): includes only keys of the form
 * `"node_modules/<name>"` that contain exactly one `node_modules/` segment.
 *
 * For v1 lockfiles (has `dependencies` key, no `packages`): includes only the top-level
 * `dependencies` object keys — does NOT recurse into nested `dependencies`.
 *
 * Returns an empty map on parse error (same resilience as `collectNpmLockfileVersions`).
 */
export function collectRootNpmLockfileVersions(
  content: string,
): Map<string, string> {
  const out = new Map<string, string>();
  const root = parseLockfileRoot(content);
  if (!root) return out;

  const adapter = selectRootLevelAdapter(root);
  for (const entry of adapter.collectRootLevel(root)) out.set(entry.name, entry.version);

  return out;
}

/**
 * Collect parent-level constraints from an npm package-lock.json string.
 *
 * Returns a Map where:
 *   outer key = dependency name (e.g. "cookie")
 *   inner key = parent package name (e.g. "cookies-next")
 *   value     = constraint string the parent declares (e.g. "<0.7.0")
 *
 * Supports v1 (requires field), v2/v3 (packages[].dependencies field).
 * Returns an empty Map on parse error or missing sections.
 */
type ConstraintAdder = (depName: string, parentName: string, constraint: string) => void;

function resolveV2ParentName(pathKey: string): string | undefined {
  const marker = 'node_modules/';
  const idx = pathKey.lastIndexOf(marker);
  if (idx < 0) return undefined;
  const name = pathKey.slice(idx + marker.length);
  return name || undefined;
}

function addStringConstraints(
  deps: Record<string, unknown>,
  parentName: string,
  addConstraint: ConstraintAdder,
): void {
  for (const [depName, constraint] of Object.entries(deps)) {
    if (typeof constraint === 'string') {
      addConstraint(depName, parentName, constraint);
    }
  }
}

function collectConstraintsFromV2Packages(
  pkgs: Record<string, unknown>,
  addConstraint: ConstraintAdder,
): void {
  for (const [pathKey, val] of Object.entries(pkgs)) {
    if (pathKey === '' || !val || typeof val !== 'object') continue;
    const entry = val as Record<string, unknown>;
    const deps = entry['dependencies'];
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
    const parentName = resolveV2ParentName(pathKey);
    if (!parentName) continue;
    addStringConstraints(deps as Record<string, unknown>, parentName, addConstraint);
  }
}

function addV1Requires(
  entry: Record<string, unknown>,
  name: string,
  addConstraint: ConstraintAdder,
): void {
  const requires = entry['requires'];
  if (!requires || typeof requires !== 'object' || Array.isArray(requires)) return;
  addStringConstraints(requires as Record<string, unknown>, name, addConstraint);
}

function collectConstraintsFromV1Deps(deps: unknown, addConstraint: ConstraintAdder): void {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return;
  for (const [name, val] of Object.entries(deps as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const entry = val as Record<string, unknown>;
    addV1Requires(entry, name, addConstraint);
    collectConstraintsFromV1Deps(entry['dependencies'], addConstraint);
  }
}

export function collectNpmLockfileConstraints(
  content: string,
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();

  const addConstraint: ConstraintAdder = (depName, parentName, constraint) => {
    if (!depName || !parentName || !constraint) return;
    const inner = out.get(depName) ?? new Map<string, string>();
    inner.set(parentName, constraint);
    out.set(depName, inner);
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;

  const root = parsed as Record<string, unknown>;

  const pkgs = root['packages'];
  if (pkgs && typeof pkgs === 'object' && !Array.isArray(pkgs)) {
    collectConstraintsFromV2Packages(pkgs as Record<string, unknown>, addConstraint);
    return out;
  }

  collectConstraintsFromV1Deps(root['dependencies'], addConstraint);
  return out;
}

/**
 * Collect parent-level constraints from a Composer composer.lock string.
 *
 * Returns a Map where:
 *   outer key = dependency name (e.g. "nesbot/carbon")
 *   inner key = parent package name (e.g. "laravel/framework")
 *   value     = constraint string the parent declares (e.g. "^2.72")
 *
 * Scans both `packages` and `packages-dev` arrays.
 * Skips platform requirements: entries where dep name is exactly "php",
 * or starts with "ext-" or "lib-".
 * Returns an empty Map on parse error or missing sections.
 */
function processComposerPackageEntry(
  entry: unknown,
  addConstraint: ConstraintAdder,
): void {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
  const pkg = entry as Record<string, unknown>;
  const parentName = pkg['name'];
  if (typeof parentName !== 'string' || !parentName) return;
  const require = pkg['require'];
  if (!require || typeof require !== 'object' || Array.isArray(require)) return;
  addStringConstraints(require as Record<string, unknown>, parentName, addConstraint);
}

function processComposerPackageArray(
  arr: unknown,
  addConstraint: ConstraintAdder,
): void {
  if (!Array.isArray(arr)) return;
  for (const entry of arr) {
    processComposerPackageEntry(entry, addConstraint);
  }
}

export function collectComposerLockfileConstraints(
  content: string,
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();

  const addConstraint: ConstraintAdder = (depName, parentName, constraint) => {
    if (!depName || !parentName || !constraint) return;
    // Skip platform requirements
    if (depName === 'php' || depName.startsWith('ext-') || depName.startsWith('lib-')) return;
    const inner = out.get(depName) ?? new Map<string, string>();
    inner.set(parentName, constraint);
    out.set(depName, inner);
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;

  const root = parsed as Record<string, unknown>;

  processComposerPackageArray(root['packages'], addConstraint);
  processComposerPackageArray(root['packages-dev'], addConstraint);

  return out;
}

/**
 * Diff root-level package versions between two lockfile contents.
 *
 * Returns only packages whose root-level version changed. Packages present in only
 * one side have `undefined` for the missing side.
 */
export function diffRootNpmLockfileVersions(
  before: string,
  after: string,
): Map<string, { before: string | undefined; after: string | undefined }> {
  const beforeMap = collectRootNpmLockfileVersions(before);
  const afterMap = collectRootNpmLockfileVersions(after);
  const result = new Map<string, { before: string | undefined; after: string | undefined }>();

  const allNames = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  for (const name of allNames) {
    const b = beforeMap.get(name);
    const a = afterMap.get(name);
    if (b !== a) {
      result.set(name, { before: b, after: a });
    }
  }

  return result;
}
