/**
 * Tests for resolveEcosystemRuntime — build-based image resolution path.
 *
 * Covers:
 *  - build config calls buildProjectImage with correct args
 *  - entrypointOverride from buildProjectImage is forwarded to EphemeralEcosystemContainer
 *  - requiredBinaries (from spec.containerBinaries) are passed to buildProjectImage
 *  - build config without dockerfile throws (type-safe; build.dockerfile is required)
 *  - no build config (pull-based) does NOT call buildProjectImage
 *  - build.context and build.args forwarded correctly
 *  - build.target forwarded to buildProjectImage
 *  - image + build coexistence: imageTag is passed to buildProjectImage
 *
 * Runner config is passed as the 5th parameter to resolveEcosystemRuntime
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

import { resolveEcosystemRuntime } from '@infra/ecosystem-runtime/resolve';
import { CLI_NAME } from '@infra/brand';
import { EphemeralEcosystemContainer } from '@infra/ecosystem-runtime/ephemeral-container';
import { buildProjectImage } from '@infra/ecosystem-runtime/build-project-image';
import type { EcosystemPlugin } from '@modules/ecosystem/types';
import type { ProjectConfig, RunnerConfig } from '@core/types/config';
import type { CommandRunner } from '@core/types/common';

const MockContainer = vi.mocked(EphemeralEcosystemContainer);
const mockBuildProjectImage = vi.mocked(buildProjectImage);

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

  it('calls buildProjectImage with projectDir, dockerfilePath, logPrefix, and containerBinaries', async () => {
    mockBuildProjectImage.mockResolvedValue({
      image: `${CLI_NAME}-project/build:abc123`,
      entrypointOverride: '',
    });

    const plugin = makePlugin();
    const runnerConfig: RunnerConfig = {
      build: { dockerfile: '.docker/node.Dockerfile' },
    };

    await resolveEcosystemRuntime(plugin, makeHostRunner(), makeConfig(), '/my/project', runnerConfig);

    expect(mockBuildProjectImage).toHaveBeenCalledOnce();
    expect(mockBuildProjectImage).toHaveBeenCalledWith({
      projectDir: '/my/project',
      dockerfilePath: '.docker/node.Dockerfile',
      logPrefix: 'npm',
      requiredBinaries: ['npm', 'npx'],
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

    await resolveEcosystemRuntime(plugin, makeHostRunner(), makeConfig(), '/project', runnerConfig);

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

    await resolveEcosystemRuntime(plugin, makeHostRunner(), makeConfig(), '/project', runnerConfig);

    expect(mockBuildProjectImage).not.toHaveBeenCalled();
  });

  it('does NOT call buildProjectImage when runnerConfig is absent (defaults to pull)', async () => {
    const plugin = makePlugin();

    await resolveEcosystemRuntime(plugin, makeHostRunner(), makeConfig(), '/project');

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

    await resolveEcosystemRuntime(plugin, makeHostRunner(), makeConfig(), '/project', runnerConfig);

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

    await resolveEcosystemRuntime(plugin, makeHostRunner(), makeConfig(), '/my/project', runnerConfig);

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

    await resolveEcosystemRuntime(plugin, makeHostRunner(), makeConfig(), '/my/project', runnerConfig);

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

    await resolveEcosystemRuntime(plugin, makeHostRunner(), makeConfig(), '/my/project', runnerConfig);

    expect(mockBuildProjectImage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: customTag,
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. requiredBinaries from plugin spec (composer plugin)
  // ─────────────────────────────────────────────────────────────────────────────

  it('passes requiredBinaries derived from spec.containerBinaries (composer plugin)', async () => {
    mockBuildProjectImage.mockResolvedValue({
      image: `${CLI_NAME}-project/build:abc`,
      entrypointOverride: '',
    });

    const composerPlugin = makePlugin({
      id: 'composer',
      runtimeSpec: {
        defaultImage: 'composer:2',
        resolveImage: () => 'php:8.2-cli',
        containerBinaries: ['composer', 'php'],
        runMode: { kind: 'shell-wrap' },
      },
    });
    const runnerConfig: RunnerConfig = {
      build: { dockerfile: '.docker/php.Dockerfile' },
    } as unknown as RunnerConfig;

    await resolveEcosystemRuntime(composerPlugin, makeHostRunner(), makeConfig(), '/project', runnerConfig);

    expect(mockBuildProjectImage).toHaveBeenCalledWith(
      expect.objectContaining({ requiredBinaries: ['composer', 'php'] }),
    );
  });
});
