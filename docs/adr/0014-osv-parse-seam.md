---
type: ADR
title: Extract the OSV engine's pure parsing into an osv-parse module and decompose it within budget
description: parseOsvJsonOutput (CCN 30), extractSafeVersionFromVuln (CCN 31) and parseCvssBaseScore (CCN 30) move out of osv-engine.ts into a pure scanner/osv-parse.ts; the OSV engine becomes a thin I/O adapter and its scan (CCN 33) decomposes into phase helpers.
status: Accepted
tags: [architecture, scanner, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# ADR 0014 — OSV parse seam (review 2026-07-07, candidate C1)

## Context

`src/modules/scanner/osv-engine.ts` is the highest complexity concentration in the tree (lizard 2026-07-07): `scan` CCN 33 (137 NLOC) plus three *non-exported* helpers — `parseOsvJsonOutput` (CCN 30), `extractSafeVersionFromVuln` (CCN 31), `parseCvssBaseScore` (CCN 30). The pure transformation *osv-scanner JSON → findings* (CVSS base score, safe-version extraction across semver/GIT ranges) is buried behind the engine's only door, `scan()`, so every parsing edge case is testable only through a mocked `CommandRunner`. The module is shallow where it matters: ~91 points of cyclomatic complexity are unreachable except through I/O. The repo has executed this exact deepening twice (ADR 0008 executive ViewModel; ADR 0012 pip/transforms), both proven behavior-preserving by an untouched suite.

## Decision

1. **New pure module `src/modules/scanner/osv-parse.ts`** (no I/O, no `CommandRunner`): receives the raw osv-scanner JSON (and whatever scalar context `scan` passes today) and returns the typed findings. It absorbs `parseOsvJsonOutput`, `extractSafeVersionFromVuln`, `parseCvssBaseScore`, and the `OsvJsonOutput` interface. `osv-engine.ts` re-exports `OsvJsonOutput` so external import paths do not change.
2. **Decompose within budget in the same change.** The moved parsers and the engine's remaining `scan` are brought to cyclomatic ≤ 10 (new helpers ≤ 8) by phase extraction following each function's existing sequential structure (scan: build args → execute → interpret exit → parse → assemble result; parsers: per-concern helpers). Exact helper names are settled at implementation. Exported signatures and observable behavior do not change.
3. **The engine is the only I/O owner.** `osv-parse.ts` never imports executor/runtime modules; `osv-engine.ts` keeps binary resolution, execution and exit-code interpretation.
4. **New table tests for the parse seam.** `osv-parse` gets fixture-driven table tests (real osv-scanner JSON shapes: CVSS vectors, GIT ranges, missing fields). Existing engine tests stay untouched as the behavior oracle.

## Consequences

- CVSS/safe-version bugs become reproducible with a JSON fixture instead of a runner mock — the highest-value locality win available in the tree.
- The scan pipeline (Gate A, residual verification) hardens at its source: every consumer of findings benefits from the pinned parse.
- `osv-engine.ts` shrinks to an adapter; future output-format drift from osv-scanner lands in one pure module.
- Risk: decomposing CCN-30 control flow can reorder short-circuits — mitigated by the unchanged existing tests plus the new table tests written from the *current* behavior.

## Verification

- Full suite green with count ≥ current 3147 (new parse tests add; none removed); existing scanner tests unchanged.
- lizard on `src/modules/scanner/osv-engine.ts` + `osv-parse.ts`: zero functions above CCN 10.
- `npm run typecheck` clean; `OsvJsonOutput` importers unchanged.

# References

- [Issue 0011 — osv-parse extraction](/issues/0011-osv-parse-extraction.md)
- [ADR 0012 — pip-updater split](/adr/0012-pip-updater-module-split.md) (facade + move playbook)
- [ADR 0013 — fixer decomposition](/adr/0013-fixer-decomposition-shared-semver-helpers.md) (budget decomposition playbook)
