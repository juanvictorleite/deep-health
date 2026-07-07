---
type: Issue
title: Extract pure osv-fix-claims module; applyOsvFixViaStaging becomes the staging adapter
description: Execute ADR 0017 - parseOsvFixJson (CCN 19) + claim-vs-lockfile reconciliation move to orchestration/osv-fix-claims.ts (pure); applyOsvFixViaStaging (CCN 25) keeps only staging I/O, decomposed within budget; new claim table tests.
status: open
tags: [architecture, orchestration, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# Issue 0014 — OSV fix claims extraction

Executes [ADR 0017](/adr/0017-osv-fix-claims-seam.md). Behavior-preserving; existing `osv-fix-applier.test.ts` is the oracle and does not change.

## Scope

- New `src/orchestration/osv-fix-claims.ts` (pure, no fs/CommandRunner): `parseOsvFixJson`, `claimIsSatisfiedOnDisk`, claims+version-maps -> verified/rejected reconciliation.
- `osv-fix-applier.ts` keeps staging I/O only, decomposed <= 10; signature `OsvFixApplyInput -> OsvFixApplyResult` unchanged; `parseOsvFixJson` re-exported.
- New table tests (satisfied/false/partial/malformed claims) pinned to current behavior.

## Done when

- Full suite green (count >= current, existing tests unchanged); lizard on both files: zero above CCN 10; typecheck + oxlint clean.

# References

- [ADR 0017](/adr/0017-osv-fix-claims-seam.md)
