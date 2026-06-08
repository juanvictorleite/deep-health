import type { CommandRunner } from '@core/types/common';
import type { ScanResultJson } from '@core/types/scan';
import type { AdvisorFinding } from '@core/types/report';

/**
 * Evidence returned by the orchestrator's OSV staging-apply phase.
 * Single source of truth — imported by EcosystemUpdaterContext and any fixer that
 * needs to merge or surface OSV-sourced package evidence.
 */
export interface OsvFixOutcome {
  applied: boolean;
  packagesUpdated: { name: string; versionFrom: string; versionTo: string }[];
}

/**
 * Extract the package name from a 'name@version' spec string.
 * Handles scoped packages: '@scope/pkg@1.0.0' → '@scope/pkg'
 * Non-scoped: 'lodash@4.17.21' → 'lodash'
 * No version: 'lodash' → 'lodash'
 */
export function extractPackageName(spec: string): string {
  const at = spec.startsWith('@') ? spec.indexOf('@', 1) : spec.indexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

/**
 * Merge OSV-sourced packages with fixer/audit packages using OSV-first-wins strategy.
 *
 * OSV packages are verified against the staging lockfile and trusted as ground truth.
 * Fixer/audit packages complement — only packages NOT already covered by OSV are added.
 * This ensures the report always reflects OSV's verified results while still capturing
 * additional fixes from audit or other sources.
 *
 * @param osvFixOutcome - Evidence from the orchestrator's OSV staging-apply phase.
 * @param fixerPackages - Packages reported by the fixer (audit-verified, pip install, etc.).
 * @returns Merged array: OSV packages first, then complementary fixer packages.
 */
export function mergeOsvFirstWins(
  osvFixOutcome: OsvFixOutcome | undefined,
  fixerPackages: string[],
): string[] {
  if (!osvFixOutcome || osvFixOutcome.packagesUpdated.length === 0) {
    return fixerPackages;
  }
  const osvPackages = osvFixOutcome.packagesUpdated.map((p) => `${p.name}@${p.versionTo}`);
  const osvNames = new Set(osvPackages.map(extractPackageName));
  const complementary = fixerPackages.filter((spec) => !osvNames.has(extractPackageName(spec)));
  return [...osvPackages, ...complementary];
}

export interface FixerCallOptions {
  runner: CommandRunner;
  cwd: string;
  scanResult: ScanResultJson;
  authorizeBreaking: boolean;
  /**
   * When present, contains the evidence of what OSV staging-apply wrote to disk.
   * Fixers use this to return the real packages list instead of an empty array.
   * - `osv-fixer`: returns packagesUpdated from this field.
   * - `osv-then-audit-fixer`: merges this with its own audit-verified list (OSV-first-wins: OSV packages trusted, audit complements).
   */
  osvFixOutcome?: OsvFixOutcome;
  /**
   * The ecosystem key used to look up scan results (e.g. "npm", "npm:web").
   * Defaults to "npm" when not provided.
   */
  ecosystemKey?: string;
  /**
   * Structured advisor findings for this ecosystem, flat-mapped from all advisor results.
   * Passed through by the updater so fixers CAN consume advisor data in the future.
   * Present only when the upstream advisor produced structured JSON findings.
   */
  advisorFindings?: AdvisorFinding[];
}

export interface FixerCallResult {
  breakingInstallError: string | null;
  packagesUpdated: string[];
  /**
   * For osv-then-audit strategy: post-OSV lockfile snapshot taken before npm audit fix ran.
   * Keys are file paths relative to cwd; values are file contents.
   * Retained for test introspection and backward compatibility.
   */
  intermediateBackup?: Map<string, string>;
  /**
   * When present, called by the updater on validation failure before
   * falling back to full revert. The callable restores to the
   * intermediate (post-OSV) state and re-bootstraps, giving the caller
   * a chance to re-validate before committing to a full revert.
   *
   * Throws if the partial-revert bootstrap fails — the updater must
   * propagate that as a PhaseError.
   */
  partialRevert?: (runner: CommandRunner, cwd: string) => Promise<void>;
}

export type FixerFn = (opts: FixerCallOptions) => Promise<FixerCallResult>;
