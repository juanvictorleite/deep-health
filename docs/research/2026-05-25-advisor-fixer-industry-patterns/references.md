# References

| # | Title | URL | Accessed | Type | Relevance |
|---|---|---|---|---|---|
| 1 | npm audit: Broken by Design (Dan Abramov) | https://overreacted.io/npm-audit-broken-by-design/ | 2026-05-25 | blog | high |
| 2 | Snyk Fix: Automatic Vulnerability Remediation from the Snyk CLI | https://snyk.io/blog/snyk-fix-automatic-vulnerability-remediation-snyk-cli/ | 2026-05-25 | blog | high |
| 3 | OSV-Scanner Guided Remediation | https://google.github.io/osv-scanner/experimental/guided-remediation/ | 2026-05-25 | docs | high |
| 4 | Vulnerability Fix Types - Snyk Docs | https://docs.snyk.io/scan-with-snyk/snyk-open-source/manage-vulnerabilities/vulnerability-fix-types | 2026-05-25 | official | high |
| 5 | About Dependabot Security Updates - GitHub Docs | https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates | 2026-05-25 | official | high |
| 6 | Renovate Vulnerability Processing (DeepWiki) | https://deepwiki.com/renovatebot/renovate/6.3-vulnerability-processing | 2026-05-25 | docs | high |
| 7 | Renovate Security Presets | https://docs.renovatebot.com/presets-security/ | 2026-05-25 | docs | medium |
| 8 | Announcing Guided Remediation in OSV-Scanner | https://osv.dev/blog/posts/announcing-guided-remediation-in-osv-scanner/ | 2026-05-25 | official | high |
| 9 | OSV-Scanner V2 Announcement (Google Blog) | https://blog.google/security/announcing-osv-scanner-v2-vulnerability/ | 2026-05-25 | official | medium |
| 10 | Why npm audit fix --force is a Terrible Idea | https://medium.com/@instatunnel/why-npm-audit-fix-force-is-a-terrible-idea-052ac56a3ae2 | 2026-05-25 | blog | medium |
| 11 | Don't use npm audit fix (Insider Engineering) | https://medium.com/insiderengineering/dont-use-npm-audit-fix-063219b3cefc | 2026-05-25 | blog | medium |
| 12 | Socket.dev Review 2026 | https://appsecsanta.com/socket | 2026-05-25 | blog | medium |
| 13 | Trivy Vulnerability Scanner Docs | https://trivy.dev/docs/latest/scanner/vulnerability/ | 2026-05-25 | docs | medium |
| 14 | Dependabot Quickstart Guide - GitHub Docs | https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/dependabot-quickstart-guide | 2026-05-25 | official | medium |

## Key excerpts

### [1] npm audit: Broken by Design (Dan Abramov)

> npm added a default behavior that, in many situations, leads to a 99%+ false positive rate, creates an incredibly confusing first programming experience, makes people fight with security departments, and makes maintainers never want to deal with the Node.js ecosystem ever again. It will make users miserable because we have trained an entire generation of developers to simply ignore them.

### [2] Snyk Fix: Automatic Vulnerability Remediation

> The new snyk fix command takes this up a notch by automatically applying these recommendations. This can be particularly useful for a developer looking to apply fixes quickly, as part of their local development workflow, or for those looking to automate fixing as part of their CI/CD.

### [3] OSV-Scanner Guided Remediation

> Guided remediation aims to help developers with fixing the high number of known vulnerabilities in dependencies typically reported by vulnerability scanners by providing a small number of actionable steps. This includes resolution and analysis of the entire transitive graph (leveraging deps.dev) to determine the minimal changes required to remove vulnerabilities.

### [6] Renovate Vulnerability Processing (DeepWiki)

> Both stages generate PackageRule objects with isVulnerabilityAlert: true and force configuration that overrides normal update behavior to prioritize security fixes. GitHub alerts are fetched via GraphQL and validated against a Zod schema supporting nine ecosystems. Multiple alerts for the same dependency are consolidated into a single rule by grouping on ecosystem and package name.

### [8] Announcing Guided Remediation in OSV-Scanner

> Prioritising direct dependency upgrades by the total number of transitive vulnerabilities fixed. Prioritising vulnerabilities by dependency depth, severity, and whether to care about dev-only dependencies.
