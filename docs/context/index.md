# Context

Domain vocabulary for `osv-security-cli` (security-scan), semantically grouped. Terms here should be used consistently across code, comments, commits, PRs, and architectural discussion.

When a new domain concept stabilizes during design work, add it to the matching group file. When a term gets sharpened, update the entry rather than creating synonyms. New terms or acronyms get a one-line definition in the [glossary](glossary.md).

## Groups

| File | Covers |
|---|---|
| [pipeline.md](pipeline.md) | Orchestrator, per-ecosystem fix flow, phases, Gate A, ecosystem gate |
| [ecosystem.md](ecosystem.md) | Plugins, fixer strategies, updaters, transaction/lifecycle, probes, update classification |
| [runtime.md](runtime.md) | Ephemeral Docker runtime, run modes, preambles, host routing, project image builds |
| [scanner.md](scanner.md) | Scanner engines, sweep, primary/secondary policy, residual verification |
| [reporting.md](reporting.md) | Executive report, audit trail, report storage |
| [config-workflow.md](config-workflow.md) | Project config, runners config, kill switch, git/PR workflow |
| [glossary.md](glossary.md) | Terms & acronyms, defined once |
