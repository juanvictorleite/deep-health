# ADRs

Architecture Decision Records — one decision each, append-only, superseded never rewritten. Status lives in each record's frontmatter.

## Active

| # | Title | Status |
|---|---|---|
| [0001](0001-docker-only-runtime.md) | Docker-only runtime for ecosystem CLIs | Accepted |
| [0002](0002-threat-model-and-runtime-hardening.md) | Threat model and runtime hardening for ecosystem CLI execution | Accepted |
| [0003](0003-architecture-deepening-candidates-2026-04-29.md) | Architecture deepening candidates (2026-04-29) | Accepted |
| [0004](0004-ecosystem-runner-config-and-build-context-hardening.md) | Ecosystem runner config simplification and build context boundary hardening | Accepted (partial supersession note: nested `build{}` replaced the flat fields) |
| [0005](0005-adopt-living-docs-governance.md) | Adopt living-docs governance (strict) and reorganize the docs bundle as OKF | Accepted |
| [0006](0006-core-layer-purity.md) | Core layer purity — no runtime imports from outer layers | Accepted |
| [0007](0007-consolidate-image-resolvers.md) | Consolidate ecosystem image resolvers into one table-driven module | Accepted |
| [0008](0008-executive-report-view-model.md) | Executive report — separate data preparation from template rendering | Accepted |
| [0009](0009-explicit-ecosystem-registry-factory.md) | Explicit ecosystem registry factory (no side-effect bootstrap) | Accepted |
| [0010](0010-phase-router-extraction.md) | Phase Router — extract execution-plan resolution from the orchestrator | Accepted |
| [0011](0011-coverage-ratchet-policy.md) | Coverage thresholds become a ratchet at the measured baseline (statements 94.5, functions 94.5, lines 95.5, branches 86 — raise-only) | Accepted |
| [0012](0012-pip-updater-module-split.md) | Split pip-updater into seam-aligned submodules behind a stable facade | Accepted |
| [0013](0013-fixer-decomposition-shared-semver-helpers.md) | Decompose the audit fixers; shared home for the duplicated semver helpers | Accepted |
| [0014](0014-osv-parse-seam.md) | Extract the OSV engine's pure parsing into osv-parse; decompose within budget | Accepted |
| [0015](0015-report-artifact-plan.md) | Report artifact plan — pure resolver + thin executor in the app layer | Accepted |

## Superseded

_None yet._
