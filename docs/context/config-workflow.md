---
type: Context
title: Config & workflow vocabulary
description: Canonical terms for project configuration, runners config, kill switch, and the git/PR workflow.
tags: [context, config, workflow]
timestamp: 2026-07-06T00:00:00Z
---

# Config & Workflow

**Project Config** — `security-scan.config.json`. Loaded and validated by `src/infrastructure/config/loader.ts`.

**Config Version** — `config_version: '1'`. Future incompatible schema changes bump this.

**Runners Config** — per-ecosystem Docker runner settings declared inline as `ecosystems[].runner` in the project config. Separated from `scanners` (which retains OSV and SonarQube engine config). Each runner entry carries `language_version`, `native_deps`, and an optional `build` block with shape `{ dockerfile?, context?, target?, args?, allow_context_escape? }`. Multiple ecosystems sharing the same `build` tuple (dockerfile + context + target + args) receive the same image tag automatically (image deduplication). Loader emits a migration error if the old `scanners.npm/pip/composer` keys are detected.

**Language Version** — field `ecosystems[].runner.language_version` (renamed from `runtime_version`). Version hint used by the ephemeral image resolver to select the appropriate Node/Python/PHP base image (e.g. `"20"`, `"3.11"`, `"8.2"`). Canonical runtime hint for npm container execution; also used by pip and composer resolvers.

**Kill Switch** — `SECURITY_SCAN_NO_AUTO_FIX` env var. When set, the orchestrator runs the scan but skips all automated fixes and writes no files.

**Git/PR Workflow** — `--create-branch` + optional `--open-pr` orchestrate a branch creation, fix run, commit, push, and `gh pr create`. Lives in `src/infrastructure/utils/git-commit.ts`.
