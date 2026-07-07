---
type: ADR
title: Explicit ecosystem registry factory (no side-effect bootstrap)
description: Mirror the scanner module's explicit bootstrap — createEcosystemRegistry(plugins) replaces import-time side-effect registration.
status: Accepted
tags: [architecture, registry, ecosystem]
timestamp: 2026-07-06T00:00:00Z
---

# ADR 0009 — Explicit ecosystem registry factory (cycle-3 candidate 5)

## Context

`src/modules/ecosystem/index.ts:15` registers the three plugins as an import-time side effect (`defaultRegistry.register(npmPlugin).register(composerPlugin).register(pipPlugin)`). Any test importing the module gets all real plugins with no seam to inject a partial or fake registry. The scanner module already solved this: `bootstrapDefaultEngines(registry)` is explicit, idempotent, and callers may inject a custom registry ([cycle-3 review, candidate 5](/architecture/arch-review-2026-05-02-cycle3.md) — scanner half already done).

## Decision

1. **Factory in `registry.ts`.** `createEcosystemRegistry(plugins: EcosystemPlugin[]): EcosystemRegistry` — constructs a registry and registers the given plugins in array order (Map insertion order is the phase order; npm before composer before pip).
2. **`index.ts` uses the factory declaratively.** `export const defaultRegistry = createEcosystemRegistry([npmPlugin, composerPlugin, pipPlugin]);` replaces the chained side-effect statement. The default registry remains eagerly available at import (backward-compatible for every current caller), but the plugin list is now declarative and visible, and tests build isolated registries via the factory.
3. **`registry.ts` stops owning the singleton.** The `defaultRegistry` instance moves to `index.ts` (composition point); `registry.ts` keeps the class + factory only. If today's code already places the singleton in `registry.ts`, it is relocated — importers of `defaultRegistry` repoint to `@modules/ecosystem` (the public API entry, which already re-exports it).

## Consequences

- Test isolation: orchestrator/unit tests inject `createEcosystemRegistry([fakePlugin])` — no monkey-patching, no accidental real npm/pip/composer plugins.
- The registered-plugin list is declarative, mirroring the scanner module's explicit bootstrap; both plugin systems now follow one convention.
- No behavior change for production callers.

## Verification

- Unit test: `createEcosystemRegistry([fake])` yields a registry whose `getAll()` returns exactly `[fake]`, insertion-ordered.
- Existing suite passes unchanged (default registry still carries npm, composer, pip in that order — asserted by an order test).

# References

- [Cycle-3 architecture review, candidate 5](/architecture/arch-review-2026-05-02-cycle3.md)
