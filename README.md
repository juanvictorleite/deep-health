# security-scan

One command that scans for vulnerabilities, applies safe dependency updates, runs your tests to confirm nothing broke, reverts if it did, and generates an executive report — all inside isolated Docker containers, with no local tool installation required beyond Docker itself.

Supports PHP (Composer), Node.js (npm), and Python (pip). Powered by [OSV Scanner](https://google.github.io/osv-scanner/) under the hood.

---

## Why this exists

Every month, I had to do the same thing for every client project:

1. Run OSV Scanner manually against each lockfile
2. Figure out which packages were safe to update without breaking anything
3. Apply the updates, run the test suite, revert if it broke
4. Generate three separate reports

It took hours. It was boring. And because it was boring, it sometimes didn't happen.

So I built `security-scan` to do all of it in one command.

Now it runs in CI, opens a PR with safe fixes already validated against the test suite, and delivers the executive report automatically. What used to take an afternoon takes about 15 minutes — most of which is waiting for tests to run.

The tool exists because the problem was real, the existing solutions (Dependabot, Renovate, Snyk) either didn't cover PHP/Composer reliably enough or didn't give me the end-to-end pipeline I needed: scan → fix in an isolated container → validate → revert if broken → report → PR. I needed all of those steps to be automatic and safe. None of the tools I tried did that out of the box.

---

## How it works

1. **Scan** — runs one OSV Scanner invocation per ecosystem entry, keyed by entry (e.g. `npm`, `npm:frontend`, `npm:backend`). Each entry scans its lockfile at the configured path — no cross-entry collision even when two entries share the same plugin.
2. **Fix** — applies patch/minor updates that don't break declared constraints; skips protected packages. Each entry is processed independently with its own Docker container and working directory.
3. **Report** — generates an HTML executive report with a vulnerability summary. Use `--split-reports` to produce one report per ecosystem entry instead of a consolidated report.

Breaking changes (constraint bumps, major versions) are never applied automatically. They require explicit per-package authorization via `--authorize-breaking`.

### Monorepo support

Projects with multiple lockfiles at different paths are fully supported. Each `ecosystems` entry in the config can specify a `path` (relative subdirectory) and an optional `label` to distinguish entries with the same plugin id:

```bash
# Authorize breaking changes only for the frontend npm entry
security-scan fix --authorize-breaking npm:frontend

# Run only the backend npm entry's phase
security-scan fix --phases scan,npm:backend,report

# Generate separate reports for each entry
security-scan fix --split-reports
```

`security-scan init` discovers all lockfiles recursively and pre-fills the config for you, including a discovery summary when entries are found in subdirectories.

---

## Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 26.0.0 | Required. Use `nvm use` to activate the correct version (`.nvmrc` included). |
| Docker | any recent version | Required for all scan and fix operations. |

Docker is used to run OSV Scanner (and optionally SonarQube) in ephemeral containers. No local installation of those tools is needed.

---

## Installation

```bash
npm install -g security-scan
```

Or run without installing:

```bash
npx security-scan --help
```

---

## Quick start

**1. Generate a config file**

```bash
security-scan init
```

This creates a `security-scan.config.json` in the current directory with sane defaults based on your runtime environment.

**2. Scan for vulnerabilities**

```bash
security-scan scan
```

**3. Scan and apply safe updates**

```bash
security-scan fix
```

That's it. Results are printed to stdout. Pass `--output report.html` to save the report to a file.

---

## Commands

### `init`

Recursively scans the project tree for lockfiles (`package-lock.json`, `composer.lock`, `requirements.txt`, `Pipfile.lock`) and Dockerfiles, then generates a `security-scan.config.json` with detected ecosystems pre-configured.

```bash
security-scan init [options]

Options:
  --project-name <name>   Project name
  --client <name>         Client name
  --output <path>         Output path (default: ./security-scan.config.json)
  --force                 Overwrite existing file
```

### `scan`

Run the vulnerability scan only (no updates applied).

```bash
security-scan scan [options]

Options:
  -c, --config <path>     Path to security-scan.config.json (default: ./security-scan.config.json)
  --cwd <path>            Working directory (default: current directory)
  --dry-run               Show commands without executing
  -v, --verbose           Verbose output
  -q, --quiet             Suppress all output except errors and final report
  --json                  Output results as JSON
  -o, --output <path>     Write report to file
```

### `fix`

Full workflow: scan → apply safe updates → generate executive report.

```bash
security-scan fix [options]

Options:
  -c, --config <path>             Path to security-scan.config.json
  --phases <phases>               Comma-separated phases: scan,npm,composer,pip,report
                                  (default: "scan,npm,composer,pip")
                                  Monorepo: use entry keys to target a single entry,
                                  e.g. --phases scan,npm:frontend,npm:backend
  --no-report                     Skip executive report generation
  --authorize-breaking <id...>    Authorize breaking-change updates for the given
                                  ecosystem(s). Example: --authorize-breaking composer npm pip
                                  Monorepo: target a specific entry with --authorize-breaking npm:frontend
  --split-reports                 Generate one report per ecosystem entry instead of a
                                  consolidated report. Each report is named after its entry
                                  (e.g. npm-frontend-report.html). Overrides outputs.split_reports
                                  in the config file.
  --dry-run                       Show commands without executing
  -v, --verbose                   Verbose output
  --json                          Output results as JSON
  -o, --output <path>             Write report to file
  --create-branch                 Create a git branch before applying fixes, commit on success
  --branch-prefix <prefix>        Branch name prefix (default: fix/security-scan-)
  --open-pr                       Open a GitHub PR after fix (implies --create-branch; requires gh CLI)
  --pr-title <title>              Pull request title (default: auto-generated)
```

### `executive-report`

Generate an executive HTML report from the last scan results.

```bash
security-scan executive-report [options]

Options:
  --client <name>     Client name (overrides security-scan.config.json)
  --project <name>    Project name (overrides security-scan.config.json)
  -o, --output <path> Write report to file
  --split-reports     Generate one report per ecosystem entry (overrides outputs.split_reports)
```

---

## Configuration

`security-scan init` generates a starter `security-scan.config.json`. The generated file includes a `$schema` field that enables IDE autocomplete. Here is a full annotated example:

```json
{
  "$schema": "./.security-scan/config-schema.json",
  "config_version": "1",

  "project": {
    "name": "My Project",
    "client": "Acme Corp"
  },

  "ecosystems": [
    {
      "id": "npm",
      "path": "frontend",
      "label": "frontend",
      "fixer": "osv",
      "validationCommands": [
        {
          "name": "tests",
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
      ],
      "runner": {
        "language_version": "20"
      }
    },
    {
      "id": "composer",
      "fixer": "osv",
      "validationCommands": [
        {
          "name": "tests",
          "command": "php artisan test"
        }
      ],
      "runner": {
        "language_version": "8.2"
      }
    }
  ],

  "protected_packages": {
    "npm": [
      {
        "package": "tailwindcss",
        "constraint": "^3.3.3",
        "reason": "Tailwind v4 has breaking config and migration requirements"
      }
    ],
    "composer": [
      {
        "package": "laravel/framework",
        "constraint": "^10.8",
        "reason": "Major upgrade to Laravel 11 requires a dedicated project"
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
      "runner": "docker"
    },
    "sonarqube": {
      "enabled": false
    }
  },

  "outputs": {
    "formats": ["markdown"],
    "dir": "reports",
    "split_reports": false
  }
}
```

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Clean — no vulnerabilities or all resolved |
| `1` | Vulnerabilities found / update errors |
| `2` | Gate validation failure or scanner error |
| `3` | Configuration error |

These codes make `security-scan` suitable for use in CI/CD pipelines.

---

## Git/PR Workflow

By default, `security-scan fix` mutates the working tree directly. Use `--create-branch` to wrap the fix in a reviewable Git branch:

```bash
# Create a branch, apply fixes, commit on success
security-scan fix --create-branch

# Create a branch AND open a GitHub PR (requires gh auth login)
security-scan fix --open-pr

# Custom branch prefix
security-scan fix --create-branch --branch-prefix deps/security-fix-
```

**Branch lifecycle:**
- Branch is created BEFORE any mutation: `fix/security-scan-<ISO-timestamp>`
- On success: changes are staged and committed as `fix: apply safe dependency updates [security-scan]`
- On failure: original branch is restored; no commit is made

**`--open-pr` prerequisites:** [GitHub CLI](https://cli.github.com/) installed and authenticated (`gh auth login`). The PR body includes ecosystem summary and security-scan version attribution.

---

## CI/CD example

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
      - 'Pipfile.lock'

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
      # To apply fixes and open a PR automatically (requires GITHUB_TOKEN and gh CLI):
      # - run: security-scan fix --open-pr
      - uses: actions/upload-artifact@v4
        with:
          name: scan-results
          path: scan-results.json
```

---

## Development

```bash
git clone https://github.com/your-org/security-scan.git
cd security-scan/osv-security-cli
npm install
npm run dev -- --help
```

### Running tests

```bash
npm run test              # All tests
npm run test:unit         # Unit tests only
npm run test:integration  # Integration test
npm run test:smoke        # Smoke tests (requires Docker)
npm run test:coverage     # With coverage report
```

### Building

```bash
npm run build
```

Output goes to `dist/`.

---

## Architecture

```
src/
├── app/           # CLI commands and I/O
├── core/          # Domain types, gates, and safe-update policy
├── infrastructure/
│   ├── config/    # Config loading, Zod schema, and init templates
│   ├── executor/  # Container command runners (npm, pip, composer)
│   │              # Non-ecosystem validation commands routed via runShell()
│   ├── provisioner/ # Docker runners with retry backoff (withRetry)
│   ├── storage/   # Local storage provider
│   └── utils/     # logger, git-branch, git-commit, retry, docker-platform
├── modules/
│   ├── ecosystem/ # npm, composer, pip plugins
│   └── scanner/   # OSV, SonarQube engines; ExternalScannerAdapter base class
├── orchestration/ # Main workflow coordinator
└── reporting/     # HTML report generation (templates + i18n)
```

Ecosystem plugins and scanner engines are registered at runtime, making it straightforward to add new package managers (pip, bundler, etc.) or scanning engines without touching the core orchestrator.

---

## Security

### SEC-004 — Validation command execution

`validationCommands` and advisor commands from `security-scan.config.json` are now executed **inside the ecosystem's Docker container** (node, php, python) via `sh -c`, not on the host. This means:

- `jest --coverage`, `php artisan test`, `pytest` — run inside the project's pinned runtime container
- Only commands starting with `git`, `gh`, or `open` are exempted and run on the host

**Trust boundary:** these strings are authored by the repository owner (same person who checks in `security-scan.config.json`), not by external sources. Variable data (package names, versions, CVE ids) is never interpolated into validation command strings.

> If you use `security-scan` in a context where `security-scan.config.json` is written by untrusted parties, treat those command strings as untrusted input and review them before running the tool.

---

## License

MIT
