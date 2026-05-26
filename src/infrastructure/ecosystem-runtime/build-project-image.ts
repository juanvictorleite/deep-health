/**
 * buildProjectImage — Project-owned Dockerfile → stable local Docker image
 *
 * Builds an image from a user-specified Dockerfile (relative to projectDir),
 * producing a deterministic local tag derived from the SHA-256 of the
 * Dockerfile contents. The tag is stable across runs as long as the file does
 * not change, enabling implicit cache hits.
 *
 * Design constraints:
 *  - Returns an `entrypoint` that callers MUST forward to EphemeralEcosystemContainer
 *    as `entrypointOverride`; the container primitive then emits `--entrypoint ""`
 *    to prevent the image ENTRYPOINT from hijacking the command.
 *  - Does NOT write config files or mutate state; pure side-effect: `docker build`.
 *  - Emits a warning when the build context is large (>50 MB after .dockerignore).
 *  - Throws with a descriptive message on build failure.
 *  - Does NOT probe for required ecosystem binaries — if a binary is missing,
 *    the actual ecosystem commands (npm audit, pip check, etc.) will fail naturally
 *    with clear errors. This avoids false positives with multi-stage Dockerfiles.
 *
 * @module
 */

import { CLI_NAME } from '@infra/brand';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { __ } from '@core/i18n';
import { logger } from '../utils/logger';
import { spawnStreaming } from '../utils/spawn-streaming';
import {
  assertBuildContextWithinBoundary,
  resolveAllowedBuildContextRoot,
} from './resolve-build-context-boundary';

const execFileAsync = promisify(execFile);

/** Threshold in bytes above which a build-context size warning is emitted. */
const LARGE_CONTEXT_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB

/** Namespace prefix for all project-built image tags. */
const IMAGE_TAG_NAMESPACE = `${CLI_NAME}-project`;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BuildProjectImageOptions {
  /** Absolute path to the project directory. */
  projectDir: string;
  /**
   * Path to the Dockerfile.
   * When `buildContext` is set, resolved relative to the build context directory.
   * Otherwise resolved relative to `projectDir`.
   * Example: 'Dockerfile', '.docker/node.Dockerfile'
   */
  dockerfilePath: string;
  /** Log prefix for build output lines, e.g. 'npm' / 'pip' / 'composer'. */
  logPrefix: string;
  /**
   * Docker build context path, relative to `projectDir`.
   * When absent, defaults to `projectDir`.
   * Example: '../', 'docker/'
   */
  buildContext?: string;
  /**
   * Build arguments forwarded as `--build-arg KEY=VALUE` to `docker build`.
   * Example: { NODE_VERSION: '20', APP_ENV: 'production' }
   */
  buildArgs?: Record<string, string>;
  /**
   * When true, allows the Docker build context to resolve outside the project
   * boundary (git root, or projectDir when not in a git repository).
   * Emits a security warning when the boundary is crossed.
   * Default: false.
   */
  allowBuildContextEscape?: boolean;
  /**
   * Multi-stage build target. When set, `--target <value>` is passed to `docker build`.
   * Also incorporated into the image tag hash so different targets produce different tags.
   * Example: 'node-stage', 'production'
   */
  target?: string;
  /**
   * Custom image tag to use instead of the auto-generated hash-based tag.
   * When set, this tag is used directly and hash computation is skipped.
   * Supports the `image + build` coexistence pattern where the user specifies a
   * custom name for the built image.
   * Cache probing (probeImageExists) still applies.
   * Example: `${CLI_NAME}-project/npm:custom-tag`
   */
  imageTag?: string;
}

export interface BuildProjectImageResult {
  /**
   * The stable local image tag that was built.
   * Format: `<CLI_NAME>-project/build:<sha256-prefix>` (auto-generated)
   *      or the caller-supplied `imageTag` when that option is set.
   * Example: `<CLI_NAME>-project/build:a3f1b2c4`
   */
  image: string;
  /**
   * The entrypoint override value to pass to EphemeralEcosystemContainer.
   * Always `""` — instructs Docker to clear the image's ENTRYPOINT so the
   * ecosystem CLI binary is invoked directly without being wrapped.
   */
  entrypointOverride: string;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Build (or reuse a cached) Docker image from a project-owned Dockerfile.
 *
 * The image tag is a SHA-256 fingerprint of the Dockerfile contents. When
 * the tag already exists locally (probed via `docker image inspect`), the
 * build is skipped and the cached tag is returned immediately.
 *
 * After a successful build, the result carries `entrypointOverride: ""`
 * which the caller MUST forward to `EphemeralEcosystemContainer` to prevent
 * the image's ENTRYPOINT from shadowing the ecosystem CLI binary.
 *
 * @throws {Error} when the Dockerfile is missing, the build fails, or Docker
 *   is not available.
 */
export async function buildProjectImage(
  options: BuildProjectImageOptions,
): Promise<BuildProjectImageResult> {
  const {
    projectDir,
    dockerfilePath,
    logPrefix,
    buildContext,
    buildArgs: extraBuildArgs,
    target,
    imageTag: callerImageTag,
  } = options;

  // Resolve the effective Docker build context directory
  const contextDir = buildContext
    ? path.resolve(projectDir, buildContext)
    : projectDir;

  // ── Security: reject absolute dockerfilePath from caller ─────────────────
  if (path.isAbsolute(dockerfilePath)) {
    throw new Error(
      __('[ecosystem-runtime/{{logPrefix}}] dockerfilePath must be a relative path; absolute paths are rejected for security reasons: "{{dockerfilePath}}"', { logPrefix, dockerfilePath }),
    );
  }

  // ── Security: enforce build context boundary ──────────────────────────────
  // The allowed root is the git repository root (or projectDir if not in a
  // git repo). Building outside this boundary may expose sensitive files to
  // the Docker daemon. Use allow_build_context_escape: true per runner config
  // to opt in explicitly — a security warning is emitted when active.
  const boundaryResult = await resolveAllowedBuildContextRoot(projectDir);
  await assertBuildContextWithinBoundary({
    contextDir,
    allowedRoot: boundaryResult.root,
    boundarySource: boundaryResult.source,
    logPrefix,
    allowEscape: options.allowBuildContextEscape,
  });

  // Dockerfile is resolved relative to contextDir (matching Docker's intuition:
  // when a custom build context is provided, the Dockerfile lives within it)
  const absoluteDockerfile = path.resolve(contextDir, dockerfilePath);

  // ── 1. Read Dockerfile and compute stable tag ───────────────────────────

  let dockerfileContents: string;
  try {
    dockerfileContents = await fs.readFile(absoluteDockerfile, 'utf8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      __('[ecosystem-runtime/{{logPrefix}}] Dockerfile not found at "{{absoluteDockerfile}}": {{message}}', { logPrefix, absoluteDockerfile, message }),
    );
  }

  // Compute an image tag that incorporates all build-varying inputs so that two
  // ecosystems sharing the same (Dockerfile, context, target, args) produce the
  // same tag and hit the cache on the second call.
  let image: string;
  if (callerImageTag) {
    // Caller supplied a custom tag (image + build coexistence); use it directly.
    image = callerImageTag;
  } else {
    const hashInput = [
      dockerfileContents,
      buildContext ?? '',
      target ?? '',
      extraBuildArgs ? JSON.stringify(Object.entries(extraBuildArgs).sort()) : '',
    ].join('\0');
    const sha256 = createHash('sha256').update(hashInput).digest('hex');
    const shortSha = sha256.slice(0, 12);
    image = `${IMAGE_TAG_NAMESPACE}/build:${shortSha}`;
  }

  logger.debug(
    `[ecosystem-runtime/${logPrefix}] Resolved image tag: ${image}`,
  );

  // ── 2. Probe for cached image ─────────────────────────────────────────────

  const alreadyBuilt = await probeImageExists(image);
  if (alreadyBuilt) {
    logger.tagged(logPrefix, `ecosystem-runtime/${logPrefix}`, `Reusing cached project image: ${image}`);
    return { image, entrypointOverride: '' };
  }

  // ── 3. Warn on large build context ───────────────────────────────────────

  await warnIfLargeContext(contextDir, logPrefix);

  // ── 4. Build the image ────────────────────────────────────────────────────

  logger.tagged(logPrefix, `ecosystem-runtime/${logPrefix}`,
    `Building project image from ${dockerfilePath} → ${image}` +
      (buildContext ? ` (context: ${buildContext})` : ''));

  const dockerBuildArgs = [
    'build',
    '--file',
    absoluteDockerfile,
    '--tag',
    image,
  ];

  if (extraBuildArgs) {
    for (const [key, value] of Object.entries(extraBuildArgs)) {
      dockerBuildArgs.push('--build-arg', `${key}=${value}`);
    }
  }

  if (target) {
    dockerBuildArgs.push('--target', target);
  }

  dockerBuildArgs.push(contextDir);

  const buildResult = await spawnStreaming({
    file: 'docker',
    args: dockerBuildArgs,
    logPrefix,
    label: `${logPrefix}/build`,
    stdoutLevel: 'info',
    stderrLevel: 'info',
  });
  if (buildResult.exitCode !== 0) {
    const detail = buildResult.stderr || buildResult.stdout;
    throw new Error(
      __('[ecosystem-runtime/{{logPrefix}}] docker build failed for "{{dockerfilePath}}":\n{{detail}}', { logPrefix, dockerfilePath, detail }),
    );
  }

  logger.tagged(logPrefix, `ecosystem-runtime/${logPrefix}`, `Project image built: ${image}`);

  return { image, entrypointOverride: '' };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when `docker image inspect <image>` exits 0 (image is present
 * in the local Docker daemon cache).
 */
async function probeImageExists(image: string): Promise<boolean> {
  try {
    await execFileAsync('docker', ['image', 'inspect', image]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Estimation failure is non-fatal.
 */
async function warnIfLargeContext(
  projectDir: string,
  logPrefix: string,
): Promise<void> {
  try {
    // Use `du` to sum the raw bytes of the project dir as a cheap proxy.
    // On macOS `du -sk` returns kilobytes; on Linux `du -sb` returns bytes.
    // We use `du -sk` for cross-platform compat and multiply by 1024.
    const { stdout } = await execFileAsync('du', ['-sk', projectDir]);
    const kb = parseInt(stdout.trim().split(/\s+/)[0] ?? '0', 10);
    const bytes = kb * 1024;
    if (bytes > LARGE_CONTEXT_THRESHOLD_BYTES) {
      const hasDockerignore = await fs
        .access(path.join(projectDir, '.dockerignore'))
        .then(() => true)
        .catch(() => false);
      if (!hasDockerignore) {
        const sizeMB = Math.round(bytes / (1024 * 1024));
        logger.tagged(logPrefix, `ecosystem-runtime/${logPrefix}`,
          __('Build context is large (~{{sizeMB}} MB). Consider adding a .dockerignore to exclude node_modules, vendor, .git, etc.', { sizeMB }),
          'warn',
        );
      }
    }
  } catch {
    // Estimation failure is non-fatal.
  }
}

