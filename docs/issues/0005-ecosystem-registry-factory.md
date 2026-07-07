---
type: Issue
title: Explicit ecosystem registry factory
description: Execute ADR 0009 — createEcosystemRegistry(plugins); declarative default registry in index.ts.
status: Done
tags: [architecture, registry]
timestamp: 2026-07-06T00:00:00Z
---

# Issue 0005 — Ecosystem registry factory

Execute [ADR 0009](/adr/0009-explicit-ecosystem-registry-factory.md).

## Scope

- `src/modules/ecosystem/registry.ts` — add `createEcosystemRegistry(plugins)`; singleton moves out.
- `src/modules/ecosystem/index.ts` — `defaultRegistry = createEcosystemRegistry([npmPlugin, composerPlugin, pipPlugin])`.
- Unit tests: factory isolation + default order (npm, composer, pip).

## Done when

- Factory test green; full suite unchanged; no import-time chained side-effect registration remains.

# References

- [ADR 0009](/adr/0009-explicit-ecosystem-registry-factory.md)
