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

`core/` is the dependency root. Nothing in `core/` imports from `infrastructure/`, `modules/`, `app/`, or `orchestration/`. This boundary is enforced by convention — any import from `@infra/` inside `@core/` is a contract violation.

> Instrument note: this view currently has no deterministic gate (no dependency-cruiser/arch-gate ruleset is committed). Drift is caught by review inspection. Wiring a committed ruleset is a candidate follow-up under [ADR 0005](/adr/0005-adopt-living-docs-governance.md)'s consequences.
