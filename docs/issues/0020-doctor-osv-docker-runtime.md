---
type: Issue
title: Make doctor honor the OSV Docker runtime
description: Execute BDR 0003 so Docker projects do not require osv-scanner on the host.
status: done
tags: [app, doctor, docker, osv]
timestamp: 2026-09-04T00:00:00Z
---

# Issue 0020 — Doctor OSV Docker runtime

Executes [BDR 0003](/bdr/0003-doctor-respects-osv-runner.md).

## Scope

- Read the OSV runner selection from the project config for the doctor check.
- Treat the schema default as Docker when the runner is omitted.
- Preserve the local OSV binary check for explicit local mode.

## Done when

- Docker projects pass the OSV doctor check without a host binary.
- Local-runner behavior remains covered and unchanged.
- Focused tests, typecheck, and docs lint pass.

## Verification

- Doctor unit tests cover Docker and local OSV runners.
- A real SIP config returned `4/4 required checks passed` without host OSV.
- Full unit and integration suites, typecheck, build, and docs lint passed.
