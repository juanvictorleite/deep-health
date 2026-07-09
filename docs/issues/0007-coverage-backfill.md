---
type: Issue
title: Coverage backfill — raise the ratchet floors incrementally
description: Standing ticket executing ADR 0011's backfill half - add tests to the lowest-covered areas and raise the vitest threshold floors (raise-only) as each area lands.
status: open
tags: [testing, coverage]
timestamp: 2026-07-06T00:00:00Z
---

# Issue 0007 — Coverage backfill (ratchet raise)

Execute the backfill half of [ADR 0011](/adr/0011-coverage-ratchet-policy.md). The ratchet half (floors at the measured baseline: statements 94.5, functions 94.5, lines 95.5, branches 86) lands with the ADR.

## Scope

- Identify the lowest-covered files (`npx vitest run --coverage` per-file report; after slice 1, `docker-sonar-scanner.ts`, `pip/tooling.ts`, and `ephemeral-container.ts` are the lowest-covered — start there).
- Add behavior-asserting tests (not implementation-mirroring) per the test-effectiveness standing AC.
- In the SAME change that raises a metric, raise its floor in `vitest.config.ts` to just below the new measured value (raise-only rule).

## Done when

- Recurring: each slice raises at least one floor. The ticket closes when all four floors reach the team's agreed target (aspirationally 100/100/100/100 per ADR 0011).

## Progress

### Slice 1 — 2026-07-09

Backfilled `inquirer-prompts.ts` (20% lines -> 100%), `local-executor.ts` (70.45% lines -> 100%), and `report-artifacts.ts` (72.72% lines -> 100%) with behavior-asserting unit tests.

Measured totals (unit+integration): statements 95.55 -> 96.14, functions 95.76 -> 96.75, lines 96.77 -> 97.36, branches 87.52 -> 87.97.

Floors raised (raise-only): statements 94.5 -> 95.5, functions 94.5 -> 96, lines 95.5 -> 97, branches 86 -> 87.5.

Status stays open — next lowest-covered files are `docker-sonar-scanner.ts`, `pip/tooling.ts`, and `ephemeral-container.ts`.

### Slice 2 — 2026-07-09

Backfilled `docker-sonar-scanner.ts` (82.35% lines / 64.51% branches -> 100% / 96.77%), `pip/tooling.ts` (83.87% lines / 60.56% branches -> 100% / 100%), and `ephemeral-container.ts` (83.96% lines / 55.38% branches -> 100% / 100%) with behavior-asserting unit tests — real-stream `onLine` forwarding and result-field defaults for the sonar-scanner runner, the full `apply*Update` failure/fallback matrix plus `applyToolingFix`'s default-routing and rethrow paths for pip, and `runShell()` plus both `run()`/`runShell()` retry-exhausted error-mapping fallbacks for the ephemeral container.

Measured totals (unit+integration): statements 96.14 -> 96.78, functions 96.75 -> 97.14, lines 97.36 -> 98.02, branches 87.97 -> 89.67.

Floors raised (raise-only): statements 95.5 -> 96, functions 96 -> 96.5, lines 97 -> 97.5, branches 87.5 -> 89.

Status stays open — next lowest-covered files (per the refreshed coverage summary) are `spawn-streaming.ts`, `git-commit.ts`, and `build-project-image.ts`.

### Slice 3 — 2026-07-09

Backfilled `spawn-streaming.ts` (84.21% lines / 77.27% branches -> 100% / 95.45%), `git-commit.ts` (86.48% lines / 43.33% branches -> 100% / 100% — worst branch coverage in the repo, previously only exercised indirectly via `fix-command-branches.test.ts` and now has a dedicated unit test file), and `build-project-image.ts` (89.09% lines / 60% functions -> 100% / 100%) with behavior-asserting unit tests — the detached-spawn timeout kill fallback, stderr/stdout log-level forwarding, and the non-number exit-code and spawn-error-with-pending-timeout paths for spawn-streaming; the full `createBranchAndCommit` rollback/commit-failure matrices (both tolerated and failing `branch -D`, both "nothing to commit" message variants, checkout-failure stderr/stdout fallback) plus `buildBranchName` timestamp formatting for git-commit; and the `warnIfLargeContext` large-context/.dockerignore/du-failure matrix for build-project-image.

Measured totals (unit+integration): statements 96.78 -> 97.08, functions 97.14 -> 97.44, lines 98.02 -> 98.34, branches 89.67 -> 90.28.

Floors raised (raise-only): statements 96 -> 96.5, functions 96.5 -> 97, lines 97.5 -> 98, branches 89 -> 89.5.

Status stays open — next lowest-covered files (per the refreshed coverage summary) are `config/loader.ts` (89.33% lines), `lockfile-utils.ts` (90% lines), and `pip-reachability.ts` (90.82% lines).

# References

- [ADR 0011](/adr/0011-coverage-ratchet-policy.md)
