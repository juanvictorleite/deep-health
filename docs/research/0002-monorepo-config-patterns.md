---
type: Research
title: Monorepo vs single-repo configuration patterns in security scanning tools
description: Industry survey of monorepo config models — auto-discovery, single root config, CLI targeting, output-layer report separation.
tags: [research, monorepo, config]
timestamp: 2026-05-26T00:00:00Z
---

# Research: How security scanning tools handle monorepo vs single-repo configuration

**Date:** 2026-05-26
**Query angles:** "Snyk monorepo CLI auto-detect projects", "Renovate monorepo config auto-discovery extends preset", "Dependabot.yml monorepo multiple directories", "osv-scanner monorepo recursive config per project", "Trivy monorepo filesystem scan", "security scanning tools monorepo best practices config per project vs single config", "npm/pnpm audit workspaces monorepo", "Turborepo Nx per-project config shared defaults inheritance", "Socket.dev monorepo scanning"
**Sources reviewed:** 24

## Summary

The industry has converged on a clear pattern: **auto-discovery with zero config as the default, single root config for customization, and CLI flags for targeting sub-projects**. No major tool requires per-project config files for monorepo support. The dominant model is recursive scanning from root with per-directory overrides only when needed (OSV-Scanner) or directory-scoped entries in a single config (Dependabot, current security-scan approach). Report separation is handled at the output layer (JSON grouping by source path), not at the config layer.

## Findings

### 1. Auto-discovery is universal — no tool requires manual project listing

Every tool researched discovers projects automatically by walking the directory tree looking for lockfiles/manifests. None requires an index file or manual project registry.

| Tool | Discovery mechanism | Default depth |
|---|---|---|
| Snyk | `--all-projects` walks for manifests | 4 levels (configurable via `--detection-depth`) |
| Renovate | Manager-specific `managerFilePatterns` (regex/glob) | Entire repo |
| Dependabot | Explicit `directory`/`directories` in config | N/A (explicit) |
| OSV-Scanner | `--recursive` flag walks for lockfiles | Unlimited (respects `.gitignore`) |
| Trivy | `trivy fs .` walks for lockfiles | Entire directory tree |
| Socket.dev | Walks for manifest files, respects `.gitignore` | Recursive |
| npm/pnpm | Workspace-aware via `workspaces` in `package.json` / `pnpm-workspace.yaml` | Workspace config |

**Confidence:** high
**Sources:** [Snyk DeepWiki](https://deepwiki.com/snyk/cli/5.2-dependency-detection), [OSV-Scanner Configuration](https://google.github.io/osv-scanner/configuration/), [Trivy Filesystem](https://trivy.dev/docs/latest/guide/target/filesystem/), [Renovate Config Overview](https://docs.renovatebot.com/config-overview/)

### 2. Single root config is the dominant pattern — NOT per-project configs

No security scanning tool uses a per-project config file model for monorepos. The universal pattern is ONE config at the root with directory-scoped entries.

| Tool | Config model |
|---|---|
| **Dependabot** | Single `.github/dependabot.yml` with `directory` or `directories` per entry |
| **Renovate** | Single `renovate.json` at repo root; `packageRules` with `matchPaths` for per-directory overrides |
| **Snyk** | Single `.snyk` policy file at root; `--policy-path` to apply to all projects |
| **OSV-Scanner** | Per-directory `osv-scanner.toml` BUT only for vulnerability ignores — not project config |
| **Socket.dev** | Single `socket.yml` at repo root; `projectIgnorePaths`/`triggerPaths` for scoping |
| **Trivy** | Single `trivy.yaml` at root; CLI flags for path targeting |

The OSV-Scanner per-directory model is the closest to "per-project config" but its scope is narrow: only `IgnoredVulns` and `PackageOverrides` — not project metadata, runner config, or report settings.

**Confidence:** high
**Sources:** [Dependabot multi-directory](https://github.blog/changelog/2024-04-29-dependabot-multi-directory-configuration-public-beta-now-available/), [Socket.dev socket.yml](https://docs.socket.dev/docs/socket-yml), [Renovate Config Overview](https://docs.renovatebot.com/config-overview/), [OSV-Scanner Configuration](https://google.github.io/osv-scanner/configuration/)

### 3. Dependabot's directory model is the closest analog to security-scan's current approach

Dependabot's config is structurally identical to security-scan's current `ecosystems[]` with `path`:

```yaml
# Dependabot
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/packages/frontend"
    schedule:
      interval: "weekly"
  - package-ecosystem: "npm"
    directory: "/packages/api"
    schedule:
      interval: "weekly"
  - package-ecosystem: "composer"
    directory: "/services/legacy"
    schedule:
      interval: "monthly"
```

The new `directories` key (public beta, 2024) reduces duplication when multiple directories share the same ecosystem + settings:

```yaml
- package-ecosystem: "npm"
  directories:
    - "/packages/*"
    - "/apps/*"
  schedule:
    interval: "weekly"
```

Glob support (`*`) was added for the `directories` key — `directory` (singular) does not support globs.

**Confidence:** high
**Sources:** [Dependabot multi-directory changelog](https://github.blog/changelog/2024-04-29-dependabot-multi-directory-configuration-public-beta-now-available/), [Using Dependabot with monorepo](https://www.csrhymes.com/2022/03/03/using-github-dependabot-with-a-monorepo.html)

### 4. Report separation is handled at the output layer, not the config layer

No tool generates per-project reports from per-project config files. Instead:

- **OSV-Scanner JSON output** groups results by `source.path` — each lockfile gets its own result block with `{"source": {"path": "packages/api/package-lock.json", "type": "lockfile"}, "packages": [...]}`
- **Snyk** generates per-project results in `--all-projects` mode, each identified by manifest path. Per-project HTML reports require the community wrapper `snyk-scan.sh` which runs snyk N times.
- **Trivy** outputs a single consolidated report; per-project separation requires running trivy multiple times with different paths.
- **Socket.dev** uses `--workspace-name` to tag scans for different sub-projects, organizing results under distinct workspace names in their dashboard.

**Key insight:** The tools that do per-project reports (Snyk, Socket) achieve it by **running the scan once and splitting output by source path** — not by having separate config files.

**Confidence:** high
**Sources:** [OSV-Scanner Output](https://google.github.io/osv-scanner/output/), [Snyk --all-projects](https://docs.snyk.io/snyk-cli/commands/test), [Socket.dev scan](https://docs.socket.dev/docs/socket-scan)

### 5. CLI targeting (not config) is how users select sub-projects

Every tool uses CLI flags — not config file changes — to target specific sub-projects:

```bash
# Snyk — target specific file
snyk test --file=packages/api/package-lock.json

# Snyk — scan all, exclude some
snyk test --all-projects --exclude=legacy,docs

# OSV-Scanner — target specific lockfile
osv-scanner scan source --lockfile=packages/api/package-lock.json

# OSV-Scanner — scan specific directory
osv-scanner scan source -r packages/api/

# Trivy — target specific directory
trivy fs packages/api/

# Socket.dev — target sub-path with workspace name
socket scan create --sub-path=packages/api --workspace-name=api

# pnpm — filter to specific workspace
pnpm --filter=@myorg/api audit
```

**Confidence:** high
**Sources:** [Snyk CLI test](https://docs.snyk.io/snyk-cli/commands/test), [OSV-Scanner Usage](https://google.github.io/osv-scanner/usage/), [pnpm audit](https://pnpm.io/cli/audit)

### 6. Nx's two-tier model (nx.json + project.json) is the gold standard for config inheritance in monorepos

Nx implements the clearest shared-defaults + per-project-overrides pattern:

- **`nx.json`** (root): defines `targetDefaults` — shared settings for all projects
- **`project.json`** (per-project): overrides only what differs

Merge order (highest priority wins):
1. Project-level config (`project.json`)
2. Global `targetDefaults` (`nx.json`)
3. Inferred defaults (plugins)

Key design principles:
- "Define most common settings centrally; only exceptions override locally"
- Project-level `dependsOn` **replaces** (not merges) global defaults
- `namedInputs` **do merge** between levels
- `nx show project <name>` shows the final merged config with source attribution

**Confidence:** high
**Sources:** [Nx Project Configuration](https://nx.dev/docs/reference/project-configuration), [Nx Types of Configuration](https://nx.dev/docs/concepts/types-of-configuration), [Nx Reduce Repetitive Config](https://nx.dev/recipes/running-tasks/reduce-repetitive-configuration)

### 7. Renovate's extends/presets pattern enables org-wide shared config without duplication

Renovate's inheritance model:
- `extends: ["config:recommended"]` pulls in a preset
- Presets can be hosted in repos: `extends: ["github>myorg/renovate-config"]`
- Organization defaults auto-discovered from `{{parentOrg}}/renovate-config/default.json`
- `inheritConfig: true` enables org-level defaults that repos cannot ignore
- Per-directory overrides via `packageRules` with `matchPaths`

This is the most sophisticated config inheritance model in the space, but it's designed for a bot managing hundreds of repos — different scale than a CLI tool.

**Confidence:** high
**Sources:** [Renovate Config Presets](https://docs.renovatebot.com/config-presets/), [Renovate Config Overview](https://docs.renovatebot.com/config-overview/)

### 8. pnpm audit demonstrates workspace-native security scanning

pnpm v11 handles monorepo audit natively:
- Single lockfile (`pnpm-lock.yaml`) covers all workspaces
- `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` for suppressing known issues
- `--fix=update` fixes by updating lockfile (not adding overrides)
- Filtering: `pnpm --filter=@myorg/api audit` targets specific workspace

The workspace-native model works because pnpm already knows the dependency graph. This is the simplest UX but only applies to single-ecosystem (npm) monorepos.

**Confidence:** medium
**Sources:** [pnpm audit](https://pnpm.io/cli/audit), [pnpm audit fix UX](https://github.com/pnpm/pnpm/issues/11163)

## Contradictions

### Monorepo config: flat-list vs inheritance

Dependabot uses a flat list of directory entries (no inheritance, no shared defaults between entries). Nx uses a two-tier model with explicit inheritance. Renovate uses presets with `extends`. These are not contradictions per se but different design philosophies:

- **Flat-list** (Dependabot): simplest mental model, but duplicates settings across entries
- **Two-tier** (Nx): reduces duplication, clear override semantics, but more complex
- **Presets** (Renovate): maximum reuse across repos, but overkill for single-repo CLI

For a CLI tool operating on a single repo, the Nx two-tier model (root defaults + per-project overrides) is the most relevant pattern.

### Per-directory config: OSV-Scanner vs everyone else

OSV-Scanner is the only tool that uses per-directory config files (`osv-scanner.toml`). All others use a single root config. However, OSV-Scanner's per-directory config is very narrow in scope (only vulnerability ignores/overrides) — project metadata and scan settings are global.

## Analysis

The evidence strongly suggests that **an index file (`security-scan.index.json`) is an anti-pattern** in this space. No tool uses one. The reasons:

1. **Index files get out of sync** — adding a new project means remembering to update the index. Auto-discovery eliminates this failure mode entirely.
2. **Users expect zero-config monorepo support** — Snyk's `--all-projects`, OSV-Scanner's `--recursive`, and Trivy's `trivy fs .` all "just work" without any monorepo-specific config.
3. **Report separation is an output concern, not a config concern** — splitting reports per-project should happen at the rendering layer (group by source path) not by having separate config files that each generate their own report.

The most successful pattern across tools is:

```
Discovery:  Auto-detect lockfiles recursively (zero config)
Config:     Single root config with per-directory entries when needed
Targeting:  CLI flags to run on specific sub-projects
Reports:    Output grouped by source path; optionally split per-project
```

## Recommendations

### For security-scan's monorepo architecture:

1. **Keep the single centralized config** — the current `ecosystems[].path` + `label` model is aligned with industry patterns (identical to Dependabot's `directory` model). Do NOT add per-project config files or an index file.

2. **Add auto-discovery as the default mode** — `security-scan init` should discover lockfiles recursively (the `discoverProject()` function already does this) and generate `ecosystems[]` entries automatically. Running `security-scan fix` without config should auto-discover and scan, like Snyk's `--all-projects`.

3. **Add CLI targeting for sub-projects** — instead of per-project configs, add `--project` or `--path` flags:
   ```bash
   security-scan fix                           # all ecosystems
   security-scan fix --project frontend        # by label
   security-scan fix --path packages/api       # by path
   ```

4. **Separate reports at the output layer** — group report data by ecosystem entry (path + label). Add `--split-reports` or `--per-project-reports` flag to generate individual reports per ecosystem entry:
   ```bash
   security-scan report                        # consolidated
   security-scan report --split                # one report per ecosystem entry
   security-scan report --project frontend     # report for specific project
   ```

5. **Consider Dependabot-style glob patterns** for `ecosystems[].path` to reduce config verbosity in large monorepos:
   ```json
   { "id": "npm", "path": "packages/*" }
   ```

6. **Do NOT implement config inheritance (extends)** — this is overkill for a single-repo CLI tool. Renovate's preset model exists because it manages hundreds of repos. Nx's two-tier model exists because it coordinates dozens of build targets. A security CLI operating on one repo with 2-10 ecosystem entries does not need this complexity.

---

# References

| # | Title | URL | Accessed | Type | Relevance |
|---|---|---|---|---|---|
| 1 | Multi-Project and Workspace Support - Snyk CLI DeepWiki | https://deepwiki.com/snyk/cli/5.2-dependency-detection | 2026-05-26 | docs | high |
| 2 | OSV-Scanner Configuration | https://google.github.io/osv-scanner/configuration/ | 2026-05-26 | official | high |
| 3 | OSV-Scanner Output Formats | https://google.github.io/osv-scanner/output/ | 2026-05-26 | official | high |
| 4 | Trivy Filesystem Scanning | https://trivy.dev/docs/latest/guide/target/filesystem/ | 2026-05-26 | official | medium |
| 5 | Renovate Configuration Overview | https://docs.renovatebot.com/config-overview/ | 2026-05-26 | official | high |
| 6 | Renovate Configuration Options | https://docs.renovatebot.com/configuration-options/ | 2026-05-26 | official | medium |
| 7 | Renovate Shareable Config Presets | https://docs.renovatebot.com/config-presets/ | 2026-05-26 | official | medium |
| 8 | Dependabot Multi-Directory Configuration Beta | https://github.blog/changelog/2024-04-29-dependabot-multi-directory-configuration-public-beta-now-available/ | 2026-05-26 | official | high |
| 9 | Using GitHub Dependabot with a Monorepo | https://www.csrhymes.com/2022/03/03/using-github-dependabot-with-a-monorepo.html | 2026-05-26 | blog | medium |
| 10 | Snyk CLI test command docs | https://docs.snyk.io/snyk-cli/commands/test | 2026-05-26 | official | high |
| 11 | Snyk CLI monitor command docs | https://docs.snyk.io/developer-tools/snyk-cli/commands/monitor | 2026-05-26 | official | medium |
| 12 | Snyk monorepo support FAQ | https://support.snyk.io/hc/en-us/articles/360000910577 | 2026-05-26 | official | high |
| 13 | snyk-scan.sh monorepo wrapper | https://github.com/snyk-labs/snyk-scan.sh | 2026-05-26 | discussion | medium |
| 14 | Socket.dev socket.yml docs | https://docs.socket.dev/docs/socket-yml | 2026-05-26 | official | high |
| 15 | Socket.dev socket scan command | https://docs.socket.dev/docs/socket-scan | 2026-05-26 | official | medium |
| 16 | Socket.dev Python CLI monorepo workspace support | https://socket.dev/changelog/python-cli-monorepo-workspace-support | 2026-05-26 | official | medium |
| 17 | Nx Project Configuration Reference | https://nx.dev/docs/reference/project-configuration | 2026-05-26 | official | high |
| 18 | Nx Types of Configuration | https://nx.dev/docs/concepts/types-of-configuration | 2026-05-26 | official | high |
| 19 | Nx Reduce Repetitive Configuration | https://nx.dev/recipes/running-tasks/reduce-repetitive-configuration | 2026-05-26 | official | medium |
| 20 | pnpm audit CLI docs | https://pnpm.io/cli/audit | 2026-05-26 | official | medium |
| 21 | pnpm audit --fix UX issues | https://github.com/pnpm/pnpm/issues/11163 | 2026-05-26 | discussion | low |
| 22 | Semgrep monorepo scanning in parts | https://semgrep.dev/docs/kb/semgrep-ci/scan-monorepo-in-parts | 2026-05-26 | official | medium |
| 23 | OSV-Scanner V2 announcement | https://security.googleblog.com/2025/03/announcing-osv-scanner-v2-vulnerability.html | 2026-05-26 | official | medium |
| 24 | Monorepo security best practices | https://graphite.com/guides/monorepo-security-sensitive-environments | 2026-05-26 | blog | low |

## Key excerpts

### [1] Snyk CLI DeepWiki — Multi-Project Scanning

> The multi-project scanning system enables Snyk CLI to analyze multiple projects within a single repository (monorepo) in a single command execution. This system automatically detects and processes workspace configurations for npm, yarn, and pnpm, as well as scanning multiple independent projects using the `--all-projects` flag. Default detection depth is 4 directory levels, configurable via `--detection-depth`.

### [2] OSV-Scanner Configuration — Per-Directory Model

> To configure scanning, place an osv-scanner.toml file in the scanned file's directory. This does not propagate to child directories. The --config flag can be used to specify a global config override to apply to all the files you are scanning.

### [8] Dependabot Multi-Directory — directories key

> A new `directories` key is now available in public beta. The `directories` key accepts a list of strings representing directories, and can be used instead of `directory`. Previously, developers with multiple package manifests for the same ecosystem across multiple directories had to create separate dependabot.yml configurations for each of those directories, which could lead to many duplicated configurations and high maintenance costs.

### [5] Renovate Configuration Overview — Hierarchy

> Renovate reads configuration in this precedence order: Default config, Global config, File config, Environment config, CLI config, Inherited config, Resolved presets, Repository config. Higher-numbered items override lower ones; mergeable properties combine instead.

### [17] Nx Project Configuration — Two-Tier Model

> The targetDefaults property allows you to define the most common settings for projects in your repo in one place. Then, only projects that are exceptions need to overwrite those settings. Project-specific configuration is merged into and overwrites global configuration.

### [3] OSV-Scanner Output — JSON grouping by source

> The JSON format groups results hierarchically by source files. Results are organized as: "results": [{"source": {...}, "packages": [...]}]. Each result object contains source metadata including file path and type, plus an array of vulnerable packages from that source.
