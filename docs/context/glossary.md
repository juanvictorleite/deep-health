---
type: Context
title: "Glossary"
description: Definitions of the acronyms and cross-cutting terms used across the security-scan docs.
tags: [glossary, vocabulary, context]
timestamp: 2026-07-06T00:00:00Z
---
# Glossary

Single home for the acronyms and cross-cutting terms the docs use. Domain concepts (Orchestrator, Gate A, Updater Transaction, …) are defined once in their [context group files](index.md) — this glossary points there instead of redefining them.

## Acronyms

| Acronym | Expansion | Definition |
|---|---|---|
| ADR | Architecture Decision Record | Append-only record of one architectural decision; lives in [/adr/](/adr/index.md). |
| BDR | Behavior Decision Record | Append-only record of observable behavior (Given/When/Then + test design); lives in [/bdr/](/bdr/index.md). |
| PRD | Product Requirements Document | What the system must do and why, per feature; lives in [/prd/](/prd/index.md). |
| OKF | Open Knowledge Format | The markdown + frontmatter format every doc in this bundle follows. |
| CVE | Common Vulnerabilities and Exposures | Public identifier for a known vulnerability; what scans detect and fixes remediate. |
| OSV | Open Source Vulnerabilities | Google's vulnerability database and scanner; the always-primary engine (see [constitution](/constitution.md)). |
| SEA | Single Executable Application | Node.js packaging used for the distributed binary (`npm run build:sea`). |
| i18n | Internationalization | Locale system for reports and messages (`en`, `pt-br`). |

## Terms

| Term | Definition | See also |
|---|---|---|
| entryKey | Composite key `<id>` or `<id>:<label>` identifying one ecosystem config entry across the whole pipeline. | [Config & Workflow](config-workflow.md), [scanner-system view](/architecture/scanner-system.md) |
| Whitelabel / Brand system | All user-visible names derive from `CLI_NAME` via `src/infrastructure/brand.ts`; docs generated per brand come from templates. | [constitution](/constitution.md) |
| Fitness function | The executable check (test, lint rule, gate) that keeps a measurable decision true; named in an ADR's Consequences. | [/adr/index.md](/adr/index.md) |
| Doc trail | The mandatory chain constitution → PRD → ADR/BDR → issues → code under `enforcement: strict`. | [ADR 0005](/adr/0005-adopt-living-docs-governance.md) |
