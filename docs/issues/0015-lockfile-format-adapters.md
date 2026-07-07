---
type: Issue
title: Lockfile format adapters - v1 and v2/v3 traversal behind one interface; public API unchanged
description: Execute ADR 0018 - new lockfile-formats.ts with two format adapters; collectNpmLockfileVersions (CCN 17) / collectRootNpmLockfileVersions (CCN 25) become thin folds; 12 call sites untouched.
status: open
tags: [architecture, ecosystem, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# Issue 0015 — Lockfile format adapters

Executes [ADR 0018](/adr/0018-lockfile-format-adapters.md). Behavior-preserving; existing `lockfile-inspect.test.ts` is the oracle and does not change.

## Scope

- New `src/modules/ecosystem/utils/lockfile-formats.ts`: v1 (recursive dependencies) and v2/v3 (packages map) adapters behind one traversal interface; format detection reproduces today's logic exactly.
- `lockfile-inspect.ts`: public API and signatures unchanged; collectors become thin folds over the chosen adapter; constraint helpers stay.
- New adapter-level table tests only for format edges the existing fixtures leave unpinned.

## Done when

- Full suite green (count >= current, existing tests unchanged); lizard on both files: zero above CCN 10; typecheck + oxlint clean.

# References

- [ADR 0018](/adr/0018-lockfile-format-adapters.md)
