---
type: Context
title: Pipeline vocabulary
description: Canonical terms for the fix pipeline — orchestrator, per-ecosystem fix flow, phases, gates.
tags: [context, pipeline]
timestamp: 2026-07-06T00:00:00Z
---

# Pipeline

**Orchestrator** — `runOrchestrator()` in `src/orchestration/orchestrator.ts`. Owns the full `fix` pipeline: scan → Gate A → per-ecosystem fix → Ecosystem Gate → result aggregation. After Candidate 2's deepening, the per-ecosystem body is delegated to `runEcosystemFix`; the orchestrator only filters phases, runs advisors, dispatches, and aggregates.

**Per-Ecosystem Fix Flow** — `runEcosystemFix()` in `src/orchestration/run-ecosystem-fix.ts`. Encapsulates the per-plugin sub-pipeline: has-updates gate → effective runner resolution → OSV staging-fix → updater → breaking-install → OSV residual verification → ecosystem gate. Returns a tagged outcome (`skipped` / `success` / `error`) for the orchestrator to aggregate. Throws `GateValidationError` when the ecosystem gate rejects.

**Phase** — one of: `scan`, an ecosystem id (`npm`, `pip`, `composer`), or `report`. The `--phases` CLI flag selects a subset.

**Gate A** — Zod-validated schema check on the primary engine's `ScanResultJson`. Failure is fatal.

**Ecosystem Gate** — Zod-validated schema check on a per-ecosystem `UpdateResultJson`. Failure is fatal for that ecosystem.
