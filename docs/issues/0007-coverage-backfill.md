---
type: Issue
title: Coverage backfill — raise the ratchet floors incrementally
description: Standing ticket executing ADR 0011's backfill half - add tests to the lowest-covered areas and raise the vitest threshold floors (raise-only) as each area lands.
status: open
tags: [testing, coverage]
timestamp: 2026-07-06T00:00:00Z
---

# Issue 0007 — Coverage backfill (ratchet raise)

Execute the backfill half of [ADR 0011](/adr/0011-coverage-ratchet-policy.md). The ratchet half (floors at the measured baseline: statements 94.5, functions 95.5, lines 86, branches 94.5) lands with the ADR.

## Scope

- Identify the lowest-covered files (`npx vitest run --coverage` per-file report; lines 86.33 is the weakest metric — start there).
- Add behavior-asserting tests (not implementation-mirroring) per the test-effectiveness standing AC.
- In the SAME change that raises a metric, raise its floor in `vitest.config.ts` to just below the new measured value (raise-only rule).

## Done when

- Recurring: each slice raises at least one floor. The ticket closes when all four floors reach the team's agreed target (aspirationally 100/100/100/100 per ADR 0011).

# References

- [ADR 0011](/adr/0011-coverage-ratchet-policy.md)
