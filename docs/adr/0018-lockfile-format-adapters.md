---
type: ADR
title: Lockfile inspection — one version-map interface with per-format adapters (v1; v2/v3)
description: collectNpmLockfileVersions (CCN 17) and collectRootNpmLockfileVersions (CCN 25) stop branching on lockfileVersion internally - the format knowledge moves to two adapters behind a single traversal interface; the public API and its 12 call sites do not change.
status: Accepted
tags: [architecture, ecosystem, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# ADR 0018 — Lockfile format adapters (review 2026-07-07, candidate C5)

## Context

`src/modules/ecosystem/utils/lockfile-inspect.ts` is the highest-leverage utility in the ecosystem module: `collectNpmLockfileVersions` (CCN 17) and `collectRootNpmLockfileVersions` (CCN 25) each serve **six callers** — every npm fixer strategy, the npm updater and the OSV fix applier funnel their upgrade verification through them. Both interleave package-lock v1 and v2/v3 traversal with internal branching (`processPackageArray` CCN 13 included). The file already grew shared per-format constraint helpers (`addV1Requires`, `collectConstraintsFromV2Packages`…): the format seam is real (two formats = two adapters) but unnamed.

## Decision

1. **New module `src/modules/ecosystem/utils/lockfile-formats.ts`** with two format adapters behind one traversal interface: given a parsed lockfile object, each adapter yields the (name, version, isRoot/path context) tuples the collectors need — `v1` (recursive `dependencies` tree) and `v2v3` (`packages` map). The adapter is chosen once per document from `lockfileVersion`/shape, exactly reproducing today's detection.
2. **`lockfile-inspect.ts` keeps the entire public API** (`collectNpmLockfileVersions`, `collectRootNpmLockfileVersions`, `diffRootNpmLockfileVersions`, `ConstraintAdder` and the constraint helpers) with unchanged signatures and semantics; the collectors become thin folds over the chosen adapter. The 12 call sites do not change.
3. **Budget:** zero functions above CCN 10 in both files (new helpers ≤ 8).
4. Existing `lockfile-inspect.test.ts` (v1/v2/v3 coverage) untouched as oracle; new adapter-level table tests only where existing fixtures leave a format edge unpinned.

## Consequences

- Format knowledge gets one home each; a future pnpm/yarn reader is a new adapter, not another branch in CCN 25.
- 12 call sites harden at once — the highest-leverage single refactor available in the module.
- Risk: subtle differences between root-scoped and full collection per format — mitigated by verbatim traversal moves and the unchanged oracle.

## Verification

- Full suite green, count ≥ current; existing lockfile tests unchanged.
- lizard on both files: zero functions above CCN 10; typecheck clean; oxlint 0 errors.

# References

- [Issue 0015 — lockfile format adapters](/issues/0015-lockfile-format-adapters.md)
- [ADR 0007 — consolidate image resolvers](/adr/0007-consolidate-image-resolvers.md) (table/adapter-driven consolidation precedent)
