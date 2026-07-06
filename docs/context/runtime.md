---
type: Context
title: Runtime vocabulary
description: Canonical terms for the ephemeral Docker runtime — runtime specs, run modes, preambles, host routing, project image builds.
tags: [context, runtime, docker]
timestamp: 2026-07-06T00:00:00Z
---

# Runtime

**Ecosystem Runtime Container** — the seam through which a plugin's CLI runs in an ephemeral Docker container. Owns image resolution, argv shaping, host vs container routing, retry on transient Docker errors, and streaming. Lives in `src/infrastructure/ecosystem-runtime/`.

**EcosystemRuntimeSpec** — declarative struct on a plugin describing how its CLI runs in a container: default image, image resolver, recognized binaries, run mode.

**Ephemeral Ecosystem Container** — implementation behind the runtime seam. One Docker `run --rm` per command, parameterized by an `EcosystemRuntimeSpec`.

**Run Mode** — tagged enum on the spec controlling how argv composes into `docker run`:
  - `direct-exec` — `docker run <image> <binary> <args...>` (no shell). Used by ecosystems whose CLI tolerates direct exec (npm).
  - `shell-wrap` — `docker run <image> sh -lc "<joined args>"` with optional image-conditional preamble. Used by ecosystems that need shell features or on-the-fly bootstrap (pip, composer).

**Run Mode Preamble** — optional function `(image) => string | undefined` carried by either run mode. Returns shell commands to inject before the main command, separated by `&&`. Used by composer to install composer on-the-fly on bare `php:*-cli` images (`shell-wrap`), and by `resolveEcosystemRuntime` to inject `apt-get install` for OS-level native deps when `native_deps` is configured (`direct-exec`). When both a plugin preamble and a `native_deps` preamble are present they are composed: native deps fire first so the plugin's bootstrap has its dependencies available.

**Host-Only Command** — `git`, `gh`, `open`. These never enter the ecosystem container and route to the host runner regardless of which ecosystem is active.

**Host Runner** — the `CommandRunner` (typically `LocalExecutor`) that handles host-only commands. Passed into the container command runner; replaces what the legacy code called `fallback`.

**Build Config** — optional `build` block on a runner (`ecosystems[].runner.build`) that selects how the ecosystem runner image is provisioned from a project-owned Dockerfile. When absent (default), the existing registry-image resolution chain is used (`pull`). When present, delegates to `buildProjectImage()` to build a stable local image. `image` and `build` may coexist — `build` is executed and the result is tagged with the value of `image`. Fields: `dockerfile`, `context`, `target`, `args`, `allow_context_escape`.

**Project Image Build** — `buildProjectImage()` in `src/infrastructure/ecosystem-runtime/build-project-image.ts`. Reads a project-owned Dockerfile, derives a stable local tag via SHA-256 of the combined `(dockerfile path, context, target, args)` tuple — not based on `logPrefix`. Multiple ecosystems sharing the same tuple get the same image tag (deduplication). Probes the local Docker daemon cache (`docker image inspect`) and only rebuilds when the tag is absent. Returns `{ image, entrypointOverride: "" }`. The `entrypointOverride` MUST be forwarded to `EphemeralEcosystemContainer` so `--entrypoint ""` is injected into every `docker run`, preventing the image's ENTRYPOINT from hijacking the ecosystem CLI binary. Emits a warning when the build context exceeds 50 MB. Build happens lazily on first use inside `resolveEcosystemRuntime` — the orchestrator is not modified.
