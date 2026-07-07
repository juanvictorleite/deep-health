---
type: Issue
title: Remove infra logger import from core gates; add layer-purity fitness test
description: Execute ADR 0006 — GateResult.warnings as data, caller-side logging, layer-purity unit test, type-only policy documented.
status: Done
tags: [architecture, core, layering]
timestamp: 2026-07-06T00:00:00Z
---

# Issue 0002 — Core layer purity fix

Execute [ADR 0006](/adr/0006-core-layer-purity.md).

## Scope

- `src/core/types/common.ts` — add optional `warnings: string[]` to `GateResult`.
- `src/core/gates/validator.ts` — drop the `@infra/utils/logger` import; return the all-skipped warning in `warnings`.
- Ecosystem-gate call site (orchestration layer) — log `result.warnings` via the existing logger.
- `tests/unit/core/layer-purity.test.ts` — new fitness test (no outer-layer imports under `src/core/`).
- `docs/architecture/module-dependencies.md` — type-only import policy note (Architect updates in same change).

## Done when

- Layer-purity test passes and would fail on a reintroduced `@infra` import in core.
- Gate warning surfaces via caller logging; full suite green.

# References

- [ADR 0006](/adr/0006-core-layer-purity.md)
