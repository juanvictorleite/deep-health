# Research: How do industry security scanning tools handle the scan-to-fix relationship, and what patterns make config simple for non-expert users?

**Date:** 2026-05-25
**Query angles:** snyk CLI scan vs fix workflow, GitHub Dependabot scan fix pipeline configuration, Renovate vulnerability processing architecture, npm audit fix UX problems, osv-scanner guided remediation fix command, Socket.dev remediation approach, security tools config file simplicity best practices
**Sources reviewed:** 14

## Summary

Industry security tools fall into three architectural patterns for scan-to-fix: (1) **unified command** (npm audit/fix), (2) **sequential pipeline** (Snyk test then fix, osv-scanner scan then fix), and (3) **detection-triggers-remediation** (Dependabot alerts trigger PRs, Renovate alerts generate package rules). The unified approach (npm) is widely criticized for UX failures. The sequential pipeline pattern is the most common and well-regarded. The strongest UX pattern across all tools is: **scan produces actionable recommendations that feed directly into the fix phase, with the user deciding scope, not mechanics**. Tools that separate "what's wrong" from "how to fix it" while maintaining a data bridge between the two are the most successful. Config simplicity correlates strongly with sensible defaults and progressive disclosure.

## Findings

### Finding 1: The "Unified Scan+Fix" pattern (npm audit) is widely considered broken

npm audit's design of combining scan and fix into one conceptual flow has produced a 99%+ false positive rate for frontend tooling, creates security fatigue, and the `--force` flag has been documented destroying production builds. Dan Abramov's analysis argues the core problem is context blindness: treating dev dependencies with the same risk profile as production code. Multiple engineering teams have published "don't use npm audit fix" guidance.

**Confidence:** high
**Sources:** [npm audit: Broken by Design (overreacted.io)](https://overreacted.io/npm-audit-broken-by-design/), [Why npm audit fix --force is a Terrible Idea](https://medium.com/@instatunnel/why-npm-audit-fix-force-is-a-terrible-idea-052ac56a3ae2), [Don't use npm audit fix (Insider Engineering)](https://medium.com/insiderengineering/dont-use-npm-audit-fix-063219b3cefc)

### Finding 2: The "Sequential Pipeline" pattern (Snyk, osv-scanner) is the industry standard

Both Snyk and osv-scanner use a two-phase approach: scan first (`snyk test` / `osv-scanner scan`), then fix (`snyk fix` / `osv-scanner fix`). Critically, the scan phase produces structured output with fix recommendations that the fix phase consumes. In Snyk, `snyk test` identifies vulnerabilities AND shows recommended upgrades; `snyk fix` then applies those recommendations. In osv-scanner, `scan` identifies vulnerabilities; `fix` analyzes the transitive graph to determine minimal changes and presents them interactively or applies them headlessly.

The key design insight: **the scan phase does the analysis work (what's wrong AND what would fix it), while the fix phase handles the mechanics (applying changes safely)**. This separation of concerns maps directly to the advisor/fixer architecture in osv-security-cli.

**Confidence:** high
**Sources:** [Snyk Fix: Automatic Vulnerability Remediation](https://snyk.io/blog/snyk-fix-automatic-vulnerability-remediation-snyk-cli/), [OSV-Scanner Guided Remediation](https://google.github.io/osv-scanner/experimental/guided-remediation/), [Snyk Vulnerability Fix Types](https://docs.snyk.io/scan-with-snyk/snyk-open-source/manage-vulnerabilities/vulnerability-fix-types)

### Finding 3: "Detection-triggers-remediation" pattern (Dependabot, Renovate) separates concerns most cleanly

Dependabot and Renovate both treat vulnerability detection and fix creation as fundamentally different systems connected by a data bridge. Dependabot: alerts are raised from advisory databases, then a separate system checks if an upgrade path exists and creates a PR. Renovate: a two-stage pipeline (GitHub alerts + OSV queries) generates `PackageRule` objects with `isVulnerabilityAlert: true` that feed into the standard dependency processing pipeline. The user never interacts with the detection layer directly; they only see the PR output.

Renovate's architecture is notable: vulnerability data from two sources gets normalized into the same `PackageRule` format, then the existing update machinery handles the rest. This is the cleanest example of "scan findings feeding into the fix layer" in the industry.

**Confidence:** high
**Sources:** [GitHub Docs: Dependabot Security Updates](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates), [Renovate Vulnerability Processing (DeepWiki)](https://deepwiki.com/renovatebot/renovate/6.3-vulnerability-processing), [Renovate Security Presets](https://docs.renovatebot.com/presets-security/)

### Finding 4: osv-scanner's `fix` command has the most relevant architecture for this project

osv-scanner V2 organizes around `scan` and `fix` subcommands. The `fix` command:
- Receives vulnerability data from the scan phase
- Analyzes the transitive dependency graph (via deps.dev API)
- Offers three strategies: in-place lockfile changes, relax+relock, and Maven overrides
- Has both interactive (TUI) and non-interactive modes
- Prioritizes patches by "total number of transitive vulnerabilities fixed"
- Lets users filter by CVSS severity, dependency depth, and dev-only status
- Controls upgrade scope via `--upgrade-config` (major/minor/patch/none)

Key UX decision: the interactive mode presents a "what should we fix?" filtering screen before showing fix options, letting non-expert users narrow scope before seeing complexity.

**Confidence:** high
**Sources:** [OSV-Scanner Guided Remediation](https://google.github.io/osv-scanner/experimental/guided-remediation/), [Announcing Guided Remediation](https://osv.dev/blog/posts/announcing-guided-remediation-in-osv-scanner/), [OSV-Scanner V2 Announcement](https://blog.google/security/announcing-osv-scanner-v2-vulnerability/)

### Finding 5: Trivy is scan-only; Socket.dev focuses on prevention, not remediation

Trivy excels at detection but has no fix command. Remediation is manual or externally automated. Socket.dev takes an entirely different approach: it prevents malicious packages from entering the codebase via behavioral analysis rather than fixing known CVEs. Socket's `socket optimize` command suggests safer replacement packages, but it's not a fix in the traditional sense.

Neither tool provides a meaningful scan-to-fix pipeline, confirming that the scan+fix pattern is primarily found in dependency-update tools (Snyk, osv-scanner, Dependabot, Renovate, npm audit).

**Confidence:** high
**Sources:** [Trivy Vulnerability Scanner](https://trivy.dev/docs/latest/scanner/vulnerability/), [Socket.dev Overview](https://socket.dev/), [Socket Review 2026](https://appsecsanta.com/socket)

### Finding 6: Config simplicity correlates with sensible defaults and progressive disclosure

Across all tools studied:
- **Dependabot**: `dependabot.yml` is minimal (ecosystem + schedule). Works with zero config for security updates.
- **Renovate**: complex but uses presets (`config:recommended`, `security:onlySecurityUpdates`) to hide complexity.
- **Snyk**: zero-config CLI. `snyk test` works out of the box.
- **osv-scanner**: uses `osv-scanner.toml` for scan config but `fix` command does NOT use this file (uses CLI flags only).
- **npm audit**: zero-config, works immediately.

The pattern: **tools that work well for non-experts either require zero config (npm, Snyk) or use preset-based progressive disclosure (Renovate)**. Complex config files (like Renovate's full `renovate.json`) are for power users.

**Confidence:** high
**Sources:** [Dependabot Quickstart Guide](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/dependabot-quickstart-guide), [Renovate Docs: Security Presets](https://docs.renovatebot.com/presets-security/), [OSV-Scanner Usage](https://google.github.io/osv-scanner/usage/)

### Finding 7: The strongest UX pattern is "show the fix, not just the problem"

Snyk's design philosophy is described as: "showing the fix instead of just the problem changes the entire dynamic between security and development teams." This is echoed across tools:
- Snyk shows "Fixed in: version X" next to each vulnerability
- osv-scanner's interactive mode shows which patches fix the most vulnerabilities
- Dependabot creates ready-to-merge PRs, not reports
- Renovate generates PRs with CVE links, CVSS scores, and advisory details in the body

Tools that only report problems (Trivy, raw npm audit) leave users stranded. Tools that show actionable next steps (Snyk, osv-scanner fix, Dependabot, Renovate) are more successful with non-expert users.

**Confidence:** high
**Sources:** [Snyk 2026 Guide](https://aitoolsdevpro.com/ai-tools/snyk-guide/), [Aikido: NPM Security Audit](https://www.aikido.dev/blog/npm-audit-guide), [Announcing Guided Remediation](https://osv.dev/blog/posts/announcing-guided-remediation-in-osv-scanner/)

## Contradictions

### npm audit fix: automation vs. manual remediation

npm audit fix was designed to automate remediation, but multiple expert sources (Dan Abramov, Insider Engineering, cyberdesserts.com) argue this automation does more harm than good. The contradiction is between npm's "one command fixes everything" philosophy and the industry consensus that informed, contextual remediation is safer. Resolution: the problem is not automation per se, but automation without context awareness (dev vs. prod, build-time vs. runtime, CVSS context).

### Snyk fix scope

Snyk markets `snyk fix` as automatic remediation, but as of 2026 it remains in beta and limited to Python (Pip/Pipenv/Poetry) for CLI-based fixes. The broader ecosystem fix support comes through SCM-based auto-PRs, not the CLI. This creates a gap between marketing messaging and actual CLI capability.

## Analysis

The industry has converged on a clear pattern: **scan and fix are separate operations connected by structured data**. The tools that merge them (npm audit fix) are criticized; the tools that separate them cleanly (Snyk, osv-scanner, Dependabot, Renovate) are praised.

For osv-security-cli, the current advisor/fixer separation maps well to this industry pattern. The advisor is analogous to the scan phase, the fixer to the fix phase. The missing piece — which the user identified — is the **data bridge**: advisor findings should flow into fixer decisions, just as Snyk's test findings flow into its fix command, and Renovate's alert findings flow into its package rules.

The most relevant model is **Renovate's PackageRule normalization**: vulnerability data from multiple sources gets normalized into a common format that the existing update machinery consumes. This is architecturally similar to what "Option A" (advisor findings feeding into fixer) would accomplish.

For config simplicity: the strongest pattern is **zero-config defaults with opt-in complexity**. Dependabot's `dependabot.yml` and Renovate's presets show that users should be able to get value with minimal or no configuration, with power-user options available but not required.

## Recommendations

1. **Keep advisor and fixer as separate concepts** but add a structured data bridge (Option A). This aligns with the industry consensus: Snyk, osv-scanner, Dependabot, and Renovate all separate scan from fix while connecting them through data.

2. **Make advisor findings actionable by default.** Following Snyk's "show the fix, not just the problem" philosophy, advisor results should include what can be fixed and how, not just what's wrong. The `fixAvailable` field in `AdvisorFinding` already exists — ensure it's populated and used.

3. **Consider Renovate's normalization pattern** for the data bridge: advisor findings get normalized into a format the fixer can consume, similar to how Renovate converts alerts into `PackageRule` objects.

4. **For config simplicity: sensible defaults, progressive disclosure.** The config should work with minimal fields (ecosystem + project path). Advanced options (fixer strategy, advisor overrides, validation commands) should have good defaults. Consider Renovate-style presets if the config grows complex.

5. **Do NOT merge advisor and fixer into one concept.** npm audit's unified approach is the cautionary tale. The separation of "what's wrong" from "how to fix it" is a feature, not a limitation.

6. **For non-expert users: emphasize decision support over automation.** osv-scanner's interactive mode and Snyk's "Fixed in" annotations are good models. Users should understand what will happen before it happens, with clear risk signals (severity, breaking change potential, dev vs. prod context).

---

## Implementation Status (updated 2026-05-25)

The advisor→fixer data bridge described in recommendation 1 is now **implemented for npm** (not just Composer).

**What was built:** `npm-updater.ts` now provides a `deriveAuditFindings` hook in its `UpdaterRecipe`. The hook is invoked by `runUpdaterLifecycle` after `derivePackagesUpdated` and its result flows to `UpdateResultJson.audit_findings`. This gives npm the same `audit_findings` reporting fidelity that Composer already had via `fixerResult.auditAdvisories`.

**The bridge mechanism:** The `advisorFindings` field in `FixerCallOptions` was the planned conduit. Rather than consuming it inside the fixer, the npm updater consumes it in `deriveAuditFindings` — a cleaner separation because the fixer handles mechanics (what was actually patched on disk) and the hook handles reporting enrichment (what additional context the advisor provides). The hook cross-references `advisorFindings` with `fixerResult.packagesUpdated`, excluding packages already known to the OSV scan (`scanResult.ecosystems.npm.vulnerabilities`) so only truly additional findings are surfaced.

**Analogy to Renovate's PackageRule normalization:** vulnerability data from the npm advisor (a secondary scan) is normalized into `AuditFinding[]` — the same format Composer uses — so the executive report's injection logic is ecosystem-agnostic. This is architecturally equivalent to Renovate converting alerts into `PackageRule` objects for processing by the existing update machinery.

**Scope:** the change is contained entirely in `src/modules/ecosystem/plugins/npm-updater.ts`. No changes to `updater-lifecycle.ts`, `updater-transaction.ts`, the fixer implementations, or any other file.
