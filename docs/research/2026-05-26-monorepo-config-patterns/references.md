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
