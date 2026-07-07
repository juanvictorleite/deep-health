---
type: ADR
title: OSV fix claims — pure claim parsing/reconciliation separated from the staging adapter
description: applyOsvFixViaStaging (CCN 25, 140 NLOC) splits - parseOsvFixJson (CCN 19) and the claim-vs-lockfile reconciliation move to a pure orchestration/osv-fix-claims.ts; the applier keeps only staging I/O, decomposed within budget.
status: Accepted
tags: [architecture, orchestration, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# ADR 0017 — OSV fix claims seam (review 2026-07-07, candidate C4)

## Context

`src/orchestration/osv-fix-applier.ts` interleaves two concerns inside `applyOsvFixViaStaging` (CCN 25, 140 NLOC): staging-directory I/O (copy manifests, run `osv-scanner fix`, restore/rollback) and the pure logic of interpreting the fixer's *claims* — `parseOsvFixJson` (CCN 19) plus the claim-vs-lockfile reconciliation that decides which claimed updates actually happened (`claimIsSatisfiedOnDisk` was already extracted, evidence the seam exists but is incomplete). False claims are the classic bug of this area (cf. the "count genuine transitive upgrades" fix, commit da13ce4); today they are only testable through a staged filesystem.

## Decision

1. **New pure module `src/orchestration/osv-fix-claims.ts`**: absorbs `parseOsvFixJson`, `claimIsSatisfiedOnDisk` and the reconciliation that maps *claims + before/after version maps → verified updates / rejected claims*. No filesystem, no CommandRunner: inputs are strings and version maps, outputs are typed decisions.
2. **`applyOsvFixViaStaging` becomes the staging adapter**: filesystem staging, execution, snapshot collection (it keeps calling `collectNpmLockfileVersions`), rollback — delegating every interpretation to `osv-fix-claims`. Decomposed into phase helpers ≤ 10 (new helpers ≤ 8). Exported signature (`OsvFixApplyInput → OsvFixApplyResult`) and behavior unchanged; `parseOsvFixJson` stays importable from `osv-fix-applier.ts` via re-export.
3. **New table tests for the claims seam** (claim satisfied / claim false / partial / malformed JSON), pinned to current behavior. Existing `osv-fix-applier.test.ts` untouched as oracle.

## Consequences

- False-claim logic becomes fixture-testable without staging directories — locality where this area's real bugs live.
- The Gate A per-ecosystem verification hardens at its source.
- Risk: reconciliation semantics are subtle (root vs transitive, semver-at-least) — mitigated by verbatim moves + the unchanged oracle.

## Verification

- Full suite green, count ≥ current; existing applier tests unchanged.
- lizard on `osv-fix-applier.ts` + `osv-fix-claims.ts`: zero functions above CCN 10; typecheck clean; oxlint 0 errors.

# References

- [Issue 0014 — fix claims extraction](/issues/0014-osv-fix-claims.md)
- [ADR 0014 — osv-parse seam](/adr/0014-osv-parse-seam.md) (same pure-seam playbook, scan side)
