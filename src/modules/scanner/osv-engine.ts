import { join } from 'node:path';

import { PhaseError, EnvironmentError } from '@core/errors';
import { enrichWithReachability, type ReachabilityAdapter } from '@core/policy/reachability';
import type { EcosystemConfig, OsvRunnerMode, ProjectConfig } from '@core/types/config';
import { ecosystemEntryKey } from '@core/types/config';
import type { ScanResultJson, EcosystemScanResult } from '@core/types/scan';
import { OsvDockerRunner } from '@infra/provisioner/osv-runner';
import { logger } from '@infra/utils/logger';
import {
  buildScanCommand,
  OSV,
  OSV_DEFAULT_IMAGE,
  validateScanPath,
  resolveScanPathArgs,
} from '@infra/utils/osv-commands';
import { getPlatformInstallHint } from '@infra/utils/platform';
import { ComposerReachabilityAdapter } from '@modules/ecosystem/plugins/composer-reachability';
import { NpmReachabilityAdapter } from '@modules/ecosystem/plugins/npm-reachability';
import { PipReachabilityAdapter } from '@modules/ecosystem/plugins/pip-reachability';
import type { EcosystemRegistry } from '@modules/ecosystem/registry';

import { parseOsvJsonOutput, type OsvJsonOutput } from './osv-parse';
import type { ScannerEngine, ScannerEngineContext } from './types';

export type { OsvJsonOutput };

type Plugin = ReturnType<EcosystemRegistry['getAll']>[number];

// ─── OsvScannerEngine ──────────────────────────────────────────────────────────

/**
 * Scanner engine wrapping osv-scanner CLI.
 *
 * Encapsulates: availability assertion, command construction, JSON parsing,
 * and result normalization into ScanResultJson.
 *
 * Runner selection (from config.scanners.osv.runner):
 * - 'local'  — always use the local binary; fail if not installed.
 * - 'docker' — always run via an ephemeral OsvDockerRunner container.
 */
export class OsvScannerEngine implements ScannerEngine {
  readonly id = 'osv';
  readonly name = 'OSV Scanner';
  readonly order = 0;

  // ── Availability helpers ─────────────────────────────────────────────────────

  /** Returns true when the local osv-scanner binary responds to --version. */
  private async isLocalAvailable(ctx: ScannerEngineContext): Promise<boolean> {
    try {
      const result = await ctx.runner.run(OSV.checkAvailable, { cwd: ctx.cwd });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /** Returns true when the `docker` CLI is accessible (basic smoke test). */
  private async isDockerAvailable(ctx: ScannerEngineContext): Promise<boolean> {
    try {
      const result = await ctx.runner.run('docker --version', { cwd: ctx.cwd });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async assertAvailable(ctx: ScannerEngineContext): Promise<void> {
    const runner = ctx.config.scanners?.osv?.runner ?? 'docker';

    if (runner === 'local') {
      const ok = await this.isLocalAvailable(ctx);
      if (!ok) {
        const hint = getPlatformInstallHint('osv-scanner');
        throw new EnvironmentError(`osv-scanner not found (runner: local). ${hint}`);
      }
      return;
    }

    if (runner === 'docker') {
      const ok = await this.isDockerAvailable(ctx);
      if (!ok) {
        throw new EnvironmentError(
          'Docker is not available (runner: docker). Install Docker to use the osv-scanner container.',
        );
      }
      return;
    }
  }

  // ── Scan ─────────────────────────────────────────────────────────────────────

  async scan(ctx: ScannerEngineContext): Promise<ScanResultJson> {
    logger.info('Running OSV vulnerability scan...');
    const base = this.buildBaseResult(ctx);

    try {
      await this.assertAvailable(ctx);

      const runnerMode = ctx.config.scanners?.osv?.runner ?? 'docker';
      this.warnIfLocalRunner(runnerMode);
      const useDocker = runnerMode === 'docker';
      const scanConfig = ctx.config.scan;

      // ── scan.paths override: single combined scan (legacy / explicit path mode) ──
      if (scanConfig?.paths && scanConfig.paths.length > 0) {
        return await this.runCombinedPathScan(ctx, base, scanConfig.paths, scanConfig.exclude ?? [], useDocker);
      }

      // ── Per-entry scan mode: one invocation per config.ecosystems entry ──────
      // Each entry is scanned independently so results are keyed by ecosystemEntryKey(entry)
      // (e.g. 'npm', 'npm:frontend', 'npm:api') with no cross-entry collision.
      return await this.runPerEntryScan(ctx, base, useDocker);
    } catch (err) {
      if (err instanceof EnvironmentError) throw err;
      throw new PhaseError(
        `OSV scanner phase failed: ${err instanceof Error ? err.message : String(err)}`,
        'scanner',
        err,
      );
    }
  }

  // ── Scan phase helpers ───────────────────────────────────────────────────────

  /** Builds the zero-state result stamped with environment and (when known) branch. */
  private buildBaseResult(ctx: ScannerEngineContext): ScanResultJson {
    return {
      $schema: 'osv-scan-result/v1',
      agent: 'osv',
      status: 'success',
      environment: ctx.runner.environment,
      ecosystems: {},
      error: null,
      // Stamp branch when available (null omitted by consumers — treated as unknown)
      ...(ctx.branch !== null && ctx.branch !== undefined ? { branch: ctx.branch } : {}),
    };
  }

  /** Warns when the (non-default) local runner mode is in effect. */
  private warnIfLocalRunner(runnerMode: OsvRunnerMode): void {
    if (runnerMode !== 'local') return;
    logger.warn(
      '[OSV runner] runner=local: using local osv-scanner binary. ' +
      'Docker (runner: docker) is the recommended default for reproducible, ' +
      'platform-independent scans. Set scanners.osv.runner to "docker" in your config.',
    );
  }

  /** Combined-scan mode: single osv-scanner invocation across explicit scan.paths. */
  private async runCombinedPathScan(
    ctx: ScannerEngineContext,
    base: ScanResultJson,
    paths: string[],
    exclude: string[],
    useDocker: boolean,
  ): Promise<ScanResultJson> {
    const { runner, config, cwd, ecosystemRegistry } = ctx;

    for (const p of paths) {
      validateScanPath(p);
    }
    const rawArgs = resolveScanPathArgs(paths, exclude);
    if (rawArgs.length === 0) {
      throw new PhaseError(
        'scan.paths is configured but resolved to zero lockfile args — ' +
        'this would silently report zero vulnerabilities',
        'scanner',
      );
    }

    if (runner.dryRun) {
      if (useDocker) {
        logger.tagged('osv', 'DRY-RUN', 'Would execute osv-scanner via Docker container');
      } else {
        logger.tagged('osv', 'DRY-RUN', `Would execute: osv-scanner ${rawArgs.join(' ')} --format json`);
      }
      return base;
    }

    const { stdout, exitCode, stderr } = await this.runSingleScan(rawArgs, useDocker, config, cwd, runner);
    if (exitCode !== 0 && !stdout) {
      return { ...base, status: 'error', error: `Scan failed (exit ${exitCode}): ${stderr}` };
    }
    const parsed = parseOsvJsonOutput(stdout, config, ecosystemRegistry);
    return { ...base, ...parsed };
  }

  /** Builds the reachability adapter map per config.reachability gating. */
  private buildReachabilityAdapters(config: ProjectConfig): Map<string, ReachabilityAdapter> {
    const reachabilityConfig = config.reachability;
    const reachabilityEnabled = reachabilityConfig?.enabled !== false;
    const deep = reachabilityConfig?.deep !== false;

    return new Map<string, ReachabilityAdapter>(
      reachabilityEnabled
        ? [
            ['npm', new NpmReachabilityAdapter({ deep })],
            ['pip', new PipReachabilityAdapter()],
            ['composer', new ComposerReachabilityAdapter({ deep })],
          ]
        : [],
    );
  }

  /**
   * Builds lockfile args for a single ecosystem entry, rewriting them to be
   * path-aware when entry.path is set (monorepo).
   */
  private resolveEntryScanArgs(plugin: Plugin, entry: EcosystemConfig): string[] {
    const pluginArgs = plugin.buildScanArgs();
    if (!entry.path) return pluginArgs;

    // Rewrite every '--lockfile <file>' pair: prepend entry.path to the file.
    const rawArgs: string[] = [];
    for (let i = 0; i < pluginArgs.length; i++) {
      if (pluginArgs[i] === '--lockfile' && i + 1 < pluginArgs.length) {
        rawArgs.push('--lockfile', join(entry.path, pluginArgs[i + 1]!));
        i++;
      } else {
        rawArgs.push(pluginArgs[i]!);
      }
    }
    return rawArgs;
  }

  /**
   * Re-keys parsed ecosystem data to the composite entryKey and, when reachability
   * adapters are active, enriches it in place.
   */
  private async mergeEntryEcosystemData(
    pluginData: EcosystemScanResult,
    entryKey: string,
    adapters: Map<string, ReachabilityAdapter>,
    entryCwd: string,
  ): Promise<EcosystemScanResult> {
    // parseOsvJsonOutput keys by plugin.id and sets VulnerabilityEntry.ecosystem = plugin.id.
    // Re-key the result to entryKey and update the ecosystem field in each vulnerability
    // so downstream consumers (report builder, dedup logic) use the composite key naturally.
    const rekeyedData: EcosystemScanResult = {
      ...pluginData,
      vulnerabilities: pluginData.vulnerabilities.map((v) => ({ ...v, ecosystem: entryKey })),
    };

    if (adapters.size === 0) return rekeyedData;

    const enriched = await enrichWithReachability({ [entryKey]: rekeyedData }, adapters, entryCwd);
    return enriched[entryKey] ?? rekeyedData;
  }

  /**
   * Runs a single ecosystem entry's scan and merges its findings into mergedEcosystems.
   * Returns a non-null ScanResultJson to signal an immediate hard-failure abort
   * (preserving the original behaviour where a failed entry aborts the whole scan).
   */
  private async processEcosystemEntry(
    entry: EcosystemConfig,
    plugin: Plugin,
    ctx: ScannerEngineContext,
    base: ScanResultJson,
    useDocker: boolean,
    adapters: Map<string, ReachabilityAdapter>,
    mergedEcosystems: Record<string, EcosystemScanResult>,
  ): Promise<ScanResultJson | null> {
    const { runner, config, cwd, ecosystemRegistry } = ctx;
    const entryKey = ecosystemEntryKey(entry);
    const entryCwd = entry.path ? join(cwd, entry.path) : cwd;

    // Allow plugin to inspect entry directory before buildScanArgs (e.g. pip tooling detection).
    if (plugin.prepareScan) {
      await plugin.prepareScan(entryCwd);
    }

    const rawArgs = this.resolveEntryScanArgs(plugin, entry);
    logger.debug(`Running OSV scan for entry "${entryKey}" (args: ${rawArgs.join(' ')})`);

    const { stdout, exitCode, stderr } = await this.runSingleScan(rawArgs, useDocker, config, cwd, runner);
    if (exitCode !== 0 && !stdout) {
      // Scan completely failed for this entry (no output to parse).
      // Return an error result immediately — this preserves the original behaviour
      // where a hard scan failure causes the pipeline to abort.
      return { ...base, status: 'error', error: `Scan failed (exit ${exitCode}): ${stderr}` };
    }

    const parsed = parseOsvJsonOutput(stdout, config, ecosystemRegistry);
    const pluginData = parsed.ecosystems[plugin.id];
    if (!pluginData) return null;

    mergedEcosystems[entryKey] = await this.mergeEntryEcosystemData(pluginData, entryKey, adapters, entryCwd);
    return null;
  }

  /** Per-entry scan mode: one osv-scanner invocation per config.ecosystems entry. */
  private async runPerEntryScan(
    ctx: ScannerEngineContext,
    base: ScanResultJson,
    useDocker: boolean,
  ): Promise<ScanResultJson> {
    const { config, ecosystemRegistry } = ctx;
    const mergedEcosystems: Record<string, EcosystemScanResult> = {};
    const adapters = this.buildReachabilityAdapters(config);

    // Ecosystem resolution uses config.ecosystems[] declaratively.
    // Use getAll().find() so the logic works with both real and test-mocked registries
    // (some test registries implement getAll() but not get()).
    const allPlugins = ecosystemRegistry.getAll();
    const activePlugins = allPlugins.filter((p) => config.ecosystems.some((e) => e.id === p.id));

    if (ctx.runner.dryRun) {
      if (useDocker) {
        logger.tagged('osv', 'DRY-RUN', 'Would execute osv-scanner via Docker container');
      } else {
        logger.tagged('osv', 'DRY-RUN', `Would execute: ${buildScanCommand(activePlugins)}`);
      }
      return base;
    }

    for (const entry of config.ecosystems) {
      const plugin = allPlugins.find((p) => p.id === entry.id);
      if (!plugin) continue;

      const errorResult = await this.processEcosystemEntry(entry, plugin, ctx, base, useDocker, adapters, mergedEcosystems);
      if (errorResult) return errorResult;
    }

    return { ...base, ecosystems: mergedEcosystems };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Execute a single OSV scanner invocation with the given lockfile args.
   * Delegates to Docker runner or local runner based on the useDocker flag.
   */
  private async runSingleScan(
    rawArgs: string[],
    useDocker: boolean,
    config: ProjectConfig,
    cwd: string,
    runner: ScannerEngineContext['runner'],
  ): Promise<{ stdout: string; exitCode: number; stderr: string }> {
    if (useDocker) {
      const image = config.scanners?.osv?.image ?? OSV_DEFAULT_IMAGE;
      logger.debug(`Running OSV scan via Docker (image: ${image})`);
      const dockerRunner = new OsvDockerRunner({ projectDir: cwd, image });
      return dockerRunner.run(rawArgs);
    } else {
      const args = [...rawArgs, '--format', 'json'];
      const cmd = `osv-scanner ${args.join(' ')}`;
      logger.debug(`Running: ${cmd}`);
      return runner.run(cmd, { cwd });
    }
  }
}
