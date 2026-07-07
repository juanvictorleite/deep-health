---
type: ADR
title: SonarQube ViewModel — one pure normalization consumed by the HTML report, the executive section and the export
description: Extends ADR 0008's data-prep/rendering split to the SonarQube surfaces - a pure sonarqube-view-model.ts normalizes quality gate/metrics/issues once; generateSonarQubeHtmlReport (CCN 26), buildSonarQubeExecSection (CCN 24) and buildSonarQubeExport (CCN 14) consume it.
status: Accepted
tags: [architecture, reporting, sonarqube, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# ADR 0016 — SonarQube ViewModel (review 2026-07-07, candidate C3)

## Context

ADR 0008 separated data preparation from template rendering in the executive report, but the SonarQube surfaces stayed out: `generateSonarQubeHtmlReport` (`src/reporting/sonarqube-report.ts`, CCN 26, 130 NLOC) mixes quality-gate/metrics/issues normalization with HTML templating; `buildSonarQubeExecSection` (`src/reporting/sonarqube-exec-section.ts`, CCN 24) re-normalizes similar data for the executive section; `buildSonarQubeExport` (`src/reporting/sonarqube-export.ts`, CCN 14) does it a third time for the JSON export. Three sibling files share the domain by convention, not through a seam — a drift hazard and a triple test burden.

## Decision

1. **New pure module `src/reporting/sonarqube-view-model.ts`**: `buildSonarQubeViewModel(input) → SonarQubeViewModel`, normalizing once what the three consumers each derive today (quality-gate status + conditions, metric set, issue groupings, skip/error states). No I/O, no template strings.
2. **The three surfaces consume the ViewModel.** `generateSonarQubeHtmlReport` renders HTML from it; `buildSonarQubeExecSection` builds the executive section from it; `buildSonarQubeExport` serializes from it. Their exported signatures do not change; their callers (`report-artifacts.ts`, `report-view-model.ts:540`, `report-saver.ts:34`) are untouched.
3. **Byte-identical outputs.** HTML markup, section content and export JSON are preserved exactly — the existing sonarqube-report / sonarqube-exec-section / sonarqube-export-branches tests are the oracle. Where the three normalizations genuinely disagree today, the ViewModel exposes the per-surface variant explicitly (named field) rather than silently unifying — unification is a future decision, not this one.
4. **Budget:** all three consumers and the ViewModel land at cyclomatic ≤ 10 (new helpers ≤ 8).

## Consequences

- Quality-gate/metrics normalization is tested once with fixtures; the surfaces become thin projections.
- Divergences between HTML, executive section and export become visible as named ViewModel fields instead of silent drift.
- Completes ADR 0008's decision across the reporting bundle.

## Verification

- Full suite green, count ≥ current; the three existing sonarqube test files unchanged.
- lizard on the four files: zero functions above CCN 10; typecheck clean; oxlint 0 errors.

# References

- [Issue 0013 — SonarQube ViewModel](/issues/0013-sonarqube-view-model.md)
- [ADR 0008 — executive report view model](/adr/0008-executive-report-view-model.md)
