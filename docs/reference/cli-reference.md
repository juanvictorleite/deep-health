---
type: Reference
title: CLI reference
description: Commands, flags, and exit codes of the security-scan CLI.
tags: [reference, cli]
timestamp: 2026-07-06T00:00:00Z
---

# CLI Reference — security-scan

## Overview

```
security-scan <command> [options]
```

All commands require Docker and Node.js ≥ 26. Use `nvm use` to activate the correct version (the project includes `.nvmrc`). See [ADR-0001](/adr/0001-docker-only-runtime.md) for why Docker is required — no local mode is supported for ecosystem CLIs.

---

## Commands

### `init`

Generates a `security-scan.config.json` starter config in the current directory.

```bash
security-scan init [options]

Options:
  --project-name <name>   Project name written into config
  --client <name>         Client name written into config
  --output <path>         Output path (default: ./security-scan.config.json)
  --force                 Overwrite if the file already exists
```

**What it does:**

1. Recursively scans the project tree for lockfiles and Dockerfiles using `discoverProject()`. Each found lockfile is presented as a candidate ecosystem entry with its subdirectory path. When two or more entries share the same ecosystem id, a distinct label is assigned to each.
2. When any ecosystem is discovered in a subdirectory (monorepo layout), prints a formatted discovery summary before the checkbox prompt — showing plugin name, lockfile, and path for each found entry.
3. Prompts for per-ecosystem config (fixer strategy, validation commands, runner version, Dockerfile).
4. Generates `security-scan.config.json` programmatically via the config generator (`infrastructure/config/generator.ts`). The generated file includes a `$schema` field for IDE autocomplete.
5. Writes to the output path. Fails if the file exists and `--force` is not set.

**Exit codes:** `0` success, `3` config/output error.

---

### `scan`

Runs the vulnerability scan only. No files are modified.

```bash
security-scan scan [options]

Options:
  -c, --config <path>   Path to security-scan.config.json (default: ./security-scan.config.json)
  --cwd <path>          Working directory (default: current directory)
  --dry-run             Print what would run, execute nothing
  -v, --verbose         Enable verbose output
  -q, --quiet           Suppress all output except errors and final report
  --json                Output results as JSON to stdout
  -o, --output <path>   Write output to file instead of stdout
```

**What it does:**

1. Loads `security-scan.config.json` and validates with Zod schema.
2. Calls `runScanner()` which runs `osv-scanner` in an ephemeral Docker container against detected lockfiles.
3. Formats and emits the result (text summary or JSON).

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | No vulnerabilities found |
| `1` | Breaking vulnerabilities found |
| `2` | Scanner error (gate failure or OSV error) |
| `3` | Configuration error |

---

### `fix`

Full workflow: scan → apply safe updates per ecosystem → generate executive report.

```bash
security-scan fix [options]

Options:
  -c, --config <path>             Path to security-scan.config.json
  --phases <phases>               Comma-separated phases to run.
                                  Accepted values: scan, npm, composer, pip, report
                                  Also accepts entry keys for monorepo targeting:
                                    npm       = run all npm entries
                                    npm:frontend = run only the npm entry labelled "frontend"
                                  Default: all phases
  --no-report                     Skip executive report generation
  --authorize-breaking <id...>    Allow breaking-change updates for these ecosystems.
                                  Accepts bare plugin id OR entry key:
                                    npm         = authorize all npm entries
                                    npm:frontend = authorize only the "frontend" npm entry
                                  Repeatable: --authorize-breaking npm --authorize-breaking composer
  --split-reports                 Generate one report per ecosystem entry instead of a
                                  consolidated report. Each report is named after its entry
                                  (e.g. npm-report.html, npm-frontend-report.html).
                                  Overrides outputs.split_reports in the config file.
  --dry-run                       Log planned changes, execute nothing
  -v, --verbose                   Enable verbose output
  --json                          Output results as JSON
  -o, --output <path>             Write report to file
```

**What it does:**

See the [Orchestrator Pipeline Flow](/architecture/orchestrator-pipeline.md) diagram. In short:

1. Loads config and validates.
2. Runs all scanner engines (OSV primary + SonarQube secondary if configured).
3. Runs Gate A validation on the OSV result.
4. For each `config.ecosystems` entry (in declaration order):
   a. Runs advisors (informational only — never blocks).
   b. Skips the entry if there are no `auto_safe` vulnerabilities (or no `breaking` vulns when `--authorize-breaking` was given).
   c. Resolves the Docker container runner for this entry (npm/pip/composer), using the entry's inline `runner` config.
   d. For npm, auto-demotes `osv`/`osv-then-audit` to `npm-audit` if `package-lock.json` has `lockfileVersion: 1` (osv-scanner cannot patch v1 lockfiles in-place). Applies OSV staging-fix if the effective strategy is `osv` or `osv-then-audit`.
   e. Calls `plugin.runUpdater()`.
   f. Optionally installs breaking packages (`--authorize-breaking`).
   g. Runs post-update OSV residual verification.
   h. Validates update result against ecosystem gate (Zod schema).
5. Generates and saves the executive report (HTML + optionally Markdown).
6. Writes `.security-scan-audit.json` audit trail.

**Environment variable kill-switch:**

```bash
SECURITY_SCAN_NO_AUTO_FIX=1 security-scan fix
```

Skips all automated fixes after the scan phase. Useful in CI pipelines where you want the scan result without any file mutations.

**Breaking-change authorization:**

```bash
# Authorize all composer and npm entries
security-scan fix --authorize-breaking composer npm

# Monorepo: authorize only the "frontend" npm entry, not "backend"
security-scan fix --authorize-breaking npm:frontend
```

Breaking packages (`classification: 'breaking'`) are skipped unless their ecosystem is explicitly authorized. Authorization is per-run and never persisted. The `--authorize-breaking` flag accepts both bare plugin ids (`npm`) and entry keys (`npm:frontend`). A bare id authorizes all entries sharing that plugin id.

**Phase targeting for monorepos:**

```bash
# Run scan and only the frontend npm entry phase
security-scan fix --phases scan,npm:frontend,report

# Run scan and all npm entries (any label)
security-scan fix --phases scan,npm,report
```

**Split reports:**

```bash
# Generate separate HTML reports for each ecosystem entry
security-scan fix --split-reports
# Produces: npm-report.html, npm-frontend-report.html, composer-report.html, etc.
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | All resolved (or nothing to fix) |
| `1` | Vulnerabilities found / update errors / pending vulns remain |
| `2` | Gate validation failure or scanner error |
| `3` | Configuration error |

---

### `executive-report`

Generates an executive HTML report from the last scan results stored on disk.

```bash
security-scan executive-report [options]

Options:
  --client <name>     Client name (overrides security-scan.config.json)
  --project <name>    Project name (overrides security-scan.config.json)
  -o, --output <path> Write report to file
  --split-reports     Generate one report per ecosystem entry instead of a
                      consolidated report. Overrides outputs.split_reports in config.
```

**What it does:**

Reads the most recent scan JSON outputs from the reports directory and renders the executive HTML report. Supports `en` and `pt-br` locales (set via `report_language` in config).

When `--split-reports` is set (or `outputs.split_reports: true` in config), generates one report per ecosystem entry. Report filenames follow the entry key format: `npm-report.html` for a bare-id entry, `npm-frontend-report.html` for an entry with label `frontend`.

---

## Configuration Reference

Full annotated `security-scan.config.json`:

```json
{
  "$schema": "./.security-scan/config-schema.json",

  "project": {
    "name": "My Project",
    "client": "Acme Corp"
  },

  "report_language": "en",

  "ecosystems": [
    {
      "id": "npm",
      "path": "frontend",
      "label": "frontend",
      "fixer": "osv-then-audit",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "npm test",
          "timeout_seconds": 120
        }
      ],
      "runner": {
        "language_version": "20"
      }
    },
    {
      "id": "composer",
      "fixer": "osv",
      "runner": {
        "language_version": "8.1"
      }
    },
    {
      "id": "pip",
      "fixer": "osv",
      "runner": {
        "language_version": "3.11"
      }
    }
  ],

  "protected_packages": {
    "composer": [
      {
        "package": "laravel/framework",
        "constraint": "^10.8",
        "reason": "Major upgrade to Laravel 11 requires a dedicated project"
      }
    ],
    "npm": [
      {
        "package": "tailwindcss",
        "constraint": "^3.3.3",
        "reason": "Tailwind v4 has breaking config changes"
      }
    ],
    "pip": [
      {
        "package": "django",
        "constraint": ">=4.2,<5.0",
        "reason": "Django 5.x has breaking changes"
      }
    ]
  },

  "safe_update_policy": {
    "allow_patch_and_minor_within_constraints": true,
    "require_authorization_for_constraint_change": true
  },

  "conflict_resolution": "manual",

  "scanners": {
    "primary": "osv",
    "osv": {
      "runner": "docker",
      "image": "ghcr.io/google/osv-scanner:latest"
    },
    "sonarqube": {
      "enabled": false,
      "on_failure": "warn"
    }
  },

  "outputs": {
    "dir": "./reports",
    "sub_folders": false,
    "formats": ["markdown"],
    "split_reports": false
  }
}
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Clean — no vulnerabilities or all resolved |
| `1` | Vulnerabilities found, update errors, or pending vulns after fix |
| `2` | Gate validation failure or scanner error |
| `3` | Configuration error |

These codes make `security-scan` suitable for CI/CD pipelines. A non-zero exit from `scan` or `fix` will fail the pipeline step.

---

## CI/CD Example

```yaml
# .github/workflows/security.yml
name: Security scan

on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday at 6am
  push:
    paths:
      - 'composer.lock'
      - 'package-lock.json'
      - 'requirements.txt'

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '26'
      - run: npm install -g security-scan
      - run: security-scan scan --json --output scan-results.json
      - uses: actions/upload-artifact@v4
        with:
          name: scan-results
          path: scan-results.json
```

---

## Environment Variables

| Variable | Effect |
|---|---|
| `SECURITY_SCAN_NO_AUTO_FIX=1` | Skips all automated fixes after the scan phase |
| `LOG_LEVEL=debug` | Enables debug-level logging |
