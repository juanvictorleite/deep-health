---
type: Architecture View
title: Plugin system (EcosystemPlugin)
description: The EcosystemPlugin interface, its three implementations, the registry, and how to add a new ecosystem.
timestamp: 2026-07-06T00:00:00Z
---

# Plugin System (EcosystemPlugin)

Each package manager is a plugin that implements the `EcosystemPlugin` interface (`modules/ecosystem/types.ts`).

```mermaid
classDiagram
    class EcosystemPlugin {
        +string id
        +string name
        +string[] lockfiles
        +string[] osvEcosystems
        +string reportLabel
        +FixerStrategyId[] supportedFixers
        +ValidationCommandConfig[] defaultValidationCommands
        +AdvisorConfig[] defaultAdvisors
        +EcosystemRuntimeSpec? runtimeSpec
        +OsvFixSpec? osvFixSpec
        +PostUpdateOsvVerify postUpdateOsvVerify
        +buildScanArgs() string[]
        +getProtectedPackages(config) ProtectedPackage[]
        +runUpdater(ctx) Promise~UpdateResultJson~
        +inferVersion?(cwd) Promise~string?~
        +installBreakingPackages?(args) Promise~Result?~
    }

    class NpmPlugin {
        +id = "npm"
        +runtimeSpec.runMode = direct-exec
        +supportedFixers = ["osv", "npm-audit", "osv-then-audit"]
        +postUpdateOsvVerify = "osv-strategy-only"
    }

    class ComposerPlugin {
        +id = "composer"
        +runtimeSpec.runMode = shell-wrap
        +supportedFixers = ["osv"]
        +postUpdateOsvVerify = "always"
    }

    class PipPlugin {
        +id = "pip"
        +runtimeSpec.runMode = shell-wrap
        +supportedFixers = ["osv"]
        +postUpdateOsvVerify = "always"
    }

    class EcosystemRegistry {
        -Map plugins
        +register(plugin) this
        +get(id) EcosystemPlugin?
        +getAll() EcosystemPlugin[]
        +findByOsvEcosystem(osv) EcosystemPlugin?
    }

    EcosystemPlugin <|-- NpmPlugin
    EcosystemPlugin <|-- ComposerPlugin
    EcosystemPlugin <|-- PipPlugin
    EcosystemRegistry o-- EcosystemPlugin
```

**Adding a new ecosystem:**

1. Create `src/modules/ecosystem/plugins/<name>.ts` implementing `EcosystemPlugin`.
2. Declare a `runtimeSpec: EcosystemRuntimeSpec` on the plugin object — see [Ecosystem Runtime Container](ecosystem-runtime.md) for the spec shape.
3. Register the plugin in `src/modules/ecosystem/index.ts`.

No new files in `infrastructure/`, no orchestrator edits. The unified runtime module reads `runtimeSpec` and wires the entire container chain.
