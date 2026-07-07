---
type: ADR
title: Runner capability contract — declare runShell/runStreaming on EphemeralContainerRunner; delete duck typing
description: command-runner.ts stops re-declaring foreign runner shapes locally and casting unknown - streaming and shell execution become declared optional members of the one provisioner contract; LocalExecutor.run (CCN 22) and EcosystemContainerCommandRunner.run (CCN 15) decompose within budget.
status: Accepted
tags: [architecture, infrastructure, security, complexity]
timestamp: 2026-07-07T00:00:00Z
---

# ADR 0019 — Runner capability contract (review 2026-07-07, candidate C7)

## Context

`EcosystemContainerCommandRunner` (src/infrastructure/ecosystem-runtime/command-runner.ts) detects optional container capabilities by **duck typing**: it declares local interfaces `StreamingContainerRunner` and `RunShellContainer` and narrows via `typeof (c as X).method === 'function'` guards (`hasStreaming`, `hasRunShell`). The capability contract therefore lives in two places and has already drifted: `EphemeralContainerRunner` (src/infrastructure/provisioner/types.ts) declares `runShell?` but **not** `runStreaming` — the streaming capability exists only as a local re-declaration plus an unsound `unknown` cast. Fresh lizard (2026-07-07): `LocalExecutor.run` CCN 22 (its `runArgs` is a near-verbatim duplicate — same stdio selection, result mapping and ENOENT handling), `EcosystemContainerCommandRunner.run` CCN 15 (the `ContainerRunResult → CommandResult` mapping repeats four times across run/runArgs).

## Decision

1. **One home for the capability contract.** `EphemeralContainerRunner<TArgs>` gains a declared optional member `runStreaming?(args: TArgs, onLine?: (line: string) => void): Promise<ContainerRunResult>` with the same argv-not-interpolated docstring discipline `runShell?` already carries. `runShell?` stays as declared.
2. **Delete the duck typing.** `StreamingContainerRunner`, `RunShellContainer`, `hasStreaming` and `hasRunShell` are removed from command-runner.ts (deletion test: their knowledge concentrates into the contract, nothing moves elsewhere). Capability checks become typed presence checks on declared optional members (`this.container.runShell`, `this.container.runStreaming`) — no `as` casts to capability interfaces remain.
3. **Decompose within budget.** `EcosystemContainerCommandRunner.run` extracts the repeated `ContainerRunResult → CommandResult` mapping into one helper; `LocalExecutor.run`/`runArgs` extract their shared stdio selection, success-result mapping and ENOENT/error mapping into module-level helpers. All exported signatures unchanged; zero functions above CCN 10 in the three files (new helpers ≤ 8).
4. **Existing runner tests are the oracle** and do not change; new table tests only for capability-presence edges left unpinned.

### Security (STRIDE-lite pass, ADR 0002 ground)

Trust boundaries examined: the SEC-004 TRUSTED-STATIC-ONLY whitespace tokenizer in `run(command)`; the `runShell` path (command as single argv element to `sh -c` inside the container); `LocalExecutor.run`'s `shell: true` execa path vs `runArgs`'s `shell: false`; env merge `{ ...process.env, ...options.env }`.

- **Tampering/Elevation:** no new shell invocation sites; routing predicates (`matchesContainerBinary`, `isHostOnlyCommand`) and the SEC-004 boundary (comment + behavior) are preserved verbatim. Declaring `runStreaming` in the contract is type-level: runners without the capability (osv/sonar) still lack the member at runtime and presence checks still guard. Removing the `unknown → interface` casts strictly strengthens type safety — the change reduces attack surface, it does not add any.
- **DoS:** `timeout` handling and `reject: false` semantics survive the decomposition unchanged.
- **Information disclosure:** env propagation and error-message mapping unchanged; no env values enter logs.

No new material threat. Residues bind as ACs: security gate run (`verify_by: command`) on the touched execution-path files, plus an inspection AC for the gate-blind SEC-004 semantics ("which strings may reach a shell" has no mechanical oracle).

## Consequences

- The provisioner contract becomes the single source of truth for what a container runner can do; a future capability is a declared optional member, not another duck guard.
- command-runner.ts loses its `import('...')` inline type references and local shape re-declarations; readers see the real contract.
- Risk: subtle behavior drift while decomposing the two hot `run` methods — mitigated by verbatim moves, unchanged signatures and the untouched oracle tests.

## Verification

- Full suite green, count ≥ current; existing runner/executor tests unchanged.
- lizard on local-executor.ts, command-runner.ts, provisioner/types.ts: zero functions above CCN 10; typecheck clean; oxlint 0 errors.
- `security-gate-run.sh all` on the diff: no new findings.

# References

- [Issue 0017 — runner capability contract](/issues/0017-runner-capability-contract.md)
- [ADR 0002 — threat model and runtime hardening](/adr/0002-threat-model-and-runtime-hardening.md) (SEC-004 trust boundary this change preserves)
- [ADR 0013 — fixer decomposition](/adr/0013-fixer-decomposition-shared-semver-helpers.md) (phase-helper decomposition playbook)
