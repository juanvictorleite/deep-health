import { describe, it, expect } from "vitest";

import {
  v1Adapter,
  v2v3Adapter,
  hasV2V3Packages,
  selectRootLevelAdapter,
} from "@modules/ecosystem/utils/lockfile-formats";
import {
  collectNpmLockfileVersions,
  collectRootNpmLockfileVersions,
} from "@modules/ecosystem/utils/lockfile-inspect";

describe("lockfile-formats — v2/v3 workspace-style path edge", () => {
  // npm workspaces nest a workspace package's own dependencies under
  // "<workspace-path>/node_modules/<name>" — a path key that does NOT start
  // with "node_modules/". `collectAll` still finds it (lastIndexOf-based,
  // matches anywhere), but `collectRootLevel` excludes it (startsWith-based,
  // root of the whole tree only) — this divergence is real production
  // behavior no existing fixture pins down.
  const root = {
    lockfileVersion: 3,
    packages: {
      "": { name: "monorepo" },
      "packages/foo": { name: "foo", version: "1.0.0" },
      "packages/foo/node_modules/bar": { version: "2.0.0" },
      "node_modules/top-level": { version: "3.0.0" },
    },
  };

  it("collectAll includes the workspace-nested dependency", () => {
    const entries = v2v3Adapter.collectAll(root);
    expect(entries).toContainEqual({ name: "bar", version: "2.0.0" });
    expect(entries).toContainEqual({ name: "top-level", version: "3.0.0" });
  });

  it("collectRootLevel excludes it (path does not start with node_modules/)", () => {
    const entries = v2v3Adapter.collectRootLevel(root);
    expect(entries.some((e) => e.name === "bar")).toBe(false);
    expect(entries).toContainEqual({ name: "top-level", version: "3.0.0" });
  });

  it("is reproduced end-to-end through the public collectors", () => {
    const content = JSON.stringify(root);
    const all = collectNpmLockfileVersions(content);
    const rootOnly = collectRootNpmLockfileVersions(content);

    expect(all.get("bar")).toEqual(new Set(["2.0.0"]));
    expect(rootOnly.has("bar")).toBe(false);
    expect(rootOnly.get("top-level")).toBe("3.0.0");
  });
});

describe("lockfile-formats — v2/v3 explicit `name` preference divergence", () => {
  // `collectAll` prefers the explicit `name` field over the path-derived
  // name (pinned for the full collector in lockfile-inspect.test.ts); the
  // root-level adapter never consults `name` at all — no fixture pins the
  // root-scoped side of this divergence.
  const root = {
    lockfileVersion: 2,
    packages: {
      "node_modules/some-alias": { name: "real-name", version: "1.2.3" },
    },
  };

  it("collectAll uses the explicit name", () => {
    expect(v2v3Adapter.collectAll(root)).toEqual([
      { name: "real-name", version: "1.2.3" },
    ]);
  });

  it("collectRootLevel ignores the explicit name and uses the path segment", () => {
    expect(v2v3Adapter.collectRootLevel(root)).toEqual([
      { name: "some-alias", version: "1.2.3" },
    ]);
  });
});

describe("lockfile-formats — format detection", () => {
  it("hasV2V3Packages is true only when `packages` is a plain object", () => {
    expect(hasV2V3Packages({ packages: {} })).toBe(true);
    expect(hasV2V3Packages({ packages: { a: 1 } })).toBe(true);
    expect(hasV2V3Packages({})).toBe(false);
    expect(hasV2V3Packages({ packages: null })).toBe(false);
    expect(hasV2V3Packages({ packages: [] })).toBe(false);
    expect(hasV2V3Packages({ packages: "nope" })).toBe(false);
  });

  it("selectRootLevelAdapter picks v2v3 when `packages` is present, v1 otherwise", () => {
    expect(selectRootLevelAdapter({ packages: {} })).toBe(v2v3Adapter);
    expect(selectRootLevelAdapter({ dependencies: {} })).toBe(v1Adapter);
    expect(selectRootLevelAdapter({})).toBe(v1Adapter);
  });
});

describe("lockfile-formats — v1 adapter empty/malformed shapes", () => {
  it("collectAll and collectRootLevel return [] when `dependencies` is absent", () => {
    expect(v1Adapter.collectAll({})).toEqual([]);
    expect(v1Adapter.collectRootLevel({})).toEqual([]);
  });

  it("collectAll and collectRootLevel return [] when `dependencies` is not a plain object", () => {
    expect(v1Adapter.collectAll({ dependencies: "nope" })).toEqual([]);
    expect(v1Adapter.collectRootLevel({ dependencies: ["nope"] })).toEqual([]);
  });
});

describe("lockfile-formats — v2v3 adapter empty/malformed shapes", () => {
  it("collectAll and collectRootLevel return [] when `packages` is absent", () => {
    expect(v2v3Adapter.collectAll({})).toEqual([]);
    expect(v2v3Adapter.collectRootLevel({})).toEqual([]);
  });

  it("collectAll and collectRootLevel return [] when `packages` is not a plain object", () => {
    expect(v2v3Adapter.collectAll({ packages: [] })).toEqual([]);
    expect(v2v3Adapter.collectRootLevel({ packages: "nope" })).toEqual([]);
  });
});
