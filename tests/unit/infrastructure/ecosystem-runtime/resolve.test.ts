/**
 * Tests for resolveEcosystemRuntime — build-based image resolution path.
 *
 * Covers:
 *  - build config calls buildProjectImage with correct args
 *  - entrypointOverride from buildProjectImage is forwarded to EphemeralEcosystemContainer
 *  - build config without dockerfile throws (type-safe; build.dockerfile is required)
 *  - no build config (pull-based) does NOT call buildProjectImage
 *  - build.context and build.args forwarded correctly
 *  - build.target forwarded to buildProjectImage
 *  - image + build coexistence: imageTag is passed to buildProjectImage
 *
 * Runner config is passed via the options object as runnerConfig
 * (per-ecosystem inline config from ecosystems[].runner).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@infra/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), phase: vi.fn(), skip: vi.fn(), header: vi.fn(), tagged: vi.fn() },
}));

vi.mock('@infra/ecosystem-runtime/ephemeral-container', () => ({
  EphemeralEcosystemContainer: vi.fn(),
}));

vi.mock('@infra/ecosystem-runtime/command-runner', () => ({
  EcosystemContainerCommandRunner: vi.fn().mockImplementation(function () { return {}; }),
}));

vi.mock('@infra/ecosystem-runtime/build-project-image', () => ({
  buildProjectImage: vi.fn(),
}));

vi.mock('@infra/utils/infer-version', () => ({
  inferVersionFromSources: vi.fn(),
}));

import type { CommandRunner } from '@core/types/common';
import type { ProjectConfig, RunnerConfig } from '@core/types/config';
import { CLI_NAME } from '@infra/brand';
import { buildProjectImage } from '@infra/ecosystem-runtime/build-project-image';
import { EphemeralEcosystemContainer } from '@infra/ecosystem-runtime/ephemeral-container';
import { resolveEcosystemRuntime } from '@infra/ecosystem-runtime/resolve';
import { inferVersionFromSources } from '@infra/utils/infer-version';
import { logger } from '@infra/utils/logger';
import type { EcosystemPlugin } from '@modules/ecosystem/types';

const MockContainer = vi.mocked(EphemeralEcosystemContainer);
const mockBuildProjectImage = vi.mocked(buildProjectImage);
const mockInferVersion = vi.mocked(inferVersionFromSources);

function makeHostRunner(): CommandRunner {
  return {
    dryRun: false,
    environment: 'local',
    run: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, command: '', dryRun: false }),
    runArgs: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, command: '', dryRun: false }),
  };
}

function makePlugin(overrides: Partial<EcosystemPlugin> = {}): EcosystemPlugin {
  return {
    id: 'npm',
    name: 'npm',
    lockfiles: ['package.json', 'package-lock.json'],
    osvEcosystems: ['npm'],
    reportLabel: 'npm',
    runtimeSpec: {
      defaultImage: 'node:lts',
      resolveImage: () => 'node:lts',
      containerBinaries: ['npm', 'npx'],
      runMode: { kind: 'direct-exec', binary: 'npm' },
    },
    buildScanArgs: () => [],
    getProtectedPackages: () => [],
    runUpdater: vi.fn(),
    ...overrides,
  };
}

function makeRuntimeSpec(overrides: Record<string, unknown> = {}): EcosystemPlugin['runtimeSpec'] {
  return {
    defaultImage: 'node:lts',
    resolveImage: () => 'node:lts',
    containerBinaries: ['npm', 'npx'],
    runMode: { kind: 'direct-exec', binary: 'npm' },
    ...overrides,
  } as EcosystemPlugin['runtimeSpec'];
}

function makeConfig(): ProjectConfig {
  return {
    project: { name: 'Test', client: 'Test' },
    ecosystems: [{ id: 'npm' }],
    protected_packages: {},
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: false,
    },
    conflict_resolution: 'manual',
  };
}

describe('resolveEcosystemRuntime — build-based image resolution', () => {
  beforeEach(() => {
    MockContainer.mockClear();
    MockContainer.mockImplementation(function () { return {} as any; });
    mockBuildProjectImage.mockReset();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Basic build config → calls buildProjectImage with correct args
  // ─────────────────────────────────────────────────────────────────────────────

  it('calls buildProjectImage with projectDir, dockerfilePath, logPrefix, and build options', async () => {
    mockBuildProjectImage.mockResolvedValue({
      image: `${CLI_NAME}-project/build:abc123`,
      entrypointOverride: '',
    });

    const plugin = makePlugin();
    const runnerConfig: RunnerConfig = {
      build: { dockerfile: '.docker/node.Dockerfile' },
    };

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/my/project', runnerConfig });

    expect(mockBuildProjectImage).toHaveBeenCalledOnce();
    expect(mockBuildProjectImage).toHaveBeenCalledWith({
      projectDir: '/my/project',
      dockerfilePath: '.docker/node.Dockerfile',
      logPrefix: 'npm',
      buildContext: undefined,
      buildArgs: undefined,
      allowBuildContextEscape: undefined,
      target: undefined,
      imageTag: undefined,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. entrypointOverride is forwarded to EphemeralEcosystemContainer
  // ─────────────────────────────────────────────────────────────────────────────

  it('forwards entrypointOverride from buildProjectImage result to EphemeralEcosystemContainer', async () => {
    mockBuildProjectImage.mockResolvedValue({
      image: `${CLI_NAME}-project/build:abc123`,
      entrypointOverride: '',
    });

    const plugin = makePlugin();
    const runnerConfig: RunnerConfig = {
      build: { dockerfile: 'Dockerfile' },
    };

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project', runnerConfig });

    const containerOptions = (MockContainer as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(containerOptions.entrypointOverride).toBe('');
    expect(containerOptions.image).toBe(`${CLI_NAME}-project/build:abc123`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Pull-based: no build config → buildProjectImage NOT called
  // ─────────────────────────────────────────────────────────────────────────────

  it('does NOT call buildProjectImage when build is absent (pull-based with language_version)', async () => {
    const plugin = makePlugin();
    const runnerConfig: RunnerConfig = { language_version: '20' };

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project', runnerConfig });

    expect(mockBuildProjectImage).not.toHaveBeenCalled();
  });

  it('does NOT call buildProjectImage when runnerConfig is absent (defaults to pull)', async () => {
    const plugin = makePlugin();

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project' });

    expect(mockBuildProjectImage).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Built image is used (not spec default)
  // ─────────────────────────────────────────────────────────────────────────────

  it('uses the image returned by buildProjectImage (not the spec default image)', async () => {
    const projectBuiltImage = `${CLI_NAME}-project/build:deadbeef1234`;
    mockBuildProjectImage.mockResolvedValue({
      image: projectBuiltImage,
      entrypointOverride: '',
    });

    const plugin = makePlugin();
    const runnerConfig: RunnerConfig = { build: { dockerfile: 'Dockerfile' } };

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project', runnerConfig });

    const containerOptions = (MockContainer as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(containerOptions.image).toBe(projectBuiltImage);
    // Must NOT be the spec default
    expect(containerOptions.image).not.toBe('node:lts');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. build.context and build.args forwarded
  // ─────────────────────────────────────────────────────────────────────────────

  it('forwards build.context and build.args from runner config to buildProjectImage', async () => {
    mockBuildProjectImage.mockResolvedValue({
      image: `${CLI_NAME}-project/build:abc123`,
      entrypointOverride: '',
    });

    const plugin = makePlugin();
    const runnerConfig: RunnerConfig = {
      build: {
        dockerfile: 'Dockerfile',
        context: '../',
        args: { NODE_VERSION: '20' },
      },
    };

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/my/project', runnerConfig });

    expect(mockBuildProjectImage).toHaveBeenCalledWith(
      expect.objectContaining({
        buildContext: '../',
        buildArgs: { NODE_VERSION: '20' },
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. build.target forwarded to buildProjectImage
  // ─────────────────────────────────────────────────────────────────────────────

  it('forwards build.target from runner config to buildProjectImage', async () => {
    mockBuildProjectImage.mockResolvedValue({
      image: `${CLI_NAME}-project/build:aabbccddee00`,
      entrypointOverride: '',
    });

    const plugin = makePlugin();
    const runnerConfig: RunnerConfig = {
      build: {
        dockerfile: 'Dockerfile',
        target: 'node-stage',
      },
    };

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/my/project', runnerConfig });

    expect(mockBuildProjectImage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'node-stage',
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. image + build coexistence — imageTag is passed to buildProjectImage
  // ─────────────────────────────────────────────────────────────────────────────

  it('passes imageTag to buildProjectImage when both image and build are set', async () => {
    const customTag = 'myregistry.io/myapp:latest';
    mockBuildProjectImage.mockResolvedValue({
      image: customTag,
      entrypointOverride: '',
    });

    const plugin = makePlugin();
    const runnerConfig: RunnerConfig = {
      image: customTag,
      build: { dockerfile: 'Dockerfile' },
    };

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/my/project', runnerConfig });

    expect(mockBuildProjectImage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: customTag,
      }),
    );
  });

});

describe('resolveEcosystemRuntime — runtimeSpec guard', () => {
  it('throws when the plugin has no runtimeSpec configured', async () => {
    const plugin = makePlugin({ runtimeSpec: undefined });

    await expect(
      resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project' }),
    ).rejects.toThrow(/runtimeSpec/);
  });
});

describe('resolveEcosystemRuntime — pull-based image resolution precedence', () => {
  beforeEach(() => {
    MockContainer.mockClear();
    MockContainer.mockImplementation(function () { return {} as any; });
    mockInferVersion.mockReset();
    vi.mocked(logger.warn).mockClear();
  });

  it.each([
    {
      label: 'the explicit runner image (highest priority, skips version resolution entirely)',
      runnerConfig: { image: 'custom/npm:pinned', language_version: '18' } as RunnerConfig,
      versionSources: undefined,
      inferredVersion: undefined,
      expectedImage: 'custom/npm:pinned',
      resolveImageCalled: false,
      inferCalled: false,
    },
    {
      label: 'language_version when no explicit image is configured',
      runnerConfig: { language_version: '20' } as RunnerConfig,
      versionSources: undefined,
      inferredVersion: undefined,
      expectedImage: 'node:20',
      resolveImageCalled: true,
      inferCalled: false,
    },
    {
      label: 'the inferred version when language_version is absent',
      runnerConfig: undefined,
      versionSources: [{ file: '.nvmrc', extract: (c: string) => c, label: '.nvmrc' }],
      inferredVersion: '16',
      expectedImage: 'node:16',
      resolveImageCalled: true,
      inferCalled: true,
    },
    {
      label: 'the plugin default when no version is configured or inferred',
      runnerConfig: undefined,
      versionSources: undefined,
      inferredVersion: undefined,
      expectedImage: 'node:lts',
      resolveImageCalled: true,
      inferCalled: true,
    },
  ])('resolves the image from $label', async ({ runnerConfig, versionSources, inferredVersion, expectedImage, resolveImageCalled, inferCalled }) => {
    mockInferVersion.mockResolvedValue(inferredVersion);
    const resolveImage = vi.fn((v?: string) => (v ? `node:${v}` : 'node:lts'));
    const plugin = makePlugin({ versionSources, runtimeSpec: makeRuntimeSpec({ resolveImage }) });

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project', runnerConfig });

    const containerOptions = (MockContainer as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(containerOptions.image).toBe(expectedImage);
    expect(resolveImage).toHaveBeenCalledTimes(resolveImageCalled ? 1 : 0);
    expect(mockInferVersion).toHaveBeenCalledTimes(inferCalled ? 1 : 0);
  });

  it.each([
    { pluginId: 'pip', shouldWarn: true },
    { pluginId: 'composer', shouldWarn: false },
  ])('warn-on-no-version behaviour for plugin id=$pluginId', async ({ pluginId, shouldWarn }) => {
    mockInferVersion.mockResolvedValue(undefined);
    const plugin = makePlugin({ id: pluginId });

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project' });

    if (shouldWarn) {
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No language_version configured'));
    } else {
      expect(logger.warn).not.toHaveBeenCalled();
    }
  });
});

describe('resolveEcosystemRuntime — native_deps preamble composition', () => {
  beforeEach(() => {
    MockContainer.mockClear();
    MockContainer.mockImplementation(function () { return {} as any; });
  });

  it('injects a bare apt-get install command when the runMode has no existing preamble', async () => {
    const plugin = makePlugin();
    const runnerConfig: RunnerConfig = { native_deps: ['libvips-dev'] };

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project', runnerConfig });

    const containerOptions = (MockContainer as Mock).mock.calls[0][0] as { runMode: { preamble?: (image: string) => string | undefined } };
    const composed = containerOptions.runMode.preamble?.('node:lts');
    expect(composed).toBe(
      'apt-get update -qq -o APT::Sandbox::User=root && apt-get install -y --no-install-recommends -o APT::Sandbox::User=root libvips-dev',
    );
  });

  it('prepends the apt-get install command to an existing preamble', async () => {
    const plugin = makePlugin({
      runtimeSpec: makeRuntimeSpec({
        runMode: { kind: 'direct-exec', binary: 'npm', preamble: (img: string) => `echo preparing ${img}` },
      }),
    });
    const runnerConfig: RunnerConfig = { native_deps: ['libvips-dev', 'ca-certificates'] };

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project', runnerConfig });

    const containerOptions = (MockContainer as Mock).mock.calls[0][0] as { runMode: { preamble?: (image: string) => string | undefined } };
    const composed = containerOptions.runMode.preamble?.('node:lts');
    expect(composed).toBe(
      'apt-get update -qq -o APT::Sandbox::User=root && apt-get install -y --no-install-recommends -o APT::Sandbox::User=root libvips-dev ca-certificates && echo preparing node:lts',
    );
  });

  it('leaves runMode unchanged when native_deps is absent', async () => {
    const plugin = makePlugin();

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project' });

    const containerOptions = (MockContainer as Mock).mock.calls[0][0] as { runMode: unknown };
    expect(containerOptions.runMode).toBe(plugin.runtimeSpec!.runMode);
  });
});

describe('resolveEcosystemRuntime — mountReadonly forwarding', () => {
  beforeEach(() => {
    MockContainer.mockClear();
    MockContainer.mockImplementation(function () { return {} as any; });
  });

  it('forwards mountReadonly=true from the runtimeSpec to the container', async () => {
    const plugin = makePlugin({ runtimeSpec: makeRuntimeSpec({ mountReadonly: true }) });

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project' });

    const containerOptions = (MockContainer as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(containerOptions.readonly).toBe(true);
  });

  it('defaults readonly to false when the runtimeSpec omits mountReadonly', async () => {
    const plugin = makePlugin();

    await resolveEcosystemRuntime({ plugin, hostRunner: makeHostRunner(), config: makeConfig(), cwd: '/project' });

    const containerOptions = (MockContainer as Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(containerOptions.readonly).toBe(false);
  });
});

