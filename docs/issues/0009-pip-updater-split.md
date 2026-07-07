---
type: Issue
title: Split pip-updater.ts into seam-aligned submodules behind a stable facade
description: Execute ADR 0012 - move the six mapped seams of pip-updater.ts (934 lines, 38 functions) into pip/transforms.ts, pip/tooling.ts, pip/spec-validation.ts and pip/fixers.ts; pip-updater.ts stays the sole public entry re-exporting today's API.
status: done
tags: [architecture, ecosystem, pip]
timestamp: 2026-07-06T00:00:00Z
---

# Issue 0009 — pip-updater module split

Executes [ADR 0012](/adr/0012-pip-updater-module-split.md). Move-only: function bodies move verbatim into the four submodules; no logic edit, no rename, no signature change.

## Scope

- Create `src/modules/ecosystem/plugins/pip/{transforms,tooling,spec-validation,fixers}.ts` with the seam→module mapping from ADR 0012's Decision 1.
- Shrink `src/modules/ecosystem/plugins/pip-updater.ts` to `runPipUpdater` (+ its nested helpers) + re-exports of every currently exported symbol.
- Dependency direction per ADR 0012 Decision 4 (facade → pip/*; transforms imports no sibling).
- No test file changes: `tests/unit/plugins/pip-updater.test.ts` untouched is the behavior-preservation proof.

## Done when

- Full suite green with identical count; typecheck clean; lizard shows no function > CCN 10; `pip-updater.ts` diff is deletions + re-exports only.

# References

- [ADR 0012](/adr/0012-pip-updater-module-split.md)
