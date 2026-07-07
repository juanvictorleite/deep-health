---
type: Issue
title: Extract pure osv-parse module from osv-engine; decompose scan and parsers within budget
description: Execute ADR 0014 - move parseOsvJsonOutput/extractSafeVersionFromVuln/parseCvssBaseScore + OsvJsonOutput into scanner/osv-parse.ts (pure), decompose them and the engine's scan to cyclomatic <= 10, add fixture-driven table tests for the parse seam.
status: open
tags: [architecture, scanner, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# Issue 0011 — osv-parse extraction

Executes [ADR 0014](/adr/0014-osv-parse-seam.md). Behavior-preserving; existing scanner tests are the oracle and do not change.

## Scope

- New `src/modules/scanner/osv-parse.ts` (no I/O): absorbs `parseOsvJsonOutput`, `extractSafeVersionFromVuln`, `parseCvssBaseScore`, `OsvJsonOutput`; `osv-engine.ts` re-exports `OsvJsonOutput`.
- Decompose the moved parsers and the engine's `scan` (CCN 33) to <= 10 (new helpers <= 8), phase extraction along existing sequential structure.
- New fixture-driven table tests for `osv-parse` (CVSS vectors, semver/GIT ranges, missing fields) written from current behavior.

## Done when

- Full suite green (count >= 3147, existing tests unchanged); lizard on osv-engine.ts + osv-parse.ts shows zero functions above CCN 10; typecheck clean.

# References

- [ADR 0014](/adr/0014-osv-parse-seam.md)
