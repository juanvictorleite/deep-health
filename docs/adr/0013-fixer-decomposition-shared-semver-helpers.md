---
type: ADR
title: Decompose the audit fixers and give the duplicated semver helpers one home
description: applyNpmAuditFix (CCN 38) and applyOsvThenAuditFix (CCN 20) decompose into phase helpers within complexity budget; the byte-identical semverMax/isUpgraded pairs move to a shared fixers/semver-utils.ts.
status: Accepted
tags: [architecture, ecosystem, fixers, complexity]
timestamp: 2026-07-06T00:00:00Z
---

# ADR 0013 — Fixer decomposition + shared semver helpers

## Context

Fresh measurement (lizard, 2026-07-06) shows the only two complexity-budget violations in the codebase live in the fixers:

| Function | File | CCN | NLOC |
|---|---|---|---|
| `applyNpmAuditFix` | `src/modules/ecosystem/fixers/npm-audit-fixer.ts:81-259` | **38** | 123 |
| `applyOsvThenAuditFix` | `src/modules/ecosystem/fixers/osv-then-audit-fixer.ts:73-176` | **20** | 71 |

Both exceed the budget ceiling (cyclomatic ≤ 10). Additionally, `semverMax` (CCN 9) and `isUpgraded` (CCN 6) are duplicated **byte-for-byte** between the two fixer files (identical NLOC/token counts) — a drift hazard the duplication gate would flag on any future edit. The ARCH-IMPROVE round report's older hotspot list (`runEcosystemLoop`, `resolveFixLockfilePath`) is stale: both were already brought within budget by the ADR 0006–0010 round (measured CCN 4 and 9 respectively).

## Decision

1. **New module `src/modules/ecosystem/fixers/semver-utils.ts`** exporting `semverMax` and `isUpgraded`. Both fixer files import from it; the local copies are deleted. One home per fact.
2. **Decompose `applyNpmAuditFix`** into named phase helpers, each with a single responsibility and cyclomatic ≤ 8 (new-function budget). The phase boundaries follow the function's existing sequential structure (parse audit output → classify advisories → apply fix → verify upgrades → build result); exact helper names are settled at implementation from that structure, not invented top-down. The exported signature and behavior of `applyNpmAuditFix` do not change.
3. **Decompose `applyOsvThenAuditFix`** the same way (OSV pass → audit pass → merge/partial-revert → result), same budget, same signature stability.
4. **Behavior-preserving, test-pinned.** Existing tests (`tests/unit/plugins/npm-audit-fixer.test.ts` and the osv-then-audit coverage) are the oracle: they do not change and must stay green with identical count. Prefer guard clauses and early returns over helper proliferation — the budget is a ceiling, not a target.

## Consequences

- The two worst functions in the codebase (CCN 38, 20) come within budget; future edits to fix logic touch a phase helper, not a 180-line monolith.
- The semver comparison logic has exactly one implementation; a future fix (e.g. prerelease handling) lands once.
- `fixers/` gains one module; its `index.ts` surface is unchanged.
- Risk: decomposition of dense control flow can subtly reorder short-circuits — mitigated by the move of *logic into helpers with explicit inputs/outputs* plus the unchanged-test oracle.

## Verification

- lizard on `src/modules/ecosystem/fixers/`: zero functions above CCN 10 (currently two).
- Duplication gate: no duplicated `semverMax`/`isUpgraded` blocks remain.
- Full suite green with identical test count; `npm run typecheck` clean; exported signatures unchanged (`git diff` on `index.ts` empty or re-export-only).

# References

- [Issue 0010 — fixer decomposition](/issues/0010-fixer-decomposition.md)
- [ADR 0011 — coverage ratchet policy](/adr/0011-coverage-ratchet-policy.md) (the tests-as-oracle discipline this relies on)
