---
type: Issue
title: Add applied dependency changes to the Markdown report
description: Execute BDR 0002 with explicit package-update evidence and an empty-state message.
status: done
tags: [reporting, markdown, audit]
timestamp: 2026-09-04T00:00:00Z
---

# Issue 0019 — Report applied dependency changes

Executes [BDR 0002](/bdr/0002-report-applied-dependency-changes.md).

## Scope

- Add normalized dependency-change rows to the executive report view model.
- Render the rows in the Markdown template using localized labels.
- Render an explicit empty state when `packages_updated` is empty across all
  ecosystem entries.

## Done when

- The report never implies a package mutation without `packages_updated`
  evidence.
- Populated and empty cases are covered by unit tests.
- Docs lint, typecheck, and reporting tests pass.

## Verification

- Markdown tests cover populated and empty dependency-change evidence.
- Golden-master snapshots include the new section and use a fixed clock.
- `npm test`: 3236 tests passed; integration, typecheck, build, and docs lint passed.
