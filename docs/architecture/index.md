# Architecture

Living architecture of security-scan: how the components fit together, expressed as Mermaid diagrams that must always match the code. Each view file owns one concern. Update the relevant view in the same change as any structural code change (see the maintenance rule in `CLAUDE.MD`).

## Views

| File | View | Mermaid type |
|---|---|---|
| [high-level.md](high-level.md) | Major components & connections | `graph` |
| [orchestrator-pipeline.md](orchestrator-pipeline.md) | Full fix pipeline + per-ecosystem sub-pipeline | `flowchart` |
| [plugin-system.md](plugin-system.md) | EcosystemPlugin interface, registry, adding an ecosystem | `classDiagram` |
| [project-discovery.md](project-discovery.md) | Init discovery walk + monorepo config shape | `flowchart` |
| [updater-internals.md](updater-internals.md) | Transaction, lifecycle, recipe hooks, environment probe | `flowchart` |
| [scanner-system.md](scanner-system.md) | Engines, sweep, N-scan per-entry OSV | `classDiagram` + `flowchart` |
| [ecosystem-runtime.md](ecosystem-runtime.md) | Ephemeral container seam, run modes, routing | `flowchart` |
| [gates-and-policy.md](gates-and-policy.md) | Zod gates + safe-update classification | `flowchart` |
| [fixer-strategy.md](fixer-strategy.md) | Effective fixer resolution decision tree | `flowchart` |
| [reporting.md](reporting.md) | Report generation, split reports, artifacts stage | `flowchart` |
| [module-dependencies.md](module-dependencies.md) | Allowed dependency directions | text |
| [operational-hardening.md](operational-hardening.md) | Git/PR workflow, retry, timeouts, config versioning | `flowchart` |

## Extension guides

| File | Covers |
|---|---|
| [adding-scanner-engine.md](adding-scanner-engine.md) | Adding an external scanner engine (adapter vs direct interface) |

## Historical reviews

Dated, append-only snapshots of past deepening cycles (cycle 1 lives in [ADR 0003](/adr/0003-architecture-deepening-candidates-2026-04-29.md)).

| File | Covers |
|---|---|
| [arch-review-2026-05-02.md](arch-review-2026-05-02.md) | Cycle 2 — 7 candidates, all implemented |
| [arch-review-2026-05-02-cycle3.md](arch-review-2026-05-02-cycle3.md) | Cycle 3 — candidates after cycle 2 |
