---
type: ADR
title: Core layer purity — no runtime imports from outer layers
description: Remove the @infra logger import from core/gates/validator.ts by returning warnings as data; add a fitness function locking core's import-free status.
status: Accepted
tags: [architecture, layering, core]
timestamp: 2026-07-06T00:00:00Z
---

# ADR 0006 — Core layer purity: no runtime imports from outer layers

## Context

The dependency rule (see [module-dependencies view](/architecture/module-dependencies.md)) declares `core/` the dependency root: it imports nothing from `infrastructure/`, `modules/`, `orchestration/`, `reporting/`, or `app/`. The 2026-07-06 architecture exploration found one violation: `src/core/gates/validator.ts:3` imports `logger` from `@infra/utils/logger`, used for a single `logger.warn` inside `validateEcosystemGate` when every validation entry is `skipped`.

A side-effect (logging) inside a pure validator also makes the gate harder to test and couples core to the logger's transport.

## Decision

1. **Warnings become data, not side effects.** `GateResult` (in `core/types/common.ts`) gains an optional `warnings: string[]` field. `validateEcosystemGate` returns the all-validations-skipped message as a warning entry instead of calling the logger. The import of `@infra/utils/logger` is removed from `core/`.
2. **Callers own presentation.** Call sites of `validateEcosystemGate` (the ecosystem-gate check in the orchestration layer) log `result.warnings` via the existing logger.
3. **Fitness function.** A unit test (`tests/unit/core/layer-purity.test.ts`) walks every file under `src/core/` and fails if any import path matches `@infra/`, `@modules/`, `@orchestration/`, `@reporting/`, or `@app/` (or their relative equivalents escaping `src/core/`). This turns the layering rule from prose into an executable check.
4. **Type-only imports policy (infra → modules).** `infrastructure/` files may import **types** from `modules/` (`import type { EcosystemPlugin } …`) — a compile-time-only dependency erased at build. Runtime imports from `modules/` into `infrastructure/` remain forbidden. The [module-dependencies view](/architecture/module-dependencies.md) is updated to state this explicitly.

## Consequences

- `core/` becomes verifiably I/O-free; the layer rule is enforced by test, not convention.
- Gate warnings surface at exactly one presentation point instead of deep inside validation.
- The existing type-only imports in `infrastructure/config/loader.ts`, `infrastructure/ecosystem-runtime/resolve.ts`, and `infrastructure/utils/detect-ecosystems.ts` become documented policy rather than ambiguous violations.

## Verification

- Fitness function: `npx vitest run --project unit tests/unit/core/layer-purity.test.ts` passes and fails on any reintroduced outer-layer import in `src/core/`.
- `validateEcosystemGate` unit tests assert the warning is returned in `GateResult.warnings` (no logger spy needed).

# References

- Exploration run 2026-07-06 (codegraph): `src/core/gates/validator.ts:3`, single use at line 139.
