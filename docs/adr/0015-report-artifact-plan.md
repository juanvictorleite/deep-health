---
type: ADR
title: Report artifact plan — a pure plan resolver decides which artifacts to generate; the app layer executes it
description: generateAndSaveReportArtifacts (CCN 26) splits into a pure artifact-plan resolver plus a thin executor dispatching to the existing per-format generators; runFixPipeline (CCN 28) decomposes into phase helpers.
status: Accepted
tags: [architecture, app, reporting, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# ADR 0015 — Report artifact plan (review 2026-07-07, candidate C2)

## Context

The app layer should be a thin CLI adapter over orchestration, but it carries the second-largest complexity cluster (lizard 2026-07-07): `runFixPipeline` CCN 28 (91 NLOC), `runFixCommand` CCN 18 (`src/app/commands/fix.ts`), and `generateAndSaveReportArtifacts` CCN 26 (77 NLOC, `src/app/report-artifacts.ts`). The artifact function fans out to every format in one branch tree — executive HTML, executive DOCX, SonarQube HTML, SonarQube export, split per-entry reports — knowing each generator's mechanics (10 callees). The decision *which artifacts to produce for this config/result* is entangled with *producing them*. This is the same smell ADR 0010 removed from the orchestrator with the phase router.

## Decision

1. **New pure module `src/app/report-artifact-plan.ts`**: `resolveArtifactPlan(input) → ArtifactPlan`, where the input is the same data `generateAndSaveReportArtifacts` already receives (`ReportArtifactsInput` + config-derived flags) and the plan is a declarative list of artifact descriptors (kind, target filename/dir, per-entry split flags). No I/O, no generator imports.
2. **`generateAndSaveReportArtifacts` becomes the plan executor**: resolve the plan once, iterate it, dispatch each descriptor to the existing generator (unchanged: `generateExecutiveReport`, `generateExecutiveReportDocx`, `generateSonarQubeHtmlReport`, `saveSonarQubeExport`, split-report path). Its exported signature and observable file outputs do not change.
3. **`runFixPipeline` decomposes into phase helpers** (renderer selection, breaking-authorization handling, summary formatting, audit-trail write) following its existing sequential structure, each cyclomatic ≤ 8. `runFixCommand`'s CLI-flag branching is brought ≤ 10 the same way. CLI-observable behavior (output, exit codes, artifacts) unchanged.
4. **The plan resolver is the only artifact-selection authority** — no generator decides for itself whether it should run.

## Consequences

- "Which artifacts does this config produce" becomes a pure fixture test — today it requires mocking whole DOCX/HTML generators.
- New export formats become a descriptor + adapter, not another branch inside CCN 26.
- Mirrors the proven phase-router shape (ADR 0010): resolve plan → execute plan.
- Risk: artifact filenames/order are user-visible; the executor must preserve today's names and generation order — pinned by existing `report-artifacts-docx`/`split-reports` tests.

## Verification

- Full suite green, count ≥ current (new plan tests add); existing app/report tests unchanged.
- lizard on `src/app/commands/fix.ts` + `src/app/report-artifacts.ts` + `report-artifact-plan.ts`: zero functions above CCN 10.
- `npm run typecheck` clean; `ReportArtifactsInput` and `runFixPipeline`/`runFixCommand` signatures unchanged.

# References

- [Issue 0012 — artifact plan extraction](/issues/0012-report-artifact-plan.md)
- [ADR 0010 — phase router extraction](/adr/0010-phase-router-extraction.md) (the resolve/execute pattern this repeats)
