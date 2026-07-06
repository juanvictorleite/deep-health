---
type: Reference
title: Adding an external scanner engine
description: Extension guide — when to extend ExternalScannerAdapter vs implement ScannerEngine directly, with a minimal SnykEngine example.
timestamp: 2026-07-06T00:00:00Z
---

# Adding an External Scanner Engine

## When to use `ExternalScannerAdapter` vs `ScannerEngine` directly

Implement `ScannerEngine` directly when:
- The engine produces a result that does not map cleanly to per-package vulnerability entries (e.g., SonarQube code quality gates).
- The engine has complex multi-phase logic that does not decompose into a simple `fetchVulnerabilities()` call.

Extend `ExternalScannerAdapter` when:
- The external source returns vulnerability records that can be normalized to `RawVulnerability[]`.
- You want the base class to handle `ScanResultJson` assembly, `classifyPackage()` calls, and ecosystem bucketing automatically.

This covers the common case: Snyk, WPScan, Patchstack, NVD, and similar CVE-feed tools.

## The abstract members to implement

| Member | Type | Purpose |
|---|---|---|
| `id` | `readonly string` | Unique engine key used in registries, logs, and `result.agent` |
| `name` | `readonly string` | Human-readable display name |
| `assertAvailable(ctx)` | `async` method | Verify the tool/credentials exist; throw if not |
| `fetchVulnerabilities(ctx)` | `async` method | Return `RawVulnerability[]`; return `[]` on non-fatal failures |

## Minimal working example (SnykEngine)

```ts
// src/modules/scanner/snyk-engine.ts (example)
import { ExternalScannerAdapter } from './external-adapter';
import type { ScannerEngineContext } from './types';
import type { RawVulnerability } from './external-adapter';

export class SnykEngine extends ExternalScannerAdapter {
  readonly id = 'snyk';
  readonly name = 'Snyk';

  async assertAvailable(ctx: ScannerEngineContext): Promise<void> {
    const result = await ctx.runner.runArgs('snyk', ['--version'], { cwd: ctx.cwd });
    if (result.exitCode !== 0) {
      throw new Error('snyk CLI not found. Install with: npm install -g snyk');
    }
  }

  async fetchVulnerabilities(ctx: ScannerEngineContext): Promise<RawVulnerability[]> {
    const result = await ctx.runner.runArgs('snyk', ['test', '--json'], { cwd: ctx.cwd });
    // Parse Snyk JSON output → RawVulnerability[]
    return [];
  }
}
```

`buildScanResult()` on the base class handles the rest: it iterates `RawVulnerability[]`, calls `classifyPackage()` for each entry using protected packages from the matching ecosystem plugin, buckets results by ecosystem, and returns a fully populated `ScanResultJson`.

## Registering the engine

Pass the engine to the orchestrator via `OrchestratorOptions.scannerRegistry`:

```ts
const registry = new ScannerEngineRegistry();
registry.register(new OsvScannerEngine());
registry.register(new SnykEngine());

await runOrchestrator(runner, config, cwd, { scannerRegistry: registry });
```

Or call `registry.register()` directly on the default registry before running:

```ts
import { defaultScannerRegistry } from '@modules/scanner';
defaultScannerRegistry.register(new SnykEngine());
```

## Setting the engine as primary

In your project's `security-scan.config.json`:

```json
{
  "scanners": {
    "primary": "snyk"
  }
}
```

The `primary` value must match the engine's `id` property. When omitted, the default is `"osv"`. The primary engine's result drives Gate A — any failure is fatal to the pipeline.
