---
type: ADR
title: Coverage thresholds become a ratchet at the measured baseline, not an aspirational 100
description: vitest coverage thresholds were 100/100/100 (statements/functions/lines) + 88 (branches) while the measured baseline is statements 94.94, functions 94.88, lines 96.19, branches 86.38 — every metric fails, so every full coverage run is red for pre-existing reasons, the gate carries zero signal, and true regressions are invisible. Decision — set each threshold to a floor just below the measured baseline (statements 94.5, functions 94.5, lines 95.5, branches 86), making CI green on the current tree and red only on real regressions; Issue 0007 tracks raising the floors as backfill tests land (raise-only rule from these floors on — a floor never goes down again).
status: Accepted
supersedes:
superseded_by:
tags: [testing, coverage, ratchet, ci]
timestamp: 2026-07-06T00:00:00Z
---

# 0011. Coverage ratchet at the measured baseline

## Context

`vitest.config.ts` declares `thresholds: { statements: 100, functions: 100, lines: 100, branches: 88 }`. The measured baseline (full `npx vitest run --coverage` on the current tree, 2026-07-06, 3147 tests green; an earlier capture during ARCH-IMPROVE-001 recorded the same four numbers with rotated metric labels — corrected here from `coverage-summary.json`):

| Metric | Threshold | Measured | State |
|---|---|---|---|
| statements | 100 | 94.94 | always failing |
| functions | 100 | 94.88 | always failing |
| lines | 100 | 96.19 | always failing |
| branches | 88 | 86.38 | always failing |

A gate that always fails is noise: every full `--coverage` run is red regardless of the change under review, so a genuine coverage regression is indistinguishable from the pre-existing shortfall (the same anti-fatigue failure mode as the arm64 QG image, ai-configs ADR 0034).

## Decision

**Ratchet, then backfill.**

1. Set each threshold to a floor just below the measured baseline (margin ≈ 0.3–0.7 pt to absorb line-count drift from unrelated edits):
   `statements: 94.5, functions: 94.5, lines: 95.5, branches: 86`.
   Branches drops 88 → 86 — an honest one-time reset to measured reality (88 was never actually met).
2. **Raise-only rule:** from these floors on, a floor may only move up. When backfill tests raise a metric, the floor follows it (again just below the new measured value) in the same change.
3. [Issue 0007](/issues/0007-coverage-backfill.md) is the standing backfill ticket: it tracks the lowest-covered areas and raises floors incrementally. 100 remains the aspiration, reached by ratcheting, not by declaring.

## Consequences

- Full-suite coverage runs become a real instrument: green on the current tree, red only when a change drops coverage below the measured floor.
- Reviewers stop discounting coverage failures as "pre-existing" — any failure is now attributable to the change under review.
- The floors must be maintained (raise-only) or the ratchet decays into a static lowered bar; Issue 0007 owns that maintenance.

## Verification

- `npx vitest run --coverage` exits 0 on the unmodified tree after the change.
- `vitest.config.ts` thresholds match the table in the Decision section exactly.

# References

- ai-configs [ADR 0034] — anti-fatigue precedent (a permanently-red gate is noise).
- Baseline measurement: ARCH-IMPROVE-001 S1 git-stash comparison (run 2649).
