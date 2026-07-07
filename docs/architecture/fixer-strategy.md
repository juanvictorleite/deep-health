---
type: Architecture View
title: Fixer strategy decision tree
description: How the effective fixer strategy is resolved — config, plugin default, per-plugin hooks (npm lockfile-v1 demotion), and post-update verify policy.
timestamp: 2026-07-06T00:00:00Z
---

# Fixer Strategy Decision Tree

The effective fixer strategy is resolved before any mutation begins. The base strategy comes from config or the plugin default; per-plugin hooks may then override it. For npm, `NpmPlugin.resolveEffectiveFixer(config, cwd)` encapsulates the lockfile-v1 demotion logic — `runEcosystemFix` calls the hook rather than applying npm-specific special-cases inline.

```mermaid
flowchart TD
    CONFIG{"ecosystems[id].fixer\nconfigured?"}
    CONFIG -- yes --> USE_CONFIG["Use config fixer"]
    CONFIG -- no --> PLUGIN_DEF["Use plugin.supportedFixers[0]"]

    USE_CONFIG --> HOOK
    PLUGIN_DEF --> HOOK

    HOOK{"plugin.resolveEffectiveFixer()\nhook present?"}
    HOOK -- no --> FIXER
    HOOK -- yes --> DEMOTE_CHECK

    DEMOTE_CHECK{"npm plugin AND\nstrategy = osv or osv-then-audit?"}
    DEMOTE_CHECK -- no --> FIXER
    DEMOTE_CHECK -- yes --> LOCK_VER{"lockfileVersion\nin package-lock.json?"}

    LOCK_VER -- "= 1 (npm 6 / Node ≤12)" --> DEMOTE["Auto-demote to npm-audit\n(osv-scanner cannot patch v1 in-place)\nlog WARN: auto-switching fixer"]
    LOCK_VER -- "≥ 2 or null" --> FIXER

    DEMOTE --> FIXER

    FIXER{"Effective strategy?"}
    FIXER -- "osv" --> OSV_ONLY["OSV Scanner fix\n(in-place lockfile patch via staging copy)"]
    FIXER -- "npm-audit" --> NPM_AUDIT["npm audit fix"]
    FIXER -- "osv-then-audit" --> CHAIN["OSV fix first\nthen npm audit fix as fallback"]
    FIXER -- "composer-update" --> COMP_UPD["composer update <packages>"]

    OSV_ONLY --> POST_VERIFY{"postUpdateOsvVerify?"}
    CHAIN --> POST_VERIFY
    NPM_AUDIT --> POST_VERIFY
    COMP_UPD --> POST_VERIFY

    POST_VERIFY -- "always" --> RUN_OSV_VERIFY["Run OSV residual\nverification scan"]
    POST_VERIFY -- "osv-strategy-only\n+ effective strategy=osv" --> RUN_OSV_VERIFY
    POST_VERIFY -- "never or not osv" --> SKIP_VERIFY([skip])
```
