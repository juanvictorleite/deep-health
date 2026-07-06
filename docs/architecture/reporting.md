---
type: Architecture View
title: Reporting — generation flow and artifacts
description: Executive report generation (consolidated and split), i18n, and the shared report-artifacts stage used by fix and executive-report.
timestamp: 2026-07-06T00:00:00Z
---

# Reporting — Generation Flow and Artifacts

## Report Generation Flow

```mermaid
flowchart LR
    ORCH_RES["OrchestratorResult\n(scan, updates, advisorResults,\nresidualVerification)"]
    SCAN_AFTER["runScanner()\npost-fix snapshot"]

    ORCH_RES --> GEN_RPT
    SCAN_AFTER --> GEN_RPT

    GEN_RPT{"split_reports?"}
    GEN_RPT -- no --> CONSOLIDATED["generateExecutiveReport()\nreporting/executive.ts\nconsolidated report"]
    GEN_RPT -- yes --> PER_ENTRY["generateEntryReport() per entry\nbuildEntryReportContext() filters\nscan+update results for one entryKey"]

    CONSOLIDATED --> RPT_RENDER["HTML report renderer\n(reporting/templates/)"]
    PER_ENTRY --> RPT_RENDER
    RPT_RENDER --> I18N["i18n loader\n(en / pt-br)"]
    I18N --> HTML["Executive HTML report(s)\nnpm-report.html\nnpm-frontend-report.html etc."]

    HTML --> SAVE["saveReport()\napp/report-saver.ts"]
    SAVE --> LOCAL["Local file\n(outputs.dir)"]

    GEN_RPT --> SONAR_RPT["generateSonarQubeHtmlReport()\n(if SonarQube engine ran)"]
    SONAR_RPT --> SONAR_HTML["SonarQube HTML artifact"]
    SONAR_HTML --> SAVE
```

## Split Reports

When `outputs.split_reports: true` (config) or `--split-reports` (CLI flag) is set, the report layer generates one HTML report per ecosystem entry instead of a consolidated report:

- `buildEntryReportContext(entry, orchestratorResult)` filters the full result set down to only the scan data and update result for that single `entryKey`.
- `splitReportFilename(entry)` derives the output filename from the entry: `npm-report.html` for bare-id entries, `npm-frontend-report.html` for labelled entries (label is derived from `entry.label`).
- Each split report is self-contained with the same HTML template and i18n locale as the consolidated report.
- The CLI `--split-reports` flag takes precedence over `outputs.split_reports` in the config file.

**Report label format:** when an entry has a label, the report displays it as `npm (frontend)` — the plugin id followed by the label in parentheses. This mirrors the `ecosystemEntryKey` composite key format but in a human-readable form.

## Report Artifacts

`src/app/report-artifacts.ts` centralizes post-pipeline artifact generation that was previously duplicated between `fix.ts` and `executive-report.ts`.

```ts
interface ReportArtifactsInput {
  orchestratorResult: OrchestratorResult;
  config: ProjectConfig;
  cwd: string;
  runner: CommandRunner;
  // … locale, formats, outputDir, etc.
}

async function generateAndSaveReportArtifacts(input: ReportArtifactsInput): Promise<void>
```

Both `fix.ts` (`runFixPipeline`) and `executive-report.ts` delegate their entire report generation phase to this single function. The scan-after snapshot (post-fix OSV scan for residual verification display) is orchestrated internally. `writeAuditTrail()` is intentionally kept in `fix.ts` rather than here — the audit trail is a run-level record, not a report artifact.

```mermaid
flowchart LR
    FIX["fix.ts\nrunFixPipeline()"]
    EXEC["executive-report.ts"]

    FIX --> ARTIFACTS["generateAndSaveReportArtifacts()\napp/report-artifacts.ts"]
    EXEC --> ARTIFACTS

    ARTIFACTS --> LOCAL["Local file\n(outputs.dir)"]
```
