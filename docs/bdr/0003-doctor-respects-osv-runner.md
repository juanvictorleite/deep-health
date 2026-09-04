---
type: BDR
title: Doctor respects the configured OSV runner
description: Doctor requires a host OSV binary only when the project selects the local OSV runner.
status: Accepted
tags: [behavior, doctor, docker, osv]
timestamp: 2026-09-04T00:00:00Z
---

# BDR 0003 — Doctor respects the configured OSV runner

## Behavior

When `scanners.osv.runner` is `docker` or omitted, `doctor` reports OSV as
provided by Docker and does not execute `osv-scanner --version` on the host.
When the runner is `local`, the existing host-binary check remains required.

If the config cannot be read during this check, `doctor` preserves the legacy
host check; the independent config check reports the missing file.

## Scenarios

| Given | When | Then |
|---|---|---|
| OSV runner omitted | doctor reads the config | report OSV Docker runtime as available without a host command |
| OSV runner is `docker` | doctor reads the config | report OSV Docker runtime as available without a host command |
| OSV runner is `local` | doctor reads the config | execute the host version check and fail when the binary is absent |

## Test design

`tests/unit/app/commands/doctor.test.ts` verifies config routing and host-command
call counts for Docker and local modes.
