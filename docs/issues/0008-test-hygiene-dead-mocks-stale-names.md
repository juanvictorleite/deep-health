---
type: Issue
title: Test hygiene - remove dead vi.mocks of deleted runner modules; rename stale test files
description: Cosmetic cleanup left over from ADR 0007's resolver consolidation - 3 orchestrator test files still vi.mock deleted @infra/provisioner runner paths (dead mocks), and 6 test files keep pre-consolidation filenames (npm/composer/pip-runner.test.ts) while actually covering EphemeralEcosystemContainer.
status: open
tags: [testing, hygiene]
timestamp: 2026-07-06T00:00:00Z
---

# Issue 0008 — Test hygiene: dead mocks + stale filenames

Leftovers accepted (documented, non-blocking) during [ADR 0007](/adr/0007-consolidate-image-resolvers.md)'s execution, now cleaned up.

## Scope

- Remove `vi.mock('@infra/provisioner/npm-runner.js')` / `pip-runner.js` / `composer-runner.js` / `php-image-resolver.js` blocks from `tests/unit/orchestration/orchestrator-kill-switch.test.ts`, `orchestrator-error-status.test.ts`, `orchestrator-coverage.test.ts` — the mocked modules were deleted; vi.mock string args are not type-resolved, so these are dead weight.
- `git mv` the 6 stale-named files to names reflecting their real subject (all describe blocks target `EphemeralEcosystemContainer`):
  - `tests/unit/infrastructure/provisioner/{npm,composer,pip}-runner.test.ts` → `ephemeral-container-{npm,composer,pip}-mode.test.ts`
  - `tests/unit/provisioner/{npm,composer,pip}-runner.test.ts` → `ephemeral-ecosystem-container-{npm,composer,pip}.test.ts`
- Zero content changes in the renamed files; suite stays green.

## Done when

- No `vi.mock` of a deleted module path remains under `tests/`; no test file named `*-runner.test.ts` covers `EphemeralEcosystemContainer`; full suite green.

# References

- [ADR 0007](/adr/0007-consolidate-image-resolvers.md)
