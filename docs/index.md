---
okf_version: "0.1"
---

# Docs — security-scan

Bundle root for all project documentation. Governance: living-docs, `enforcement: strict` (see `CLAUDE.MD` and [ADR 0005](/adr/0005-adopt-living-docs-governance.md)). Mechanical invariants are checked by `npm run docs:lint`.

## Foundations

| Doc | Purpose |
|---|---|
| [constitution.md](constitution.md) | Product scope, data model, non-negotiables — the root of trace |
| [context/](context/index.md) | Domain & module vocabulary + [glossary](context/glossary.md) |
| [architecture/](architecture/index.md) | Living Mermaid views of the system |

## Decisions & requirements

| Doc | Purpose |
|---|---|
| [adr/](adr/index.md) | Architecture Decision Records (append-only, supersede-never-rewrite) |
| [bdr/](bdr/index.md) | Behavior Decision Records |
| [prd/](prd/index.md) | Product requirement specs |
| [issues/](issues/index.md) | Execution slices tracing back to ADRs/BDRs |
| [research/](research/index.md) | Dated, sourced, append-only external evidence |

## References & guides

| Doc | Purpose |
|---|---|
| [reference/](reference/index.md) | CLI, JSON schema, CommandRunner security model, testing guide |
| [en/](en/index.md) | English user guides |
| [pt-br/](pt-br/index.md) | Brazilian-Portuguese user guides (translations + generated quick-start) |
