---
type: Context
title: Scanner vocabulary
description: Canonical terms for scanner engines, sweep, primary/secondary policy, and residual verification.
tags: [context, scanner]
timestamp: 2026-07-06T00:00:00Z
---

# Scanner

**Scanner Engine** — implementation of `ScannerEngine` that produces a `ScanResultJson`. `OSV Scanner Engine` is primary; `SonarQube Engine` is secondary.

**Primary Engine** — the engine whose id matches `config.scanners.primary` (default `osv`). Drives Gate A. Failure is fatal.

**Secondary Engine** — any other registered engine. Failures honor `on_failure: 'warn' | 'fail'`.

**Residual Verification** — post-update OSV scan that checks whether vulnerabilities remain. Result is a tagged union: `verified` (all clean), `unverified` (CVEs remain), `skipped` (not run).

**Scanner Sweep** — `executeScannerSweep()` in `src/modules/scanner/scanner-sweep.ts`. Owns the multi-engine scan stage: runs each registered scanner engine via an injected renderer, classifies results into entries vs warnings, and applies the on_failure policy for secondary engines. Throws `PrimaryEngineFailure` when the primary engine fails. Config-agnostic — the on_failure resolver is injected as a callback by the orchestrator. Replaces the inlined `runAllEngines` loop that previously lived in `src/orchestration/orchestrator.ts`.

**Engine Run Renderer** — Adapter at the Scanner Sweep seam controlling visual presentation. Interface: `runSweep(engines, runOne) → Map<engineId, Result | Error>`. Two implementations: `listr2ScannerSweepRenderer(rendererType)` builds a single Listr2 task list, sets the global progressSink to each task's output, and swallows the bundled ListrError (errors are reported per-engine via the Map). `silentScannerSweepRenderer` runs engines sequentially with no UI — used by tests and JSON-output mode.

**PrimaryEngineFailure** — typed exception thrown by Scanner Sweep when the primary engine (id === `config.scanners.primary`) either throws or returns `status='error'`. Carries `{ engineId, cause, partialWarnings }`. `partialWarnings` preserves warnings already accumulated from secondary engines that ran before the primary failed — kept so the orchestrator can include them in error diagnostics rather than discard already-paid work.
