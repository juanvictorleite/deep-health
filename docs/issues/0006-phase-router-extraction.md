---
type: Issue
title: Extract Phase Router from orchestrator
description: Execute ADR 0010 — pure phase-router.ts resolving ExecutionPlan; orchestrator consumes the plan.
status: Done
tags: [architecture, orchestration]
timestamp: 2026-07-06T00:00:00Z
---

# Issue 0006 — Phase Router extraction

Execute [ADR 0010](/adr/0010-phase-router-extraction.md).

## Scope

- New `src/orchestration/phase-router.ts` — `ExecutionPlan` + `resolveExecutionPlan` (absorbs `shouldRunPhase`, `resolveOnFailure`, `buildActiveEcosystemEntries`).
- `src/orchestration/orchestrator.ts` — consume the plan; delete absorbed functions.
- Pure fixture unit tests for the router; existing orchestrator tests stay green.

## Done when

- Router covered by fixture tests; orchestrator behavior-preserving (full suite green).

# References

- [ADR 0010](/adr/0010-phase-router-extraction.md)
