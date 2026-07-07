---
type: Context
title: Ecosystem vocabulary
description: Canonical terms for ecosystems, plugins, fixers, updaters, transactions, probes, and update classification.
tags: [context, ecosystem]
timestamp: 2026-07-06T00:00:00Z
---

# Ecosystem

**Ecosystem** — a package manager universe: `npm`, `pip`, `composer`. Identified by a canonical id used in the registry, config, and reports.

**Ecosystem Plugin** — implementation of the `EcosystemPlugin` interface (`src/modules/ecosystem/types.ts`), one per supported ecosystem. Carries metadata (lockfiles, OSV ecosystems, label, supported fixers) and behavior (`runUpdater`, `installBreakingPackages`, `inferVersion`).

**Fixer Strategy** — how vulnerabilities are remediated for an ecosystem: `osv`, `npm-audit`, `osv-then-audit`, `composer-update`. Selected via `ecosystems[].fixer` in config or the plugin's first supported fixer as default. For npm, if the configured strategy is `osv` or `osv-then-audit` and `package-lock.json` has `lockfileVersion: 1` (npm 6 / Node ≤12), `runEcosystemFix` auto-demotes to `npm-audit` at runtime (osv-scanner cannot patch v1 lockfiles in-place).

**OsvFixOutcome** — `{ applied: boolean; packagesUpdated: Array<{ name, versionFrom, versionTo }> }`. Evidence produced by the orchestrator's OSV staging-apply phase and passed into `FixerCallOptions.osvFixOutcome`. Single source of truth in `src/modules/ecosystem/fixers/index.ts`. Consumed by `osv-fixer` (returns package list directly) and `osv-then-audit-fixer` (merges with audit-verified list using last-writer-wins, audit overwrites OSV for the same package name). `npm-updater.ts` keeps the raw `OsvFixOutcome` param solely to serve the partial-revert success path (which must report OSV-only packages, not the merged list).

**FixerCallResult** — return value of any `FixerFn`. Fields: `breakingInstallError`, `packagesUpdated` (the final list the updater should report), optional `intermediateBackup` (post-OSV lockfile snapshot for test introspection), optional `partialRevert` (callable that restores to the intermediate state and re-bootstraps — built and returned by `osv-then-audit-fixer`; invoked strategy-agnostically by `npm-updater`).

**Native Deps** — OS-level system packages (e.g. `libvips-dev`, `libpq-dev`) declared under `runners.<id>.native_deps` in config. `resolveEcosystemRuntime` synthesizes an `apt-get install` preamble from the list and injects it into the run mode before passing the container to the ecosystem CLI. Ensures native npm/pip/composer addons that require system libraries can compile during `npm ci` / `pip install` / `composer install` inside ephemeral containers.

**Updater** — the function each plugin runs (`runNpmUpdater`, `runPipUpdater`, `runComposerUpdater`) that applies the fixer, runs validations, and reverts on failure. The shared revert/result-building skeleton lives in the **Updater Transaction** primitive.

**Updater Lifecycle** — `runUpdaterLifecycle<T>()` in `src/modules/ecosystem/utils/updater-lifecycle.ts`. Generic skeleton that owns the shared update sequence for all ecosystem updaters: probe → dry-run gate → `beginUpdaterTransaction` → `applyFix` → `preValidation` → `runValidations` → partial-revert loop → `tx.success` / `tx.abortWithError` → `PhaseError` wrap. Each updater provides an `UpdaterRecipe<TFixerResult>` — a plain object with typed hooks (`applyFix`, optional `probe`, `preValidation`, `derivePackagesUpdated`, `partialRevert`). The generic parameter `TFixerResult` flows the fixer result between hooks for type safety. `FixResult<T>` is a discriminated union (`{ ok:true; value:T } | { ok:false; error:string; validationStatus? }`). The partial-revert hook returns `{ packagesUpdated }` on success or `null` to skip partial revert; throwing propagates as `PhaseError('partial-revert-bootstrap')`. Lifecycle options (`RunLifecycleOpts`) carry `preFixBackups`, `preRunSnapshots`, and `failIfAllSkipped`.

**Updater Transaction** — `beginUpdaterTransaction()` in `src/modules/ecosystem/utils/updater-transaction.ts`. Encapsulates the full lifecycle of a dependency update: backup snapshot at begin, success path (`tx.success()`), and revert path (`tx.abortWithError()`). The revert is driven by a **BootstrapSpec** supplied by the calling Updater and follows the protocol: `restore → bootstrap → restore-byte-identical → warn-only dirty-tree check`. Bootstrap failure during revert always propagates (throws); the Updater's outer `try/catch` wraps it as `PhaseError`. A single `CommandRunner` is used for the entire lifecycle. The `osv-then-audit` partial-revert path is encapsulated in `FixerCallResult.partialRevert` — the fixer builds and returns the closure; the updater invokes it strategy-agnostically via the `partialRevert` recipe hook.

**BootstrapSpec** — opaque struct `{ binary, args, label }` each Updater passes to the Updater Transaction describing how to reinstall dependencies during revert. Examples: npm → `npm ci`; composer → `composer install --no-interaction --no-scripts [--ignore-platform-reqs]`; pip → `pip install -r requirements.txt`. The spec covers revert bootstrap only, not pre-flight environment checks.

**Ecosystem Environment Probe** — `runEcosystemEnvironmentProbe()` in `src/modules/ecosystem/utils/environment-probe.ts`. Verifies that an ecosystem CLI can run cleanly inside the active runner BEFORE any mutation. Driven by a `ProbeSpec { binary, args, cwd, errorPrefix, label }`. Returns a tagged `ProbeResult` — `{ ok:true }` on success, `{ ok:false, exitCode, detail, error }` on failure. Distinct from `BootstrapSpec` (which drives revert reinstall inside Updater Transaction). Today only `composer-updater` adopts it.

**OSV Fix Spec** — declarative struct on a plugin telling the orchestrator which lockfile `osv-scanner` can patch and which files to back up before patching.

**Post-Update OSV Verify** — policy on a plugin (`always` | `osv-strategy-only` | `never`) controlling residual vulnerability scanning after updates.

**Protected Package** — a package whose version is constrained by project policy. Constraint is a semver range. Vulnerabilities in protected packages whose `safeVersion` does not satisfy the constraint are classified `breaking: protected-constraint` and never installed automatically.

**Auto-Safe / Breaking / Manual** — classification of a vulnerable package's remediation path, computed by `classifyPackage()` in `src/core/policy/safe-update.ts`.
