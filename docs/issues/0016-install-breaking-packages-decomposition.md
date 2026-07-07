---
type: Issue
title: Decompose npm installBreakingPackages into phase helpers; name the engines extract
description: installBreakingPackages (CCN 20, 80 NLOC) in npm.ts decomposes per the ADR 0013 phase-helper playbook - collect/snapshot/install/verify phases; the inline package.json engines extract becomes a named helper. No unified constraint parser (deletion test fails).
status: open
tags: [architecture, ecosystem, npm, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# Issue 0016 — installBreakingPackages decomposition

Executes the [ADR 0013](/adr/0013-fixer-decomposition-shared-semver-helpers.md) phase-helper playbook on `src/modules/ecosystem/plugins/npm.ts` (2026-07-07 review, candidate C6). Behavior-preserving; the full suite is the oracle.

## Scope

- `installBreakingPackages` (CCN 20, 80 NLOC, lines 176-274) decomposes into module-level phase helpers mirroring its existing phases: collect authorized breaking packages (including the protected-constraint skip warning), pre/post lockfile root-version snapshot (the identical try/read/collect block appears twice), run the install via `runArgs`, verify upgrades in the lockfile diff. The plugin method becomes thin orchestration.
- The inline `package.json#engines.node` extract in `versionSources` becomes a named module-level helper so complexity is attributed and testable.
- Explicitly out: any unified constraint parser across ecosystems — the deletion test fails (it would move complexity, not concentrate it).
- SEC comment preserved: variable specs flow through `runArgs`, never `run`.

## Done when

- Zero functions above CCN 10 in npm.ts (new helpers ≤ 8); exported plugin shape unchanged; full suite green with existing tests unmodified; new table tests only pin current helper behavior.
