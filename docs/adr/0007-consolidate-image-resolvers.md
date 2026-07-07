---
type: ADR
title: Consolidate ecosystem image resolvers into one table-driven module
description: Replace the four shallow provisioner wrapper files with a single resolveEcosystemImage module; PHP bootstrap concerns move to php-profiles.
status: Accepted
tags: [architecture, provisioner, docker]
timestamp: 2026-07-06T00:00:00Z
---

# ADR 0007 — Consolidate ecosystem image resolvers (cycle-3 candidate 2)

## Context

Four provisioner files are shallow wrappers that fail the deletion test (interface ≈ implementation):

- `src/infrastructure/provisioner/npm-runner.ts` (23 LOC) — `resolveNpmDockerImage` (major → `node:<major>`, default `node:lts`)
- `src/infrastructure/provisioner/pip-runner.ts` (28 LOC) — `resolvePipDockerImage` (major.minor → `python:<v>-slim`, default `python:3-slim`)
- `src/infrastructure/provisioner/php-image-resolver.ts` (42 LOC) — `resolveComposerDockerImage` (major.minor → `php:<v>-cli`, default `COMPOSER_DEFAULT_IMAGE`)
- `src/infrastructure/provisioner/composer-runner.ts` (27 LOC) — NOT a resolver: `COMPOSER_BOOTSTRAP` + `isPhpCliImage` + a re-export

The three resolvers share one algorithm — trim, take up to N numeric version segments, compose `<image>:<tag><suffix>`, fall back to a default — duplicated with cosmetic variations. Each new ecosystem would add another wrapper file ([cycle-3 review, candidate 2](/architecture/arch-review-2026-05-02-cycle3.md)).

## Decision

1. **One module, one table.** New `src/infrastructure/provisioner/image-resolvers.ts` exporting `resolveEcosystemImage(ecosystemId: string, version?: string): string`, driven by an internal declarative table:
   `npm → { image: 'node', suffix: '', maxSegments: 1, default: NPM_DEFAULT_IMAGE }`, `pip → { image: 'python', suffix: '-slim', maxSegments: 2, default: PIP_DEFAULT_IMAGE }`, `composer → { image: 'php', suffix: '-cli', maxSegments: 2, default: COMPOSER_DEFAULT_IMAGE }`.
   One shared segment parser (numeric segments only, stop at first non-numeric, cap at `maxSegments`; zero segments → default). The default-image constants are exported from this module (composer's stays sourced from `php-profiles.ts`). Unknown ecosystem id → throw (programming error, not config error).
2. **Behavior-preserving.** The table reproduces today's exact outputs, including npm's major-only tag and the pip/composer major.minor rule.
3. **PHP bootstrap concerns move home.** `COMPOSER_BOOTSTRAP` and `isPhpCliImage` move into `php-profiles.ts` (already the single home for PHP image knowledge, incl. `COMPOSER_DEFAULT_IMAGE`).
4. **The four wrapper files are deleted.** All importers are repointed (`resolveNpmDockerImage(v)` → `resolveEcosystemImage('npm', v)`, etc.). No compatibility aliases — the point is deletion.

## Consequences

- All image-resolution logic and its tests concentrate in one file; adding a 4th ecosystem is one table row.
- External interface gets smaller; callers are updated once.
- `php-profiles.ts` becomes the single PHP-image home (default image, bootstrap, cli detection).

## Verification

- Existing resolver unit tests migrate to `image-resolvers.test.ts` and pass unchanged expectations (same inputs → same image strings).
- `npm run typecheck` passes with the four files deleted (no dangling importers).

# References

- [Cycle-3 architecture review, candidate 2](/architecture/arch-review-2026-05-02-cycle3.md)
