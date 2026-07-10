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

### Slice 4 — 2026-07-09

Backfilled `progress-reporter.ts` (91.37% lines / 65.21% functions -> 100% / 100% — worst function coverage in the repo), `pip-reachability.ts` (90.82% lines / 77.10% branches -> 100% / 98.79%), and `config/loader.ts` (89.33% lines / 81.35% branches -> 97.33% / 94.91%) with behavior-asserting unit tests — driving the ecosystem-fix subtask closures (Docker runtime with a runtimeSpec present, the OSV fix staging phase, breaking-install/residual/error verification titles, and the progress-sink routing for every active phase) plus the `buildEcosystemFixTaskList`/`buildScanTaskList` `newListr`/`run()`/sink-routing branches for progress-reporter; the full PEP 440 operator/wildcard matrix, all four tier-1 lockfile tooling formats (poetry/uv/pipenv/pdm), the no-lockfile/unrecognized-tooling/tier-3-catch branches of `buildGraphFromDetection`, the `findInGraph` normalize-and-scan fallback, the parent/dependsOn no-constraint skip branches, and the adapter's malformed-ref and non-Error-catch branches for pip-reachability; and the legacy `scanners.*`/top-level-`runners`/`ecosystems[].runner.mode` (including the `?` id fallback) migration-rejection matrix plus `formatZodIssue`'s `unrecognized_keys` and `invalid_enum_value` rendering for config/loader (`lockfile-utils.ts` remains deliberately skipped — still only 1 uncovered line of 10).

Measured totals (unit+integration): statements 97.08 -> 97.77, functions 97.44 -> 98.62, lines 98.34 -> 98.81, branches 90.28 -> 90.98.

Floors raised (raise-only): statements 96.5 -> 97, functions 97 -> 98, lines 98 -> 98.5, branches 89.5 -> 90.5.

Status stays open — next lowest-covered files (per the refreshed coverage summary) are `lockfile-utils.ts` (90% lines, still deliberately skipped), `ecosystem-runtime/resolve.ts` (90.9% lines), and `scanner/osv-engine.ts` (92.03% lines).

### Slice 5 — 2026-07-09

Backfilled `ecosystem-runtime/resolve.ts` (90.9% lines / 88.46% branches -> 100% / 100%), `scanner/osv-engine.ts` (92.03% lines / 84.72% branches -> 98.23% / 95.83% — new sibling `osv-engine-branches.test.ts` alongside the existing 1379-line suite to preserve cohesion), and `lockfile-utils.ts` (90% lines / 85.71% branches -> 100% / 100%, finally given its own dedicated test file) with behavior-asserting unit tests — the runtimeSpec-undefined guard, the full pull-based image resolution precedence (explicit image, `language_version`, inferred version, plugin default) including the pip-only no-version warning, and the `native_deps` apt-get preamble composition (with and without an existing preamble) plus `mountReadonly` forwarding for resolve.ts; the unrecognized-runner fallthrough in `assertAvailable`, the local-runner recommendation warning, the `scan.paths` dry-run/zero-args/scan-failure branches, monorepo `entry.path` lockfile-arg rewriting, the `prepareScan` hook, the no-matching-scan-output continue, and unregistered-ecosystem-entry skipping for osv-engine.ts; and the full null-path matrix (unreadable file, invalid JSON, array/non-object/null root, missing/non-numeric `lockfileVersion`) plus the valid-version happy path for lockfile-utils.ts.

Measured totals (unit+integration): statements 97.77 -> 97.96, functions 98.62 -> 98.62, lines 98.81 -> 99.02, branches 90.98 -> 91.29.

Floors raised (raise-only): statements 97 -> 97.5, functions 98 -> 98 (unchanged — computed floor did not exceed the current value), lines 98.5 -> 98.5 (unchanged), branches 90.5 -> 90.5 (unchanged).

Status stays open — the ratchet is now near-saturated: the lowest-covered files remaining are all at or above roughly 92% lines, so further slices will yield smaller floor increments. Per the refreshed coverage summary, the next lowest-covered files (unconfirmed high-value targets) would need a fresh `npx vitest run --coverage` per-file scan before starting a slice 6.

# References

- [ADR 0011](/adr/0011-coverage-ratchet-policy.md)
