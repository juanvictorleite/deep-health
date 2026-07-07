---
type: ADR
title: Phase Router — extract execution-plan resolution from the orchestrator
description: A pure phase-router module resolves which phases run (scan, ecosystems, report) and the per-ecosystem on-failure policy; the orchestrator executes the plan.
status: Accepted
tags: [architecture, orchestration]
timestamp: 2026-07-06T00:00:00Z
---

# ADR 0010 — Phase Router extraction (cycle-3 candidate 3)

## Context

`src/orchestration/orchestrator.ts` (574 LOC) mixes dispatch (its real job) with routing decisions: `shouldRunPhase()` (line 117), `resolveOnFailure()` (line 135), and `buildActiveEcosystemEntries()` (line 451) decide *what* runs; the rest executes it. Pipeline variants (scan-only, fix-without-scan, re-fix from saved result) would today require forking the orchestrator or conditional bloat ([cycle-3 review, candidate 3](/architecture/arch-review-2026-05-02-cycle3.md)).

## Decision

1. **New pure module `src/orchestration/phase-router.ts`** (no I/O, no Docker) exporting:
   - `interface ExecutionPlan { runScan: boolean; activeEcosystems: ActiveEcosystemEntry[]; runReport: boolean; onFailureFor(engineId: string): 'warn' | 'fail' }`
   - `resolveExecutionPlan(config: ProjectConfig, options: OrchestratorOptions): ExecutionPlan`
   It absorbs `shouldRunPhase`, `resolveOnFailure`, and `buildActiveEcosystemEntries` verbatim (same semantics, same phase names `scan` / ecosystem ids / `report`).
2. **The orchestrator consumes the plan.** `runOrchestrator` calls `resolveExecutionPlan` once at the top and branches on plan fields; the three absorbed functions are deleted from `orchestrator.ts`. Snapshot management, advisor scheduling, and sweep execution are *execution*, not routing — they stay in the orchestrator (deliberately outside this decision's scope).
3. **The router is the only phase-selection authority.** No other module re-implements `--phases` filtering.

## Consequences

- Phase-selection logic becomes pure and testable with config fixtures (no Docker, no runner mocks).
- Future pipeline variants are new `ExecutionPlan` compositions — the orchestrator body does not fork.
- `orchestrator.ts` shrinks and reads as: resolve plan → scan → ecosystem loop → post-fix sweep → report.

## Verification

- Unit tests for `resolveExecutionPlan` cover: default (all phases), `--phases scan`, `--phases npm,report`, unknown phase names, and on-failure policy resolution for primary vs secondary engines — pure fixture tests.
- Full suite passes; orchestrator behavior tests (existing) remain green, proving routing extraction is behavior-preserving.

# References

- [Cycle-3 architecture review, candidate 3](/architecture/arch-review-2026-05-02-cycle3.md)
