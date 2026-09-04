---
type: BDR
title: Advisors always use the ecosystem runtime
description: Advisor commands use the configured ecosystem container even when no dependency update is applicable.
status: Accepted
tags: [behavior, docker, advisors]
timestamp: 2026-09-04T00:00:00Z
---

# BDR 0001 — Advisors always use the ecosystem runtime

## Behavior

Given an ecosystem with an advisor command and a Docker runtime, when the fix
phase finds no applicable update, the advisor still executes through the
resolved ecosystem runner. It must not fall back to the host runtime.

The outcome remains `skipped` with reason `no-updates`, and advisor failures
remain informational and non-blocking.

## Scenarios

| Given | When | Then |
|---|---|---|
| no applicable updates and one advisor | the ecosystem has a runtime spec | resolve the ecosystem runtime and pass its runner to the advisor |
| no applicable updates and no advisors | the fix phase is evaluated | skip without resolving an unnecessary container |
| applicable updates and one advisor | the fix phase runs | preserve the existing containerized advisor behavior |

## Test design

`tests/unit/orchestration/run-ecosystem-fix.test.ts` verifies runner identity,
runtime resolution, the skipped outcome, and the no-advisor fast path.
