---
type: Issue
title: Artifact plan resolver in the app layer; decompose runFixPipeline and the artifact fan-out
description: Execute ADR 0015 - new pure report-artifact-plan.ts resolver; generateAndSaveReportArtifacts becomes the plan executor; runFixPipeline/runFixCommand decompose into phase helpers within budget.
status: done
tags: [architecture, app, reporting, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# Issue 0012 — Report artifact plan

Executes [ADR 0015](/adr/0015-report-artifact-plan.md). CLI-observable behavior (outputs, exit codes, artifact filenames and order) unchanged; existing tests are the oracle.

## Scope

- New `src/app/report-artifact-plan.ts`: pure `resolveArtifactPlan` + `ArtifactPlan` descriptors; no generator imports.
- `src/app/report-artifacts.ts`: `generateAndSaveReportArtifacts` (CCN 26) becomes the executor iterating the plan; signature unchanged.
- `src/app/commands/fix.ts`: `runFixPipeline` (CCN 28) and `runFixCommand` (CCN 18) decompose into phase helpers <= 8/10.
- New table tests for the plan resolver; existing app tests untouched.

## Done when

- Full suite green (count >= 3147, existing tests unchanged); lizard on fix.ts + report-artifacts.ts + report-artifact-plan.ts shows zero functions above CCN 10; typecheck clean.

# References

- [ADR 0015](/adr/0015-report-artifact-plan.md)
