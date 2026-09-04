---
type: BDR
title: Executive report states applied dependency changes explicitly
description: Markdown reports list packages recorded as updated or state that no dependency changed.
status: Accepted
tags: [behavior, reporting, audit]
timestamp: 2026-09-04T00:00:00Z
---

# BDR 0002 — Executive report states applied dependency changes explicitly

## Behavior

The Markdown executive report contains a dedicated dependency-changes section.
Its evidence is exclusively `updates[*].packages_updated`; vulnerability count
changes, classifications, and advisor findings cannot imply that a package was
changed.

## Scenarios

| Given | When | Then |
|---|---|---|
| one or more recorded package updates | the Markdown report is generated | list each ecosystem entry and its exact package reference |
| no recorded package updates | the Markdown report is generated | state explicitly that no dependency was changed automatically |
| multiple ecosystem entries | updates are present in more than one entry | group each package reference under its ecosystem label |

## Test design

View-model tests cover populated and empty update evidence. Markdown renderer
tests cover the localized section text and exact package references.
