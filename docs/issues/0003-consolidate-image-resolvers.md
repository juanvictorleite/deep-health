---
type: Issue
title: Consolidate provisioner image resolvers into table-driven module
description: Execute ADR 0007 — single resolveEcosystemImage; delete 4 shallow wrappers; PHP bootstrap moves to php-profiles.
status: Done
tags: [architecture, provisioner]
timestamp: 2026-07-06T00:00:00Z
---

# Issue 0003 — Consolidate image resolvers

Execute [ADR 0007](/adr/0007-consolidate-image-resolvers.md).

## Scope

- New `src/infrastructure/provisioner/image-resolvers.ts` (table + shared segment parser + `resolveEcosystemImage`).
- `src/infrastructure/provisioner/php-profiles.ts` — absorb `COMPOSER_BOOTSTRAP` + `isPhpCliImage`.
- Delete `npm-runner.ts`, `pip-runner.ts`, `composer-runner.ts`, `php-image-resolver.ts`; repoint all importers.
- Migrate resolver unit tests to `image-resolvers.test.ts` (same expectations).

## Done when

- Same inputs → same image strings as before; typecheck + full suite green with the 4 files deleted.

# References

- [ADR 0007](/adr/0007-consolidate-image-resolvers.md)
