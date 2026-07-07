---
type: ADR
title: Executive report — separate data preparation from template rendering
description: Extract a typed ReportViewModel builder from reporting/executive.ts; rendering (Handlebars, DOCX) consumes the prepared model.
status: Accepted
tags: [architecture, reporting]
timestamp: 2026-07-06T00:00:00Z
---

# ADR 0008 — Executive report ViewModel split (cycle-3 candidate 4)

## Context

`src/reporting/executive.ts` (584 LOC) mixes two concerns: ~30 pure data-transform functions (`dedupVulns`, `resolveEcoEntries`, `injectAuditFindings`, `buildFixedVulnRows`, `buildPendingVulnRows`, `buildBlockedVulnRows`, `buildEvidenceSection`, `buildSummaryLabels`, …) culminating in `buildExecutiveReportContext` / `buildEntryReportContext` (lines ~508–648), and template rendering (`generateExecutiveReport` → `render()` at 574–576). The context is an untyped `Record<string, unknown>`. `docx-executive.ts` (362 LOC) builds a DOCX report from overlapping data. Testing report logic requires going through rendering; a new output format cannot reuse the transforms ([cycle-3 review, candidate 4](/architecture/arch-review-2026-05-02-cycle3.md)).

## Decision

1. **New module `src/reporting/report-view-model.ts`.** All pure transform functions move there (verbatim behavior). It exports:
   - `interface ExecutiveReportViewModel` — a typed replacement for the `Record<string, unknown>` context, field-for-field identical keys so templates need no changes.
   - `buildExecutiveReportViewModel(opts: ExecutiveReportOptions): ExecutiveReportViewModel` (absorbs `buildExecutiveReportContext`)
   - `buildEntryReportViewModel(opts, entryKey)` (absorbs `buildEntryReportContext`)
   - The small formatting helpers currently exported from `executive.ts` (`escapeMdTableCell`, `vulnLink`) move with the transforms and are re-exported by `executive.ts` to keep the public API surface (`src/index.ts`) stable.
2. **`executive.ts` becomes the render seam.** It keeps `generateExecutiveReport`, `generateEntryReport`, `executiveReportFilename`, `splitReportFilename` — each a thin call: build view model → `render(template, viewModel)`.
3. **DOCX consumes the same model.** `docx-executive.ts` replaces its own duplicated row/summary preparation with fields from `ExecutiveReportViewModel` where the data overlaps; DOCX-specific layout/styling code stays put. No visual change intended.
4. **Rendering stays Handlebars.** No template-engine change in this decision.

## Consequences

- Report logic becomes unit-testable without Handlebars; the ViewModel is the contract.
- New output formats (JSON, Markdown-only, future PDF) reuse `buildExecutiveReportViewModel` — leverage per cycle-3's goal.
- Two files stay under ~350 LOC each instead of one 584-LOC mixed module.

## Verification

- Snapshot/equality test: for a fixture `ExecutiveReportOptions`, the HTML output of `generateExecutiveReport` is byte-identical before and after the split (golden-master test committed with the change).
- View-model unit tests assert row-building behavior directly on `buildExecutiveReportViewModel` output (no render involved).

# References

- [Cycle-3 architecture review, candidate 4](/architecture/arch-review-2026-05-02-cycle3.md)
