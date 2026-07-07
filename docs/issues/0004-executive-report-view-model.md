---
type: Issue
title: Split executive report into ViewModel builder + render seam
description: Execute ADR 0008 — report-view-model.ts with typed ExecutiveReportViewModel; executive.ts renders; docx reuses the model.
status: Done
tags: [architecture, reporting]
timestamp: 2026-07-06T00:00:00Z
---

# Issue 0004 — Executive report ViewModel split

Execute [ADR 0008](/adr/0008-executive-report-view-model.md).

## Scope

- New `src/reporting/report-view-model.ts` — transforms + `ExecutiveReportViewModel` + `buildExecutiveReportViewModel` / `buildEntryReportViewModel`.
- `src/reporting/executive.ts` — becomes the render seam; re-exports moved helpers for API stability.
- `src/reporting/docx-executive.ts` — consume overlapping ViewModel fields.
- Golden-master test: HTML output byte-identical before/after for a fixture.

## Done when

- Golden-master equality holds; view-model unit tests pass without Handlebars; full suite green.

# References

- [ADR 0008](/adr/0008-executive-report-view-model.md)
