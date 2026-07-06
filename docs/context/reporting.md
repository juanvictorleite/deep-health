---
type: Context
title: Reporting vocabulary
description: Canonical terms for report generation and the audit trail.
tags: [context, reporting]
timestamp: 2026-07-06T00:00:00Z
---

# Reporting

**Executive Report** — HTML summary saved per run, generated via the reporting template engine. Driven by `OrchestratorResult` + post-fix scan. Internationalized via `i18n/` (en, pt-br).

**Audit Trail** — JSON record of each run (timestamp, CLI version, dry-run flag, scan, updates, status). Written by `writeAuditTrail()`.

**Report Storage** — reports and audit trails are written to the local filesystem only. Cloud upload (Google Drive) was removed in `feat!: remove google drive support` (commit `a7b6e28`); no remote storage remains.
