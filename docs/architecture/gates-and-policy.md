---
type: Architecture View
title: Gates and safe-update policy
description: The Zod gate system (Gate A + ecosystem gates) and the classifyPackage() safe-update classification tree.
timestamp: 2026-07-06T00:00:00Z
---

# Gates and Safe-Update Policy

The pure-domain validation layer: every phase output passes a Zod gate, and every vulnerable package is classified before any fix.

## Gate System

```mermaid
flowchart TD
    SCAN_OUT["ScanResultJson\nfrom OSV engine"]
    GATE_A["Gate A\nvalidateGateA()\nZod: ScanResultSchema"]
    SCAN_OUT --> GATE_A

    GATE_A -- valid --> UPDATE
    GATE_A -- invalid --> ERR_A([throw GateValidationError gate=A])

    UPDATE["UpdateResultJson\nfrom plugin.runUpdater()"]
    ECO_GATE["Ecosystem Gate\nvalidateEcosystemGate(id, data)\nZod: UpdateResultSchema\nvalidations.min(1)"]
    UPDATE --> ECO_GATE

    ECO_GATE -- valid --> CONT([pipeline continues])
    ECO_GATE -- invalid --> ERR_ECO([throw GateValidationError gate=id])
    ECO_GATE -- "all validations skipped" --> WARN["logger.warn — no test coverage verified\n(pipeline continues)"]
```

**Key constraint:** `validations` array must always have at least one entry. When tests are not run (e.g., dry-run), emit a `{ name: ..., status: 'skipped' }` entry. An empty array fails the gate.

## Safe-Update Classification

`core/policy/safe-update.ts:classifyPackage()` evaluates every vulnerable package against semver rules and the project's `protected_packages` config.

```mermaid
flowchart TD
    START([classifyPackage called]) --> NO_SAFE

    NO_SAFE{"safeVersion\nis null?"}
    NO_SAFE -- yes --> MANUAL_NO_VER([manual: No safe version available])
    NO_SAFE -- no --> IS_PROTECTED

    IS_PROTECTED{"package in\nprotected_packages?"}
    IS_PROTECTED -- yes --> SATISFIES

    SATISFIES{"safeVersion satisfies\nprotected constraint?"}
    SATISFIES -- no --> BREAKING_PROT([breaking: protected-constraint])
    SATISFIES -- yes --> PARSE

    IS_PROTECTED -- no --> PARSE

    PARSE{"semver.coerce\nsucceeds?"}
    PARSE -- no --> MANUAL_PARSE([manual: Cannot parse version])
    PARSE -- yes --> DOWNGRADE

    DOWNGRADE{"safeVersion\n< currentVersion?"}
    DOWNGRADE -- yes --> MANUAL_DOWN([manual: Downgrade — fix not available for major])
    DOWNGRADE -- no --> MAJOR

    MAJOR{"safe.major\n> current.major?"}
    MAJOR -- yes --> BREAKING_MAJOR([breaking: major-bump])
    MAJOR -- no --> AUTO([auto_safe])
```
