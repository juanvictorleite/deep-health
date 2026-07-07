---
type: Issue
title: Decompose applyNpmAuditFix and applyOsvThenAuditFix; deduplicate semver helpers
description: Execute ADR 0013 - bring the two complexity-budget violations (CCN 38 and 20) within budget via phase-helper extraction, and move the byte-identical semverMax/isUpgraded pairs into fixers/semver-utils.ts.
status: done
tags: [architecture, ecosystem, fixers, complexity]
timestamp: 2026-07-06T00:00:00Z
---

# Issue 0010 — Fixer decomposition + shared semver helpers

Executes [ADR 0013](/adr/0013-fixer-decomposition-shared-semver-helpers.md). Behavior-preserving; the unchanged existing tests are the oracle.

## Scope

- New `src/modules/ecosystem/fixers/semver-utils.ts` exporting `semverMax` and `isUpgraded`; both fixer files import it and delete their local copies.
- Decompose `applyNpmAuditFix` (`npm-audit-fixer.ts:81-259`, CCN 38) into named phase helpers, each cyclomatic ≤ 8; exported signature unchanged.
- Decompose `applyOsvThenAuditFix` (`osv-then-audit-fixer.ts:73-176`, CCN 20) the same way.
- `fixers/index.ts` surface unchanged.

## Done when

- lizard on `src/modules/ecosystem/fixers/` reports zero functions above CCN 10; no duplicated semver helper blocks; full suite green with identical count; typecheck clean.

# References

- [ADR 0013](/adr/0013-fixer-decomposition-shared-semver-helpers.md)
