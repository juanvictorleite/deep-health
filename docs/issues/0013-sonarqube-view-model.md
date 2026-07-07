---
type: Issue
title: SonarQube ViewModel - single pure normalization for HTML report, executive section and export
description: Execute ADR 0016 - new pure sonarqube-view-model.ts consumed by generateSonarQubeHtmlReport (CCN 26), buildSonarQubeExecSection (CCN 24) and buildSonarQubeExport (CCN 14); outputs byte-identical; all within budget.
status: open
tags: [architecture, reporting, sonarqube, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# Issue 0013 — SonarQube ViewModel

Executes [ADR 0016](/adr/0016-sonarqube-view-model.md). Byte-identical outputs; the three existing sonarqube test files are the oracle and do not change.

## Scope

- New `src/reporting/sonarqube-view-model.ts` (pure): quality gate, metrics, issue groupings, skip/error states normalized once; genuine per-surface divergences exposed as named fields (no silent unification).
- `sonarqube-report.ts`, `sonarqube-exec-section.ts`, `sonarqube-export.ts` consume the ViewModel; exported signatures unchanged; callers untouched.
- New table tests for the ViewModel; all four files within complexity budget.

## Done when

- Full suite green (count >= current, existing tests unchanged); lizard on the four files: zero above CCN 10; typecheck + oxlint clean.

# References

- [ADR 0016](/adr/0016-sonarqube-view-model.md)
