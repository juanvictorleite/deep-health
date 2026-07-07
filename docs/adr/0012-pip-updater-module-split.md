---
type: ADR
title: Split pip-updater into seam-aligned submodules behind a stable facade
description: pip-updater.ts (934 lines, 38 functions) splits into four submodules under plugins/pip/ — transforms, tooling, spec-validation, fixers — with pip-updater.ts remaining the sole public entry re-exporting the current API.
status: Accepted
tags: [architecture, ecosystem, pip]
timestamp: 2026-07-06T00:00:00Z
---

# ADR 0012 — pip-updater module split

## Context

`src/modules/ecosystem/plugins/pip-updater.ts` is the largest module in the codebase: 934 lines (636 NLOC), 38 top-level functions (13 exported + 1 exported type + internal helpers), flagged as the remaining structural follow-up of the ARCH-IMPROVE round ([issue 0009](/issues/0009-pip-updater-split.md)). Codegraph mapping (2026-07-06) shows six natural seams — groups of functions that only call each other:

| Seam | Functions | ~Lines |
|---|---|---|
| Pure data transforms | `stripPipVersion`, `toPipInstallSpec`, `computeMaxSafeVersions`, `computeSortedSafeVersions`, `compareVersionsDescending`, `updateRequirementsContent`, `parsePipInstalledVersions`, `buildPipPackagesUpdated`, `parseSingleFixEntry`, `parsePipAuditFixJson`, `buildMaxCvssMap`, `sortSpecsByCvss` | 76–360, 736–765 |
| Bootstrap/config | `resolveBackupFiles`, `resolveBootstrapSpec`, `pickRegistryEnvVars` | 28–53 |
| pip-audit path | `isPipAuditAvailable`, `applyPipAudit` | 388–421 |
| pip-install path | `applyPipInstall`, `rewriteRequirementsTxt`, `PipFixerResult` | 56–58, 362–382, 427–447 |
| Tooling routing | `applyPoetryUpdate`, `applyUvUpdate`, `applyPipenvUpdate`, `applyPdmUpdate`, `applyPipToolsUpdate`, `applyToolingFix` | 449–569 |
| Spec validation | `dryRunCheck`, `tryFallbackVersions`, `resolveSpec`, `findCompatibleSubset`, `applyReBatchValidation`, `validatePipSpecs` | 579–728 |

Cyclomatic complexity is already within budget (max CCN 10, lizard 2026-07-06) — the problem is module cohesion and navigability, not function complexity. Sibling updaters (`npm-updater.ts`, `composer-updater.ts`) are single-file but far smaller; they are out of scope.

## Decision

1. **New directory `src/modules/ecosystem/plugins/pip/`** with four submodules, mapped from the seams:
   - `pip/transforms.ts` — the pure data-transform seam (no I/O, no exec). `compareVersionsDescending` and `parseSingleFixEntry` stay internal to it.
   - `pip/tooling.ts` — bootstrap/config seam + tooling-routing seam (`applyToolingFix` is the only consumer of the five `apply*Update` functions; `resolveBackupFiles`/`resolveBootstrapSpec` share its tooling-detection vocabulary).
   - `pip/spec-validation.ts` — the spec-validation seam.
   - `pip/fixers.ts` — pip-audit path + pip-install path + the `PipFixerResult` type (the two alternative fix strategies `runPipUpdater` chooses between).
2. **`pip-updater.ts` remains the sole public entry (facade).** It keeps `runPipUpdater` (with its nested `probe`/`applyFix`/`derivePackagesUpdated` helpers) and **re-exports every symbol it exports today** from the new submodules. External import paths — plugin registry, tests — do not change in this decision.
3. **Move-only discipline.** Function bodies move verbatim; no logic edit, no rename, no signature change. Internal-only helpers keep module-private visibility inside their new submodule (exported from the submodule only when the facade or a sibling submodule needs them, and not re-exported by the facade unless already public today).
4. **Dependency direction:** `pip-updater.ts` → `pip/*`; `pip/fixers.ts`, `pip/tooling.ts`, `pip/spec-validation.ts` may import `pip/transforms.ts`; `pip/transforms.ts` imports none of its siblings. Additionally `pip/tooling.ts` → `pip/fixers.ts` is allowed: the monolith's `applyToolingFix` already fell back to `applyPipInstall` (switch-default and catch), so a faithful move-only split carries that edge. No cycle (`fixers.ts` never imports `tooling.ts`). *(Amended 2026-07-07 at execution review: the original text omitted the pre-existing tooling→fixers edge.)*

## Consequences

- Each submodule is one topic and small enough to read whole; the pure transform seam becomes trivially unit-testable in isolation.
- The facade keeps the blast radius zero: callers and the existing test suite (`tests/unit/plugins/pip-updater.test.ts`) stay untouched, proving the split is behavior-preserving.
- Future pip work (a new tooling backend, a new fix strategy) lands in one submodule instead of growing a 900-line file.
- One more directory level under `plugins/`; accepted — `npm-updater`/`composer-updater` migrate to the same shape only if/when they grow (no speculative churn now).

## Verification

- Full suite green with identical test count (3147); `tests/unit/plugins/pip-updater.test.ts` unchanged.
- `git diff` on `pip-updater.ts` shows deletions + re-exports only; new files contain moved bodies (no logic edits).
- Complexity budget holds (lizard: no function > CCN 10); `npm run typecheck` clean.

# References

- [Issue 0009 — pip-updater split](/issues/0009-pip-updater-split.md)
- [ADR 0007 — consolidate image resolvers](/adr/0007-consolidate-image-resolvers.md) (same move-only, facade-stable playbook)
