import { resolve } from "node:path";

import type { EcosystemConfig, ProjectConfig } from "@core/types/config";
import { ecosystemEntryKey } from "@core/types/config";
import { logger } from "@infra/utils/logger";
import type { EcosystemRegistry } from "@modules/ecosystem/index";
import type { EcosystemPlugin } from "@modules/ecosystem/types";

import type { OrchestratorOptions } from "./orchestrator";

/**
 * A single active ecosystem entry resolved for execution: the plugin to run,
 * its config entry, the working directory to run it in, and whether breaking
 * changes are authorized for it.
 */
export interface ActiveEcosystemEntry {
  plugin: EcosystemPlugin;
  ecoEntry: EcosystemConfig;
  ecosystemCwd: string;
  authorizeBreaking: boolean;
}

/**
 * The resolved execution plan for a pipeline run: which phases run (scan,
 * ecosystems, report) and the per-engine on-failure policy. Pure — no I/O,
 * no Docker — a config+options snapshot in, an ExecutionPlan out.
 */
export interface ExecutionPlan {
  runScan: boolean;
  activeEcosystems: ActiveEcosystemEntry[];
  runReport: boolean;
  onFailureFor(engineId: string): "warn" | "fail";
}

function shouldRunPhase(phase: string, options: OrchestratorOptions): boolean {
  if (!options.phases) return true;
  return options.phases.includes(phase);
}

/**
 * Resolve the on_failure policy for a secondary engine.
 *
 * Uses a generic lookup into config.scanners by engine id.
 * Each engine config block that exposes an `on_failure` field is consulted.
 * - 'sonarqube': reads config.scanners.sonarqube.on_failure (defaults to 'warn').
 * - Any engine id whose config block has an `on_failure` field: uses that value.
 * - Any engine id with no config or no `on_failure` field: defaults to 'fail' (safe hardening).
 *
 * Rationale for the 'fail' default for unknowns: an unrecognised engine has no
 * config key, so silently swallowing its failure could mask integration bugs or
 * misconfiguration. Failing loudly is the safe choice.
 */
function resolveOnFailure(
  engineId: string,
  config: ProjectConfig,
): "warn" | "fail" {
  const scanners = config.scanners;
  if (!scanners) {
    logger.debug(
      `Engine "${engineId}": no scanners config found — defaulting on_failure to "fail".`,
    );
    return "fail";
  }

  // Generic lookup: find the engine config block by id and read on_failure if present
  for (const [key, engineConfig] of Object.entries(scanners)) {
    if (
      key === engineId &&
      engineConfig &&
      typeof engineConfig === "object" &&
      "on_failure" in engineConfig
    ) {
      const onFailure = (engineConfig as { on_failure?: "warn" | "fail" })
        .on_failure;
      return onFailure ?? "fail";
    }
  }

  // Unknown secondary engine or engine config has no on_failure — fail by default (safe hardening)
  logger.warn(
    `Engine "${engineId}" is not a recognised secondary engine or has no on_failure config. ` +
      `Defaulting on_failure to "fail" for safety. ` +
      `Add explicit config for this engine to override.`,
  );
  return "fail";
}

/**
 * Builds the list of active ecosystem entries to process (respects phases filter).
 * Returns { plugin, ecoEntry, ecosystemCwd, authorizeBreaking } for each active entry.
 */
function buildActiveEcosystemEntries(
  config: ProjectConfig,
  options: OrchestratorOptions,
  ecosystemRegistry: EcosystemRegistry,
): ActiveEcosystemEntry[] {
  const entries: ActiveEcosystemEntry[] = [];

  for (const ecoEntry of config.ecosystems) {
    const plugin = ecosystemRegistry.getAll().find((p) => p.id === ecoEntry.id);
    if (!plugin) continue;

    const entryKey = ecosystemEntryKey(ecoEntry);

    if (options.phases && !shouldRunPhase(ecoEntry.id, options) && !shouldRunPhase(entryKey, options)) {
      logger.info(`Phase: Skipping ${plugin.name} (${entryKey}) — not in phases list`);
      continue;
    }

    const ecosystemCwd = ecoEntry.path ? resolve(options.cwd, ecoEntry.path) : options.cwd;
    const authorizeBreaking =
      (options.authorizeBreaking?.[ecoEntry.id] ?? false) ||
      (options.authorizeBreaking?.[entryKey] ?? false);

    entries.push({ plugin, ecoEntry, ecosystemCwd, authorizeBreaking });
  }

  return entries;
}

/**
 * Resolves the execution plan for a pipeline run: which phases run (scan,
 * ecosystems, report) and the per-engine on-failure policy.
 *
 * `ecosystemRegistry` is required to resolve `activeEcosystems` (each config
 * entry is matched against the registry's plugins); callers pass the same
 * registry they use for the rest of the run (injected or default).
 */
export function resolveExecutionPlan(
  config: ProjectConfig,
  options: OrchestratorOptions,
  ecosystemRegistry: EcosystemRegistry,
): ExecutionPlan {
  return {
    runScan: shouldRunPhase("scan", options),
    activeEcosystems: buildActiveEcosystemEntries(config, options, ecosystemRegistry),
    runReport: shouldRunPhase("report", options),
    onFailureFor: (engineId: string) => resolveOnFailure(engineId, config),
  };
}
