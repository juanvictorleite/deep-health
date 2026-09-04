---
type: Issue
title: Containerize advisors when no updates are applicable
description: Execute BDR 0001 by resolving the ecosystem runtime before advisors on the no-updates path.
status: done
tags: [orchestration, docker, advisors]
timestamp: 2026-09-04T00:00:00Z
---

# Issue 0018 — Containerize advisors on skip

Executes [BDR 0001](/bdr/0001-advisors-use-ecosystem-runtime.md) and enforces
the Docker-only boundary from [ADR 0001](/adr/0001-docker-only-runtime.md).

## Scope

- Resolve the configured ecosystem runtime before executing advisors on the
  `no-updates` path.
- Preserve the no-advisor fast path and the informational advisor contract.
- Add a unit regression test that distinguishes the host and container runners.

## Done when

- The advisor receives the resolved ecosystem runner on both fix and skip paths.
- No container is resolved when the ecosystem has no advisor commands.
- Focused tests, typecheck, and the full suite pass.

## Verification

- `npm test`: 3236 tests passed.
- `npm run test:integration`: 36 tests passed.
- `npm run typecheck`, `npm run build`, and living-docs lint passed.
