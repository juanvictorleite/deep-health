---
type: Architecture View
title: Project discovery (init)
description: discoverProject() lockfile/Dockerfile discovery used by the init command, and the monorepo config shape it generates.
timestamp: 2026-07-06T00:00:00Z
---

# Project Discovery (Init)

`src/infrastructure/utils/detect-ecosystems.ts` provides the `discoverProject()` function used by the `init` command to find all ecosystems and Dockerfiles in a project tree before prompting the user.

## discoverProject()

```ts
async function discoverProject(
  cwd: string,
  plugins: EcosystemPlugin[],
  options?: DiscoverProjectOptions,
): Promise<DiscoveryResult>
```

**How it works:**

- Recursively walks the directory tree rooted at `cwd` using a breadth-limiting depth cap (`maxDepth`, default: `4`).
- At each directory, matches filenames against each plugin's `lockfiles` array (plugin-driven lockfile matching — no hardcoded filenames).
- Also matches any file whose name starts with `'Dockerfile'` (case-sensitive) for Docker image inference.
- Skips the following directories by default: `node_modules`, `vendor`, `.git`, `dist`, `build`, `__pycache__`, `.venv`, `.tox`.
- All returned paths are relative to `cwd`, with no leading `./` or `/`. Root-level discoveries have `path: ''`.

**Return types:**

```ts
interface DiscoveredEcosystem {
  pluginId: string;       // e.g. 'npm', 'composer', 'pip'
  path: string;           // relative dir path; '' = project root
  lockfile: string;       // e.g. 'package-lock.json'
  suggestedLabel?: string; // derived from dir name; undefined for root
}

interface DiscoveredDockerfile {
  path: string;           // relative dir path; '' = project root
  filename: string;       // e.g. 'Dockerfile', 'Dockerfile.prod'
}
```

## Discovery Flowchart

```mermaid
flowchart TD
    INIT([discoverProject called]) --> SETUP

    SETUP["Build WalkContext\n(cwd, maxDepth=4, exclude list, plugins)"]
    SETUP --> WALK

    WALK["walk(ctx, absDir, depth=0)"]
    WALK --> READ_DIR["readdir(absDir, withFileTypes)\n(skip unreadable dirs silently)"]
    READ_DIR --> CLASSIFY

    CLASSIFY["classifyEntries()\nSplit into fileNames Set + subDirs list\n(exclude dirs matching exclude list)"]
    CLASSIFY --> MATCH_PLUGINS

    MATCH_PLUGINS["matchPluginLockfiles()\nFor each plugin: check lockfiles[] against fileNames\nOne match per plugin per directory"]
    MATCH_PLUGINS --> MATCH_DOCKER

    MATCH_DOCKER["matchDockerfiles()\nAny file starting with 'Dockerfile'"]
    MATCH_DOCKER --> DEPTH_CHECK

    DEPTH_CHECK{"depth < maxDepth?"}
    DEPTH_CHECK -- yes --> RECURSE["walk() each subDir\n(Promise.all — parallel)"]
    DEPTH_CHECK -- no --> DONE_DIR([done with this directory])
    RECURSE --> DONE_DIR

    DONE_DIR --> RESULT([return DiscoveryResult\n{ ecosystems[], dockerfiles[] }])
```

## Discovery Summary

When `discoverProject()` finds any ecosystem in a subdirectory (i.e. any discovery with `path !== ''`), `init` prints a formatted summary before presenting the checkbox — for example:

```
Found 3 ecosystem(s):
  npm         package-lock.json       frontend/
  npm         package-lock.json       backend/
  composer    composer.lock           (root)
```

Root-only discoveries are silent (no summary printed). This gives operators immediate visibility into what was found before they confirm the selection.

## Monorepo Config Shape

When `discoverProject()` finds multiple entries for the same plugin (e.g. an npm lockfile at the root and another under `frontend/`), the `init` command assigns a `label` to each entry so they can be distinguished in the config.

The generated `config.ecosystems` array supports the following fields on each entry:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | yes | Plugin id: `'npm'`, `'composer'`, `'pip'` |
| `path` | `string` | no | Relative subdirectory (no leading `./` or `/`, no `..` segments, no globs). When absent the entry runs at the project root. |
| `label` | `string` | no | Disambiguator when two or more entries share the same `id`. Must match `^[a-z0-9-]+$`. Required when duplicate ids exist. |

**Example — monorepo with two npm entries:**

```json
{
  "ecosystems": [
    {
      "id": "npm",
      "label": "backend",
      "path": "api",
      "fixer": "osv-then-audit"
    },
    {
      "id": "npm",
      "label": "frontend",
      "path": "web",
      "fixer": "npm-audit"
    },
    {
      "id": "composer",
      "path": "api"
    }
  ]
}
```

The orchestrator iterates `config.ecosystems` in declaration order. Each entry is dispatched to `runEcosystemFix()` independently — two npm entries at different paths each get a separate fix pipeline run with their own resolved `cwd`.
