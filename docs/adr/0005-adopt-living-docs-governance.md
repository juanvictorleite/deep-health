---
type: ADR
title: Adopt living-docs governance (strict) and reorganize the docs bundle as OKF
description: Adopt the living-docs system — OKF frontmatter, per-directory indexes, constitution, strict doc trail — and reorganize docs/ accordingly.
status: Accepted
supersedes:
superseded_by:
tags: [docs, governance]
timestamp: 2026-07-06T00:00:00Z
---

# 0005. Adopt living-docs governance (strict) and reorganize the docs bundle as OKF

## Context

The docs corpus had grown organically: 23 markdown files, none with machine-readable metadata, status markers embedded as body prose, a 1110-line `docs/architecture.md` monolith mixing ~14 views, domain vocabulary in a root-level `CONTEXT.md` unreachable from any index, research in a dated-subfolder format, duplicated whitelabel guide variants in `docs/pt-br/`, and no instrument to catch orphans, broken links, or silently rewritten decisions. Decisions (ADR 0001–0004) existed but nothing enforced that future structural changes carry theirs.

## Decision

We will govern documentation by the living-docs system with **enforcement: strict** and **doc language: English** (pt-br user guides kept as indexed translations), persisted in `CLAUDE.MD`:

- Every concept doc carries OKF frontmatter with a non-empty `type`; `status`/`supersedes`/`superseded_by` live in frontmatter, never body lines.
- Every directory carries an `index.md` listing; the bundle root is `docs/index.md` (`okf_version: "0.1"`); no orphan docs.
- Decisions are append-only: supersede, never rewrite.
- The doc trail (constitution → PRD → ADR/BDR → issues → code) is mandatory: a structural change without its ADR, or a behavioral change without its BDR, is an incomplete task.
- The mechanical invariants are enforced by the vendored instrument `scripts/lint-docs.sh` (`npm run docs:lint`).

The bundle is reorganized accordingly: `CONTEXT.md` → `docs/context/` group files; `docs/architecture.md` → `docs/architecture/` one-view-per-file; research → single-file `docs/research/NNNN-slug.md`; technical references → `docs/reference/`; the executed plan doc → `docs/issues/0001-…`; duplicated `-security-scan` guide variants removed (the template is the single source; brand variants are generated on demand, not versioned).

## Consequences

**Easier / gained:**

- A newcomer (or agent) reaches every doc from `docs/index.md`; drift is caught mechanically by `docs:lint` instead of by accident.
- Decision history becomes trustworthy: superseded records stay intact and point forward.
- The context vocabulary and architecture views are load-bearing for reviews and future ADRs.

**Harder / accepted trade-offs:**

- Every structural/behavioral change now carries doc work in the same change — deliberate friction.
- Old inbound links to moved files (`docs/cli-reference.md` et al.) break outside the repo; accepted, since the only code-referenced paths (`docs/adr/0004-…`, `docs/pt-br/quick-start.template.md`) were kept stable.
- OKF is a thin dependency: a future format break only re-pins the format, not the governance.

**Follow-ups:**

- Wire `npm run docs:lint` into CI (`bitbucket-pipelines.yml`) so a docs violation fails the pipeline.
- Record future architecture-improvement decisions (the deepening work this repo already practices in `docs/architecture/` reviews) as ADRs under this governance.

## Verification

**Implementation impact:** the whole `docs/` bundle, `CLAUDE.MD`, `README.md`, `scripts/lint-docs.sh`, `scripts/gen-index.sh`, `package.json`.

**Verification criteria:**

- `npm run docs:lint` exits 0 — frontmatter/`type`, index membership + root reachability, link resolution, supersede integrity (the fitness function for this decision).
- `CLAUDE.MD` carries the `## Living Docs` block with `enforcement: strict`.
