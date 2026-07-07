# Issues

Execution slices — discrete units of work tracing back to ADRs/BDRs. The local file is the trace; the tracker (when used) is execution state.

| # | Title | Status |
|---|---|---|
| [0001](0001-build-context-boundary-hardening.md) | Config simplification + build context boundary hardening | Done |
| [0002](0002-core-layer-purity-fix.md) | Remove infra logger import from core gates; layer-purity fitness test | Done |
| [0003](0003-consolidate-image-resolvers.md) | Consolidate provisioner image resolvers | Done |
| [0004](0004-executive-report-view-model.md) | Executive report ViewModel split | Done |
| [0005](0005-ecosystem-registry-factory.md) | Explicit ecosystem registry factory | Done |
| [0006](0006-phase-router-extraction.md) | Phase Router extraction | Done |
| [0007](0007-coverage-backfill.md) | Coverage backfill — raise the ratchet floors incrementally (ADR 0011) | Open |
| [0008](0008-test-hygiene-dead-mocks-stale-names.md) | Test hygiene — remove dead vi.mocks of deleted runners; rename stale test files | Done |
| [0009](0009-pip-updater-split.md) | Split pip-updater.ts into seam-aligned submodules (ADR 0012) | Done |
| [0010](0010-fixer-decomposition.md) | Decompose audit fixers; deduplicate semver helpers (ADR 0013) | Done |
| [0011](0011-osv-parse-extraction.md) | Extract pure osv-parse module; decompose scan + parsers (ADR 0014) | Done |
| [0012](0012-report-artifact-plan.md) | Artifact plan resolver; decompose runFixPipeline + fan-out (ADR 0015) | Done |
| [0013](0013-sonarqube-view-model.md) | SonarQube ViewModel — single normalization for the three surfaces (ADR 0016) | Done |
| [0014](0014-osv-fix-claims.md) | Extract pure osv-fix-claims; applier keeps staging I/O (ADR 0017) | Done |
| [0015](0015-lockfile-format-adapters.md) | Lockfile format adapters v1 + v2/v3; public API unchanged (ADR 0018) | Done |
| [0016](0016-install-breaking-packages-decomposition.md) | Decompose npm installBreakingPackages into phase helpers (ADR 0013 playbook) | Done |
| [0017](0017-runner-capability-contract.md) | Runner capability contract; decompose the two hot run methods (ADR 0019) | Done |
