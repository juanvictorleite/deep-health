import type { CommandRunner } from '@core/types/common';
import type { ProjectConfig, RunnerConfig } from '@core/types/config';
import type { EcosystemPlugin } from '@modules/ecosystem/types';
import type { RunMode } from './types';
import { __ } from '@core/i18n';
import { logger } from '../utils/logger';
import { EcosystemContainerCommandRunner } from './command-runner';
import { EphemeralEcosystemContainer } from './ephemeral-container';
import { buildProjectImage } from './build-project-image';
import { CLI_NAME } from '@infra/brand';
import { inferVersionFromSources } from '@infra/utils/infer-version';

export interface ResolveEcosystemRuntimeOptions {
  plugin: EcosystemPlugin;
  hostRunner: CommandRunner;
  config: ProjectConfig;
  cwd: string;
  runnerConfig?: RunnerConfig;
  projectRoot?: string;
}

/**
 * Resolve a containerized CommandRunner for the given ecosystem plugin.
 *
 * Image resolution precedence:
 *   When `build` is present in runner config:
 *     - Calls `buildProjectImage()` with `ecosystems[].runner.build.dockerfile`.
 *     - The result's `entrypointOverride` (always `""`) is forwarded to
 *       `EphemeralEcosystemContainer` to prevent ENTRYPOINT hijacking.
 *     - When `image` is also set alongside `build`, the custom image tag is passed
 *       to `buildProjectImage` as `imageTag` (image + build coexistence pattern).
 *
 *   When `build` is absent (pull-based resolution):
 *     1. `ecosystems[].runner.image` — explicit image config (highest priority)
 *     2. `ecosystems[].runner.language_version` — explicit version → `spec.resolveImage(version)`
 *     3. `inferVersionFromSources(cwd, plugin.versionSources)` — project-file version inference → `spec.resolveImage(version)`
 *     4. `spec.resolveImage(undefined)` → `spec.defaultImage` (fallback)
 *
 * @param options.runnerConfig  Optional per-ecosystem runner config from `ecosystems[].runner`.
 *                              When absent, all image resolution falls through to plugin defaults.
 *
 * @throws {Error} when `plugin.runtimeSpec` is undefined (plugin has no runtime spec)
 */
export async function resolveEcosystemRuntime(
  options: ResolveEcosystemRuntimeOptions,
): Promise<CommandRunner> {
  const { plugin, hostRunner, config, cwd, runnerConfig, projectRoot } = options;
  if (plugin.runtimeSpec === undefined) {
    throw new Error(
      __("Plugin '{{pluginId}}' has no runtimeSpec; cannot resolve a runtime container.", { pluginId: plugin.id }),
    );
  }

  const spec = plugin.runtimeSpec;

  // Cast to access optional fields present on ecosystem runner configs
  const runnerCfg = runnerConfig as
    | {
        image?: string;
        language_version?: string;
        native_deps?: readonly string[];
        build?: {
          dockerfile: string;
          context?: string;
          target?: string;
          args?: Record<string, string>;
          allow_context_escape?: boolean;
        };
      }
    | undefined;

  // ─── Image resolution ─────────────────────────────────────────────────────

  let image: string;
  let entrypointOverride: string | undefined;

  if (runnerCfg?.build != null) {
    // ── Build branch (project-owned Dockerfile) ──────────────────────────────
    const build = runnerCfg.build;

    logger.info(
      `[ecosystem-runtime/${plugin.id}] build.dockerfile configured — building project image from ${build.dockerfile}`,
    );

    const buildResult = await buildProjectImage({
      projectDir: projectRoot ?? cwd,
      dockerfilePath: build.dockerfile,
      logPrefix: plugin.id,
      buildContext: build.context,
      buildArgs: build.args,
      allowBuildContextEscape: build.allow_context_escape,
      target: build.target,
      // When image is also set, use it as the custom tag (image + build coexistence).
      imageTag: runnerCfg?.image,
    });

    image = buildResult.image;
    entrypointOverride = buildResult.entrypointOverride;
  } else {
    // ── Pull branch (default) ────────────────────────────────────────────────
    if (runnerCfg?.image) {
      // 1. Explicit image config — highest priority
      image = runnerCfg.image;
    } else {
      // 2–4. Version-based resolution
      let version: string | undefined = runnerCfg?.language_version;

      if (!version) {
        // inferVersionFromSources never throws per its contract
        version = await inferVersionFromSources(cwd, plugin.versionSources ?? []);
      }

      if (!version) {
        // Neither config nor project-file inference produced a version — falling back to default image.
        // Warn for pip specifically because python:3-slim can resolve to Python 3.14+ which may break projects.
        if (plugin.id === 'pip') {
          logger.warn(
            '[ecosystem-runtime/pip] No language_version configured and no Python version file detected. ' +
            `Falling back to ${spec.defaultImage} (may resolve to Python 3.14+). ` +
            `Run '${CLI_NAME} init' or set ecosystems[pip].runner.language_version in your config to pin the version.`,
          );
        }
      }

      // resolveImage returns spec.defaultImage when version is undefined
      image = spec.resolveImage(version);
    }
  }

  logger.tagged(plugin.id, `ecosystem-runtime/${plugin.id}`, `Using Docker image: ${image}`);

  // ─── Native deps preamble ─────────────────────────────────────────────────

  const nativeDeps = runnerCfg?.native_deps ?? [];

  let runMode: RunMode = spec.runMode;
  if (nativeDeps.length > 0) {
    const pkgs = nativeDeps.join(' ');
    // Load-bearing input guard: DebianPackageNameSchema (src/infrastructure/config/schema.ts) must reject shell metacharacters and whitespace before this point — do not relax that regex without auditing this interpolation site.
    const aptInstall = `apt-get update -qq -o APT::Sandbox::User=root && apt-get install -y --no-install-recommends -o APT::Sandbox::User=root ${pkgs}`;
    logger.tagged(plugin.id, `ecosystem-runtime/${plugin.id}`, `native_deps: ${pkgs}`);
    const existingPreamble = spec.runMode.preamble;
    runMode = {
      ...spec.runMode,
      preamble: (img: string): string => {
        const existing = existingPreamble?.(img);
        return existing ? `${aptInstall} && ${existing}` : aptInstall;
      },
    } as RunMode;
  }

  // ─── Container instantiation ──────────────────────────────────────────────

  const container = new EphemeralEcosystemContainer({
    runMode,
    projectDir: cwd,
    image,
    logPrefix: plugin.id,
    entrypointOverride,
    readonly: spec.mountReadonly ?? false,
  });

  return new EcosystemContainerCommandRunner({
    container,
    hostRunner,
    spec,
    dryRun: hostRunner.dryRun,
  });
}
