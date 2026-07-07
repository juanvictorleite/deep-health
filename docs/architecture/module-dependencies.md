---
type: Architecture View
title: Module dependency rules
description: The allowed dependency directions between src/ top-level modules; core/ is the dependency root.
timestamp: 2026-07-06T00:00:00Z
---

# Module Dependency Rules

```
app/         → orchestration, modules, core, infrastructure, reporting
orchestration → modules, core, infrastructure
modules/ecosystem → core, infrastructure
modules/scanner   → core, infrastructure
reporting    → core, infrastructure
infrastructure → core (types only — no business logic)
core/        → (no internal imports — pure domain)
```

`core/` is the dependency root. Nothing in `core/` imports from `infrastructure/`, `modules/`, `app/`, or `orchestration/`. Any import from `@infra/` inside `@core/` is a contract violation — enforced by the layer-purity fitness test (`tests/unit/core/layer-purity.test.ts`, [ADR 0006](/adr/0006-core-layer-purity.md)), which walks `src/core/` and fails on any outer-layer import.

**Type-only imports policy** ([ADR 0006](/adr/0006-core-layer-purity.md), decision 4): `infrastructure/` MAY import **types** from `modules/` (`import type { EcosystemPlugin } …`) — compile-time-only, erased at build. Runtime imports from `modules/` into `infrastructure/` remain forbidden. Current sanctioned instances: `config/loader.ts`, `ecosystem-runtime/resolve.ts`, `utils/detect-ecosystems.ts`.

> Instrument note: `core/` purity is now gated by the layer-purity test. The remaining directions (orchestration→modules etc.) have no deterministic gate (no dependency-cruiser/arch-gate ruleset committed); drift there is caught by review inspection. Wiring a full ruleset stays a candidate follow-up under [ADR 0005](/adr/0005-adopt-living-docs-governance.md)'s consequences.
