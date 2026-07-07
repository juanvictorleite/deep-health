---
type: Issue
title: Declare runner capabilities on the provisioner contract; decompose the two hot run methods
description: Execute ADR 0019 - runStreaming joins runShell as a declared optional member of EphemeralContainerRunner; duck-typed guards deleted from command-runner.ts; LocalExecutor.run (CCN 22) and EcosystemContainerCommandRunner.run (CCN 15) decompose within budget.
status: done
tags: [architecture, infrastructure, security, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# Issue 0017 — Runner capability contract

Executes [ADR 0019](/adr/0019-runner-capability-contract.md) (2026-07-07 review, candidate C7). Behavior-preserving; existing runner/executor tests are the oracle and do not change.

## Scope

- `src/infrastructure/provisioner/types.ts`: `EphemeralContainerRunner` gains declared `runStreaming?` with the argv-not-interpolated docstring discipline.
- `src/infrastructure/ecosystem-runtime/command-runner.ts`: delete `StreamingContainerRunner`, `RunShellContainer`, `hasStreaming`, `hasRunShell`; capability checks become typed presence checks; extract the repeated `ContainerRunResult → CommandResult` mapping; `run` within budget.
- `src/infrastructure/executor/local-executor.ts`: `run`/`runArgs` share extracted stdio-selection, result-mapping and ENOENT/error-mapping helpers; `shell: true` vs `shell: false` split preserved exactly.
- STRIDE-lite residues (ADR 0019 Security section): SEC-004 boundary verbatim; no new shell invocation sites; security gate on the diff.

## Done when

- Zero functions above CCN 10 across the three files (new helpers ≤ 8); all exported signatures unchanged; full suite green with existing tests unmodified; security gate reports no new findings.
