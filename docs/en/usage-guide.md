# security-scan — Complete Usage Guide

> Version 0.1.9 | Docker required (Node.js ≥ 26 only for npm install)

---

## Table of Contents

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [Quick Start](#quick-start)
5. [Commands](#commands)
   - [init](#init)
   - [scan](#scan)
   - [fix](#fix)
   - [executive-report](#executive-report)
6. [Configuration Reference](#configuration-reference)
   - [project](#project)
   - [report_language](#report_language)
   - [ecosystems](#ecosystems)
   - [protected_packages](#protected_packages)
   - [safe_update_policy](#safe_update_policy)
   - [scanners](#scanners)
   - [runners](#runners)
   - [scan (scan paths)](#scan-scan-paths)
   - [outputs](#outputs)
7. [Docker and Runtime Strategies](#docker-and-runtime-strategies)
8. [Scanner Engines](#scanner-engines)
   - [OSV Scanner](#osv-scanner)
   - [SonarQube](#sonarqube)
9. [Ecosystem Plugins and Fixer Strategies](#ecosystem-plugins-and-fixer-strategies)
10. [Protected Packages and Safe Update Policy](#protected-packages-and-safe-update-policy)
11. [Environment Variables](#environment-variables)
12. [Exit Codes](#exit-codes)
13. [What to do after `fix`](#what-to-do-after-fix)
14. [Troubleshooting](#troubleshooting)
15. [FAQ](#faq)

---

## Overview

`security-scan` is a CLI tool that automates the full vulnerability management workflow for multi-ecosystem projects. In a single command it can:

1. Scan all lockfiles (`composer.lock`, `package-lock.json`, `requirements.txt`, `Pipfile.lock`) using [OSV Scanner](https://google.github.io/osv-scanner/)
2. Classify vulnerabilities as safe-to-update or requiring manual authorization
3. Apply patch and minor updates inside isolated Docker containers — no local PHP/Node/Python installation needed
4. Run your validation commands (test suites) inside the same container to confirm nothing broke
5. Revert all changes automatically if validation fails
6. Generate an executive HTML report with a before/after vulnerability comparison

Breaking changes (major version bumps, constraint changes) are never applied automatically. They require explicit per-ecosystem authorization via `--authorize-breaking`.

---

## Requirements

| Tool    | Minimum version | Notes |
|---------|----------------|-------|
| Docker  | any recent     | **Required.** All ecosystem runtimes and scanners run in containers. |
| Node.js | ≥ 26.0.0       | **Required.** Use `nvm use` to activate the correct version (the project includes `.nvmrc`). |

Docker is the only mandatory runtime requirement. OSV Scanner, SonarQube, npm, PHP Composer, and pip all run inside ephemeral Docker containers. You do not need to install any of those tools locally.

---

## Installation

### Prerequisite: Node.js ≥ 26 via nvm

The project includes a `.nvmrc` file that pins the correct version. Before installing or running security-scan, make sure you're using the right version:

```bash
# Install the version if you don't have it yet
nvm install

# Activate the version (run this whenever you open a new terminal in the project)
nvm use
```

> **Tip:** to activate automatically when entering the directory, add [nvm's auto-use](https://github.com/nvm-sh/nvm#deeper-shell-integration) to your `.bashrc` or `.zshrc`. That way you never forget to run `nvm use`.

### Install via npm

```bash
npm install -g security-scan
```

### Verify the installation

```bash
node --version
# v26.x.x (confirm it's ≥ 26)

security-scan --version
# security-scan/0.1.9
```

---

## Quick Start

### First time in a project (setup)

**Step 1: Generate a config file**

```bash
security-scan init
```

This starts an interactive wizard that detects your ecosystems (npm, composer, pip), asks you to confirm or adjust the configuration, and writes a `security-scan.config.json` to the current directory. The generated file includes a `$schema` field for IDE autocomplete.

> **This step is done only once.** The generated `security-scan.config.json` is committed to the repository. On subsequent runs, skip straight to step 2.

### Recurring usage

**Step 2: Scan for vulnerabilities**

```bash
security-scan scan
```

Prints a summary of all vulnerabilities found. No files are modified.

**Step 3: Apply safe fixes**

```bash
security-scan fix
```

Runs the full pipeline: scan → apply safe updates → validate → revert if broken → generate executive report.

> **Typical workflow:** if the project already has `security-scan.config.json`, the day-to-day flow is just `security-scan fix`.

---

## Commands

### `init`

Generates a `security-scan.config.json` config for the current project.

```
security-scan init [options]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--project-name <name>` | string | prompted | Project name written into the config |
| `--client <name>` | string | prompted | Client name written into the config |
| `--cwd <path>` | string | current directory | Working directory for ecosystem detection |
| `--output <path>` | string | `./security-scan.config.json` | Output file path |
| `--force` | boolean | `false` | Overwrite the file if it already exists |

**What happens during `init`:**

1. Checks if `security-scan.config.json` already exists (fails unless `--force` is set).
2. Prompts for project name and client name (or uses CLI flags).
3. Detects the runtime environment by reading project files:
   - **npm**: reads `.nvmrc`, `.node-version`, `package.json#engines.node`
   - **composer**: reads `.php-version`, `composer.json#require.php`
   - **pip**: reads `runtime.txt`, `.python-version`
4. Presents an ecosystem selection checkbox (detected ecosystems are pre-checked).
5. For each ecosystem, prompts for:
   - Fixer strategy (`osv`, `npm-audit`, `osv-then-audit`)
   - Validation commands (e.g. `npm test`, `php artisan test`)
   - Advisor commands (e.g. `npm audit --json`)
   - Language/runtime version (inferred or entered manually)
   - Image source (`pull` or `dockerfile`)
6. Asks whether to enable SonarQube integration.
7. Asks for the report language (`en` or `pt-br`).
8. Asks whether to generate Markdown reports and where to save them.
9. Writes the generated `security-scan.config.json`.
10. If SonarQube is enabled and `sonar-project.properties` does not exist, creates a starter template.

**Example — non-interactive (CI-friendly):**

```bash
security-scan init \
  --project-name "My App" \
  --client "Acme Corp" \
  --force
```

In non-interactive mode (when stdin is not a TTY), `init` auto-selects all detected ecosystems and their default values.

**Exit codes:** `0` success, `3` config/output error.

---

### `scan`

Runs the vulnerability scan only. No files are modified.

```
security-scan scan [options]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `-c, --config <path>` | string | `./security-scan.config.json` | Path to config file |
| `--cwd <path>` | string | current directory | Working directory (project root) |
| `--dry-run` | boolean | `false` | Print what would run, execute nothing |
| `-v, --verbose` | boolean | `false` | Enable verbose output |
| `-q, --quiet` | boolean | `false` | Suppress all output except errors and the final report |
| `--json` | boolean | `false` | Output results as JSON to stdout |
| `-o, --output <path>` | string | stdout | Write output to a file |

**What happens during `scan`:**

1. Loads and validates `security-scan.config.json` using the Zod schema. Exits with code `3` on validation error.
2. Runs `osv-scanner` inside an ephemeral Docker container against all detected lockfiles in the working directory.
3. Parses the OSV output and classifies each finding:
   - `auto_safe` — patch/minor update within current constraints
   - `breaking` — major version bump or constraint change required
4. Formats and emits the result (text summary or JSON).

**Examples:**

```bash
# Basic scan
security-scan scan

# Scan a project in a different directory
security-scan scan --cwd /path/to/project

# Save JSON results to a file (useful for CI artifacts)
security-scan scan --json --output scan-results.json

# Quiet mode: only print the final summary
security-scan scan --quiet
```

**Sample output:**

```
security-scan scan summary
========================
npm        2 vulnerabilities  (1 auto-safe, 1 breaking)
composer   0 vulnerabilities
pip        1 vulnerability    (1 auto-safe)

Exit code: 1 (breaking vulnerabilities found)
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | No vulnerabilities found |
| `1` | Breaking vulnerabilities found |
| `2` | Scanner error (gate failure or OSV error) |
| `3` | Configuration error |

---

### `fix`

Full workflow: scan → apply safe updates per ecosystem → validate → revert if broken → generate executive report.

```
security-scan fix [options]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `-c, --config <path>` | string | `./security-scan.config.json` | Path to config file |
| `--cwd <path>` | string | current directory | Working directory (project root) |
| `--phases <phases>` | string | all phases | Comma-separated list of phases to run. Accepted values: `scan`, `npm`, `composer`, `pip`, `report` |
| `--no-report` | boolean | `false` | Skip executive report generation |
| `--authorize-breaking <id...>` | string[] | none | Authorize breaking-change updates for the given ecosystem(s). Example: `--authorize-breaking composer npm` |
| `--dry-run` | boolean | `false` | Log planned changes, execute nothing |
| `-v, --verbose` | boolean | `false` | Enable verbose output |
| `-q, --quiet` | boolean | `false` | Suppress all output except errors and the final report |
| `--json` | boolean | `false` | Output results as JSON |
| `-o, --output <path>` | string | stdout | Write report to file |
**Pipeline phases:**

The fix command runs the following phases in order:

1. **scan** — runs OSV Scanner as Gate A; classifies vulnerabilities.
2. **npm** — updates npm packages (if npm ecosystem is configured).
3. **composer** — updates PHP packages (if composer ecosystem is configured).
4. **pip** — updates Python packages (if pip ecosystem is configured).
5. **report** — generates the executive HTML report.

Use `--phases` to run only a subset:

```bash
# Run scan and npm phases only
security-scan fix --phases scan,npm

# Run all phases except the report
security-scan fix --no-report
```

**Authorizing breaking changes:**

```bash
# Allow composer packages to be updated to breaking versions
security-scan fix --authorize-breaking composer

# Allow both npm and composer breaking updates
security-scan fix --authorize-breaking npm composer
```

Authorization is per-run and is never persisted to the config file.

**Kill-switch environment variable:**

```bash
# Skip all automated fixes after the scan phase
SECURITY_SCAN_NO_AUTO_FIX=1 security-scan fix
```

This is useful in CI pipelines where you want the scan result logged but no files mutated.

**Exit codes:**

| Code | Meaning |
|------|---------|
| `0` | All resolved (or nothing to fix) |
| `1` | Vulnerabilities found / update errors / pending vulns remain |
| `2` | Gate validation failure or scanner error |
| `3` | Configuration error |

**Per-ecosystem pipeline detail:**

For each ecosystem plugin:
1. Runs advisors (informational — never blocks the pipeline).
2. Skips the plugin if there are no `auto_safe` vulnerabilities (and no `breaking` with `--authorize-breaking`).
3. Resolves the Docker container runner (npm/pip/composer).
4. For npm: auto-demotes `osv`/`osv-then-audit` strategy to `npm-audit` if `package-lock.json` has `lockfileVersion: 1` (osv-scanner cannot patch v1 lockfiles in-place).
5. Calls the plugin's updater.
6. Optionally installs breaking packages (`--authorize-breaking`).
7. Runs post-update OSV residual verification to confirm fixes took effect.
8. Validates the update result against the ecosystem gate (Zod schema).

On success: applies the updates and runs validation commands.
On validation failure: reverts all changes to that ecosystem and continues with others.

---

### `executive-report`

Generates an executive HTML report from the last scan results.

```
security-scan executive-report [options]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `-c, --config <path>` | string | `./security-scan.config.json` | Path to config file |
| `--cwd <path>` | string | current directory | Working directory |
| `--client <name>` | string | from config | Client name (overrides `project.client` in config) |
| `--project <name>` | string | from config | Project name (overrides `project.name` in config) |
| `-o, --output <path>` | string | reports dir | Write report to file |
| `--dry-run` | boolean | `false` | Show commands without executing |
| `-v, --verbose` | boolean | `false` | Enable verbose output |
| `-q, --quiet` | boolean | `false` | Suppress all output except errors and the final report |
| `--json` | boolean | `false` | Output results as JSON |

**What it does:**

1. Runs a fresh vulnerability scan (before state).
2. Runs the full orchestrator pipeline.
3. Renders the executive HTML report.
4. Saves the report to the configured output directory.
The report language is controlled by `report_language` in `security-scan.config.json` (`"en"` or `"pt-br"`).

**Example:**

```bash
# Generate report with a custom client name
security-scan executive-report --client "Acme Corp" --output report.html
```

---

## Configuration Reference

`security-scan.config.json` is the single source of truth for all security-scan behavior. Below is a fully annotated reference covering every field.

### `project`

```json
{
  "project": {
    "name": "My Project",
    "client": "Acme Corp"
  }
}
```

### `report_language`

```json
{
  "report_language": "en"
}
```

Controls the locale for generated executive reports. Affects all text in the HTML and Markdown reports. Does not affect CLI output.

### `config_version`

```json
{
  "config_version": "1"
}
```

### `ecosystems`

Declarative list of ecosystems to scan and update. At least one entry is required.

```json
{
  "ecosystems": [
    {
      "id": "npm",
      "fixer": "osv-then-audit",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "npm test",
          "timeout_seconds": 120
        }
      ],
      "advisors": [
        {
          "name": "audit",
          "command": "npm audit --json",
          "format": "json"
        }
      ]
    },
    {
      "id": "composer",
      "fixer": "osv",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "php artisan test",
          "timeout_seconds": 300
        }
      ],
      "advisors": []
    },
    {
      "id": "pip",
      "fixer": "osv",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "pytest"
        }
      ]
    }
  ]
}
```

**Ecosystem fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `npm` \| `composer` \| `pip` | Yes | Ecosystem identifier |
| `fixer` | string | No | Fixer strategy (see [Fixer Strategies](#fixer-strategies)) |
| `validationCommands` | array | No | Commands run after updates to verify nothing broke |
| `validationCommands[].name` | string | Yes | Human-readable label for the command |
| `validationCommands[].command` | string | Yes | Shell command string (runs inside the Docker container) |
| `validationCommands[].timeout_seconds` | number | No | Timeout in seconds; default: 300 |
| `advisors` | array | No | Informational commands that run before updates (never blocks the pipeline) |
| `advisors[].name` | string | Yes | Human-readable label |
| `advisors[].command` | string | Yes | Shell command string |
| `advisors[].format` | `json` \| `text` | No | Output format; use `json` for `npm audit --json` |

**Security note on `validationCommands`:** These run inside the ecosystem's Docker container via `sh -c`. They are not exposed to external input — only commands authored in `security-scan.config.json` (which you control) are executed. Commands starting with `git`, `gh`, or `open` are exempted and run on the host.

### `protected_packages`

Packages listed here are never updated beyond their declared constraint. Any update requiring a constraint change requires explicit `--authorize-breaking`.

```json
{
  "protected_packages": {
    "npm": [
      {
        "package": "tailwindcss",
        "constraint": "^3.3.3",
        "reason": "Tailwind v4 has breaking config and migration requirements"
      },
      {
        "package": "react",
        "constraint": "^18.0.0",
        "reason": "React 19 migration requires full QA cycle"
      }
    ],
    "composer": [
      {
        "package": "laravel/framework",
        "constraint": "^10.8",
        "reason": "Major upgrade to Laravel 11 requires a dedicated project"
      }
    ],
    "pip": [
      {
        "package": "django",
        "constraint": ">=4.2,<5.0",
        "reason": "Django 5.x has breaking changes"
      }
    ]
  }
}
```

**Fields per entry:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `package` | string | Yes | Package name as it appears in the lockfile |
| `constraint` | string | Yes | The version constraint that must not be exceeded |
| `reason` | string | Yes | Human-readable reason (appears in reports) |

### `safe_update_policy`

```json
{
  "safe_update_policy": {
    "allow_patch_and_minor_within_constraints": true,
    "require_authorization_for_constraint_change": true
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `allow_patch_and_minor_within_constraints` | `true` | Automatically apply patch and minor updates that stay within current `^` / `~` / `>=` constraints |
| `require_authorization_for_constraint_change` | `true` | Require `--authorize-breaking` for any update that would change the declared version constraint |

### `scanners`

Controls which scanning engines are used and how they are configured.

```json
{
  "scanners": {
    "primary": "osv",
    "osv": {
      "runner": "docker",
      "image": "ghcr.io/google/osv-scanner:latest",
      "args": []
    },
    "sonarqube": {
      "enabled": false,
      "mode": "external",
      "on_failure": "warn",
      "scanner_image": "sonarsource/sonar-scanner-cli:latest",
      "server_image": "sonarqube:lts-community",
      "send_branch_name": false,
      "ce_task_timeout_seconds": 120,
      "scanner_timeout_seconds": 300,
      "dynamic_timeout": true,
      "timeout_scale": {
        "scanner_seconds_per_kloc": 3,
        "ce_seconds_per_kloc": 1.5
      },
      "scanner_jvm_opts": "-Xmx2048m"
    }
  }
}
```

**OSV runner modes:**

| Mode | Behavior |
|------|----------|
| `docker` | Always run osv-scanner via an ephemeral Docker container. **Default and recommended.** |
| `local` | Use the locally installed `osv-scanner` binary. Fails if not installed. Emits a warning. |
| `auto` | Try local first; fall back to Docker if unavailable. **Deprecated escape hatch — emits a warning.** |

### `runners`

Per-ecosystem container configuration. Controls which Docker image is used, the runtime version, and optional OS-level dependencies.

```json
{
  "runners": {
    "npm": {
      "language_version": "20",
      "image_source": "pull",
      "native_deps": [
        "libvips-dev",
        "build-essential",
        "python3"
      ]
    },
    "composer": {
      "language_version": "8.1",
      "image_source": "pull",
      "native_deps": [
        "imagemagick",
        "libmagickwand-dev"
      ]
    },
    "pip": {
      "language_version": "3.11",
      "image_source": "pull",
      "native_deps": [
        "libjpeg-dev",
        "libpq-dev"
      ]
    }
  }
}
```

All runners execute inside ephemeral Docker containers. There is no `local` mode for ecosystem runners — that option exists only for the OSV scanner (`scanners.osv.runner`).

### `scan` (scan paths)

Controls which paths `osv-scanner` inspects.

```json
{
  "scan": {
    "auto_discover": true,
    "paths": [
      "frontend/",
      "backend/package-lock.json"
    ],
    "exclude": [
      "vendor/",
      "node_modules/"
    ]
  }
}
```

**Constraints on paths:** All entries must be relative (no leading `/`) and must not contain `..` segments or glob characters. Paths resolve relative to `/project` inside the container.

### `outputs`

Controls report output location and formats.

```json
{
  "outputs": {
    "dir": "./reports",
    "sub_folders": false,
    "formats": ["markdown"]
  }
}
```

The executive HTML report is always generated. Markdown and DOCX are generated only when included in `formats`.

---

## Docker and Runtime Strategies

All ecosystem CLIs (npm, composer, pip) and scanners (osv-scanner) run inside ephemeral Docker containers by default. This means:

- No local Node.js, PHP, or Python installation is needed beyond the security-scan CLI itself.
- Each run gets a clean, isolated environment.
- Container versions match the project's declared runtime (inferred or configured).
- Containers are removed automatically after each run (`--rm`).

### Image Source: pull vs dockerfile

Each runner supports two image strategies:

**`pull` (default):** Pull a pre-built image from Docker Hub or another registry.

```json
{
  "runners": {
    "npm": {
      "image_source": "pull",
      "language_version": "20"
    }
  }
}
```

**`dockerfile`:** Build a local image from a project-owned Dockerfile. Use this when your project has non-standard system dependencies or a custom base image.

```json
{
  "runners": {
    "npm": {
      "image_source": "dockerfile",
      "dockerfile_path": ".docker/node.Dockerfile",
      "build_context": ".",
      "build_args": {
        "NODE_VERSION": "20",
        "APP_ENV": "production"
      }
    }
  }
}
```

The `dockerfile` strategy is mutually exclusive with the `image` field. When `allow_build_context_escape: true`, the build context may reach outside the project root — this emits a warning because it sends a larger directory tree to the Docker daemon.

### Runtime Version Resolution

When `image` is not set, the runner resolves the Docker image from the runtime version using this precedence:

**npm:**
1. `runners.npm.language_version` from config (e.g. `'20'` → `node:20`)
2. Inferred from `.nvmrc` / `.node-version` / `package.json#engines.node`
3. Falls back to `node:lts`

**composer:**
1. `runners.composer.language_version` from config (e.g. `'8.2'` → `php:8.2-cli`)
2. Inferred from `.php-version` / `composer.json#require.php`
3. Falls back to `composer:2`

**pip:**
1. `runners.pip.language_version` from config (e.g. `'3.11'` → `python:3.11-slim`)
2. Inferred from `runtime.txt` / `.python-version`
3. Falls back to `python:3-slim`

### Native OS Dependencies

Some npm packages (e.g. `sharp`, `canvas`) or PHP extensions (e.g. `imagick`) require OS-level libraries to compile. Use `native_deps` to install them via `apt-get` inside the ephemeral container:

```json
{
  "runners": {
    "npm": {
      "native_deps": [
        "libvips-dev",
        "build-essential",
        "python3"
      ]
    },
    "composer": {
      "native_deps": [
        "imagemagick",
        "libmagickwand-dev"
      ]
    },
    "pip": {
      "native_deps": [
        "libjpeg-dev",
        "libpq-dev"
      ]
    }
  }
}
```

Packages are installed with `apt-get install -y --no-install-recommends` before the ecosystem CLI runs. Package names must follow Debian naming conventions (lowercase alphanumeric, hyphens, dots, plus signs only).

---

## Scanner Engines

### OSV Scanner

The primary scanning engine. OSV Scanner uses Google's [Open Source Vulnerabilities](https://osv.dev) database to find known vulnerabilities in lockfiles.

**Supported lockfiles:**
- `package-lock.json` (npm)
- `yarn.lock` (npm, read-only — updates via npm)
- `composer.lock` (PHP Composer)
- `requirements.txt`, `Pipfile.lock` (Python pip)

**Configuration:**

```json
{
  "scanners": {
    "primary": "osv",
    "osv": {
      "runner": "docker",
      "image": "ghcr.io/google/osv-scanner:latest",
      "args": ["--experimental-call-analysis"]
    }
  }
}
```

OSV Scanner runs in an ephemeral Docker container. The project directory is mounted read-only inside the container. No lockfiles are modified during the scan phase.

### SonarQube

An optional secondary scanning engine for code quality analysis.

**External mode** (default when enabled):

Uses a pre-existing SonarQube instance. Configuration comes from `sonar-project.properties` in the project root. Authentication uses the `SONAR_TOKEN` environment variable.

```json
{
  "scanners": {
    "sonarqube": {
      "enabled": true,
      "mode": "external",
      "on_failure": "warn"
    }
  }
}
```

Create `sonar-project.properties`:

```properties
sonar.projectKey=my-project
sonar.projectName=My Project
sonar.sources=src
sonar.exclusions=**/node_modules/**,**/vendor/**
sonar.host.url=https://sonarqube.example.com
```

Set the auth token:

```bash
export SONAR_TOKEN=your_token_here
```

**Generating a SonarQube token:**

Go to your SonarQube instance → **User icon (top-right) → My Account → Security → Generate Tokens**.

| Token type | Prefix | Submit analysis | Query API (CE task, Quality Gate, metrics) |
|---|---|---|---|
| **User Token** | `squ_` | Yes | Yes (inherits the user's permissions) |
| Project Analysis Token | `sqp_` | Yes | No (analysis only) |
| Global Analysis Token | `sqa_` | Yes | No (analysis only) |

**Use a User Token** (`squ_`). Project and Global Analysis tokens can submit scans but cannot query the Compute Engine or Quality Gate APIs — you will see HTTP 403 errors during the post-scan phase.

The user associated with the token must have **Browse** permission on the project (granted by default for project members) or **Administer System** globally.

> **Important:** Do not store the token in `sonar-project.properties`. The `sonar.login` and `sonar.password` fields are deprecated (sonar-scanner 5+ rejects them). Always use the `SONAR_TOKEN` environment variable. In CI, add it as an environment secret.

**Managed mode:**

The CLI provisions an ephemeral SonarQube Community Edition container, runs the scan, then tears it down.

```json
{
  "scanners": {
    "sonarqube": {
      "enabled": true,
      "mode": "managed",
      "server_image": "sonarqube:lts-community",
      "scanner_image": "sonarsource/sonar-scanner-cli:latest",
      "on_failure": "warn"
    }
  }
}
```

Note: `send_branch_name: true` requires SonarQube Developer Edition or higher. Community Edition does not support branch analysis.

**SonarQube results in reports:**

When SonarQube is enabled, the executive report includes:
- Quality Gate status (PASSED / FAILED)
- Quality Gate conditions
- Metrics: bugs, vulnerabilities, code smells, coverage, duplicated lines, NCLOC
- Issues by file

---

## Ecosystem Plugins and Fixer Strategies

### npm

Scans `package-lock.json` and applies npm dependency updates.

**Fixer strategies:**

| Strategy | Behavior |
|----------|----------|
| `osv` | OSV Scanner applies in-place fixes to `package-lock.json`. Breaking changes are applied separately by npm via `npm install <pkg>@<version>`. |
| `npm-audit` | Uses `npm audit fix` exclusively. OSV fix is not run in this path. |
| `osv-then-audit` | Applies OSV fix first, then runs `npm audit fix` on top. If validation fails after both, reverts the `npm-audit` portion and re-validates against the OSV-only state. **Default for npm.** |

**Auto-demotion:**

If `package-lock.json` has `lockfileVersion: 1` (npm ≤ 6), the `osv` and `osv-then-audit` strategies are automatically demoted to `npm-audit` because osv-scanner cannot patch v1 lockfiles in-place. This demotion is logged as a warning.

### composer

Scans `composer.lock` and applies PHP package updates using Composer.

**Fixer strategy:**

| Strategy | Behavior |
|----------|----------|
| `osv` | OSV Scanner identifies vulnerable packages; Composer is used to update them. **Only strategy available for composer.** |

**Default image:** `php:<version>-cli` (e.g. `php:8.2-cli`)

**Platform requirements:** The CLI automatically ignores irrelevant platform requirements (production-specific PHP extensions) when running inside Docker containers, using granular `--ignore-platform-req` flags per extension. No manual configuration is needed.

### pip

Scans `requirements.txt` or `Pipfile.lock` and applies Python package updates using pip.

**Fixer strategy:**

| Strategy | Behavior |
|----------|----------|
| `osv` | OSV Scanner identifies vulnerable packages; pip is used to update them. **Only strategy available for pip.** |

**Default image:** `python:<version>-slim` (e.g. `python:3.11-slim`)

### Fixer Strategies

| Strategy | Ecosystems | Description |
|----------|------------|-------------|
| `osv` | npm, composer, pip | OSV Scanner performs in-place fixes to lockfiles. This is the primary and most accurate method — fixes are sourced directly from the OSV database. |
| `npm-audit` | npm only | Delegates fix to `npm audit fix`. Faster but less precise than OSV for complex dependency trees. |
| `osv-then-audit` | npm only | Applies OSV fix first for precision, then runs `npm audit fix` to catch any remaining issues. Falls back gracefully to OSV-only if audit-fix causes validation failures. |

---

## Protected Packages and Safe Update Policy

The protected packages and safe update policy mechanisms work together to prevent accidental breaking changes.

### How Protection Works

1. When a vulnerability is found in a protected package:
   - If the fix stays within the declared `constraint`, it is classified as `auto_safe` and applied normally.
   - If the fix requires exceeding the `constraint` (e.g. `^3.x` → `^4.x`), it is classified as `breaking` and skipped.

2. `breaking` vulnerabilities are reported in the executive report with the reason for why they were not fixed.

3. To apply a breaking update to a protected package:
   ```bash
   security-scan fix --authorize-breaking npm
   ```
   This authorizes all breaking updates for npm in this run. Authorization is not persisted.

### Safe Update Policy Rules

```json
{
  "safe_update_policy": {
    "allow_patch_and_minor_within_constraints": true,
    "require_authorization_for_constraint_change": true
  }
}
```

With the defaults above:
- `lodash@4.17.19` → `lodash@4.17.21` (patch within `^4.17.0`) → **auto-applied**
- `lodash@4.17.21` → `lodash@5.0.0` (major bump, constraint change needed) → **blocked, authorization required**

---

## Environment Variables

| Variable | Effect |
|----------|--------|
| `SECURITY_SCAN_NO_AUTO_FIX=1` | Skips all automated fixes after the scan phase. The scan still runs and the exit code still reflects vulnerability status. Useful in pipelines where you want the scan result without file mutations. |
| `NPM_DEFAULT_FIXER` | Overrides the default npm fixer strategy. Valid values: `osv`, `npm-audit`, `osv-then-audit`. Default: `osv-then-audit`. |
| `LOG_LEVEL=debug` | Enables debug-level logging for detailed internal output. |
| `SONAR_TOKEN` | Authentication token for SonarQube in `external` mode. Required when SonarQube is enabled with `mode: external`. |

---

## Exit Codes

All commands follow the same exit code convention:

| Code | Meaning | When it occurs |
|------|---------|----------------|
| `0` | Clean — success | No vulnerabilities found, or all vulnerabilities resolved |
| `1` | Issues found | Vulnerabilities found, update errors, or pending vulnerabilities remain after fix |
| `2` | Scanner/gate error | Gate validation failure, OSV error, or unexpected scanner failure |
| `3` | Configuration error | `security-scan.config.json` not found, invalid schema, or `init` output path error |

These codes make security-scan usable as a gate in CI/CD pipelines:

```bash
security-scan scan && echo "Clean!" || echo "Issues found (code $?)"
```

---

## What to do after `fix`

After running `security-scan fix`, follow this checklist to make sure everything is correct before merging:

### 1. Review the modified files

```bash
git diff --stat
```

Confirm that only lockfiles and expected files were changed (`package-lock.json`, `composer.lock`, `requirements.txt`).

### 2. Review the executive report

Open the generated HTML report (by default in `./reports/`) and check:
- Which vulnerabilities were resolved
- Whether any pending vulnerabilities remain (classified as `breaking`)
- Whether any ecosystem was reverted due to validation failure

### 3. Run your tests locally

After the fix, lockfiles were changed in the current working tree. Run your tests locally to confirm:

```bash
# npm
npm ci && npm test

# composer
composer install && php artisan test

# pip
pip install -r requirements.txt && pytest
```

### 4. Validate `composer.lock` in the correct environment

If the project uses Composer, make sure `composer.lock` is consistent with `composer.json`:

```bash
composer validate
```

If you see "lock file is not up to date" errors, run `composer update --lock` in the same PHP environment as the project (or inside the Docker container).

### 5. Create a branch and push

```bash
git checkout -b fix/security-scan-$(date +%Y%m%d)
git add package-lock.json composer.lock requirements.txt
git commit -m "fix: apply safe dependency updates [security-scan]"
git push origin HEAD
```

### 6. Handle pending vulnerabilities

If the report shows unresolved `breaking` vulnerabilities:

1. **Evaluate each one** — read the reason in the report and decide if the major update is feasible now.
2. **Authorize if safe** — `security-scan fix --authorize-breaking npm composer`
3. **Create a ticket** — for major updates that need planning (e.g., Laravel 10→11 migration, React 18→19).

---

## Troubleshooting

### "security-scan requires Node.js >=26"

```
security-scan requires Node.js >=26. Detected: v20.x.x
Please upgrade Node.js and try again.
```

The project includes a `.nvmrc` with the correct version. Run:

```bash
nvm install    # installs the .nvmrc version if not already present
nvm use        # activates the correct version
```

To never forget again, set up nvm's auto-use in your shell. Add to your `~/.zshrc` (or `~/.bashrc`):

```bash
# Automatically activate .nvmrc version when entering a directory
autoload -U add-zsh-hook
load-nvmrc() {
  if [[ -f .nvmrc && -r .nvmrc ]]; then
    nvm use
  fi
}
add-zsh-hook chpwd load-nvmrc
load-nvmrc
```

Then restart your terminal. From that point on, whenever you enter a directory with `.nvmrc`, the correct version will be activated automatically.

### "Config file not found"

```
Config file not found: ./security-scan.config.json
Run "security-scan init" first.
```

Generate a config file:

```bash
security-scan init
```

Or specify the path explicitly:

```bash
security-scan scan --config /path/to/security-scan.config.json
```

### Docker not available

```
Error: docker: command not found
```

Install Docker from [docs.docker.com](https://docs.docker.com/get-docker/) and ensure the Docker daemon is running:

```bash
docker --version
docker ps
```

### "File already exists" during init

```
File already exists: ./security-scan.config.json
Use --force to overwrite.
```

Use `--force` to regenerate the config:

```bash
security-scan init --force
```

### SonarQube "SONAR_TOKEN not set"

```
SONAR_TOKEN environment variable is required for SonarQube external mode
```

Set the token:

```bash
export SONAR_TOKEN=your_token_here
security-scan scan
```

Or add it to your CI environment secrets.

### SonarQube CE task poll returns HTTP 403

```
SonarQube CE: task poll returned HTTP 403 — token lacks permission for the CE API.
```

The token used for authentication can submit analysis but cannot query the Compute Engine API. This happens when using a **Project Analysis Token** (`sqp_`) or **Global Analysis Token** (`sqa_`) instead of a **User Token** (`squ_`).

**Fix:** generate a User Token in your SonarQube instance (User → My Account → Security → Generate Tokens → type: User Token). Set it via `SONAR_TOKEN`:

```bash
export SONAR_TOKEN=squ_your_new_token
```

Also remove any `sonar.login` or `sonar.password` lines from `sonar-project.properties` — these are deprecated and sonar-scanner 5+ rejects them.

### `composer.lock` inconsistent between environments

```
The lock file is not up to date with the latest changes in composer.json
```

This happens when `composer.lock` was generated in an environment with a different PHP version than the one used in deploy or CI. security-scan runs Composer inside a Docker container with the PHP version configured in `runners.composer.language_version`.

**Solutions:**

1. **Make sure the PHP version is correct in the config:**
   ```json
   {
     "runners": {
       "composer": {
         "language_version": "8.2"
       }
     }
   }
   ```

2. **Regenerate the lockfile in the correct environment:**
   ```bash
   # Inside a container with the right PHP version
   docker run --rm -v $(pwd):/app -w /app php:8.2-cli composer update --lock
   ```

3. **Validate before committing:**
   ```bash
   composer validate
   ```

### Breaking vulnerabilities not fixed

This is expected behavior. Vulnerabilities classified as `breaking` require explicit authorization:

```bash
security-scan fix --authorize-breaking npm composer
```

Check the scan output for which packages need authorization.

### npm audit fix causes validation failure

When using `osv-then-audit` strategy and `npm audit fix` breaks validation, security-scan automatically reverts the `npm audit fix` portion and re-validates against the OSV-only state. If the OSV-only state also fails validation, all npm changes are reverted.

### Validation commands time out

Increase `timeout_seconds` for the relevant validation command:

```json
{
  "ecosystems": [
    {
      "id": "composer",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "php artisan test",
          "timeout_seconds": 600
        }
      ]
    }
  ]
}
```

---

## FAQ

**Q: Does security-scan modify my lockfiles directly?**

Yes. When you run `security-scan fix`, it modifies `package-lock.json`, `composer.lock`, and `requirements.txt` / `Pipfile.lock` inside ephemeral Docker containers. Use `--dry-run` to see what would happen without making changes.

**Q: What happens if my test suite fails after an update?**

security-scan automatically reverts all changes to that ecosystem and continues with others. The failed ecosystem is reported as "reverted" in the executive report.

**Q: Can I use security-scan with a monorepo?**

Yes. Use `scan.paths` to specify which subdirectories to scan:

```json
{
  "scan": {
    "auto_discover": false,
    "paths": [
      "packages/frontend/",
      "packages/backend/"
    ]
  }
}
```

**Q: Does security-scan support yarn or pnpm?**

Currently only npm (`package-lock.json`) and yarn v1 (`yarn.lock`, read-only scanning only) are supported. pnpm is not yet supported.

**Q: Can I run security-scan without Docker?**

Docker is required for running ecosystem CLIs (npm, composer, pip) in the fix phase. OSV Scanner also uses Docker by default, though it can be run locally with `runners.osv.runner: 'local'`. The `local` mode for ecosystem runners is available but not recommended and emits a warning.

**Q: What does "authorization required" mean in the report?**

It means the fix requires a major version bump (e.g. `v3` → `v4`) or a change to the declared constraint. This is never applied automatically. To authorize it:

```bash
security-scan fix --authorize-breaking <ecosystem>
```

**Q: How do I add a new ecosystem to an existing config?**

Add a new entry to `ecosystems` in `security-scan.config.json`:

```json
{
  "ecosystems": [
    {
      "id": "pip",
      "fixer": "osv",
      "validationCommands": [
        {
          "name": "Tests",
          "command": "pytest"
        }
      ]
    }
  ]
}
```

**Q: Are my secrets safe with SonarQube managed mode?**

In managed mode, the CLI generates a temporary token via the SonarQube admin API and passes it as a CLI argument (not written to disk). `sonar.login` / `sonar.password` fields in `sonar-project.properties` are stripped via a sanitized temp copy (sonar-scanner 5+ rejects their presence).

**Q: How do I pin the OSV Scanner version?**

```json
{
  "scanners": {
    "osv": {
      "image": "ghcr.io/google/osv-scanner:v1.9.0"
    }
  }
}
```

**Q: Can I generate reports in both English and Portuguese?**

Not in a single run. Set `report_language` to either `en` or `pt-br`. To generate both, run `executive-report` twice with different config files.

**Q: Is security-scan open source?**

Yes. Licensed under MIT.
