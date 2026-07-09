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

# References

- [ADR 0011](/adr/0011-coverage-ratchet-policy.md)
