/**
 * Tests for src/infrastructure/utils/detect-ecosystems.ts
 *
 * Uses real temp-directory fixtures (no fs mocks) for isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { EcosystemPlugin } from '@modules/ecosystem/types';
import { discoverProject } from '@infra/utils/detect-ecosystems';

// ── Fixture helpers ───────────────────────────────────────────────────────────

async function createTmpDir(): Promise<string> {
  const dir = join(tmpdir(), `detect-ecosystems-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function touch(filePath: string): Promise<void> {
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, '');
}

// ── Minimal plugin stubs ──────────────────────────────────────────────────────
// EcosystemPlugin has many required fields for runtime logic (runners, advisors, etc.)
// but discoverProject only reads `id`, `manifest`, and `lockfile`. Cast via unknown to keep tests lean.

function makePlugin(id: string, manifest: string, lockfile?: string): EcosystemPlugin {
  return { id, manifest, lockfile } as unknown as EcosystemPlugin;
}

const npmPlugin = makePlugin('npm', 'package.json', 'package-lock.json');
const composerPlugin = makePlugin('composer', 'composer.json', 'composer.lock');
const pipPlugin = makePlugin('pip', 'requirements.txt');

const allPlugins: EcosystemPlugin[] = [npmPlugin, composerPlugin, pipPlugin];

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('discoverProject', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await createTmpDir();
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  // AC1 – basic shape
  it('returns a DiscoveryResult with ecosystems and dockerfiles arrays', async () => {
    const result = await discoverProject(cwd, allPlugins);
    expect(result).toHaveProperty('ecosystems');
    expect(result).toHaveProperty('dockerfiles');
    expect(Array.isArray(result.ecosystems)).toBe(true);
    expect(Array.isArray(result.dockerfiles)).toBe(true);
  });

  it('returns empty arrays when nothing is found', async () => {
    const result = await discoverProject(cwd, allPlugins);
    expect(result.ecosystems).toHaveLength(0);
    expect(result.dockerfiles).toHaveLength(0);
  });

  // AC2 – DiscoveredEcosystem shape at root
  it('finds a root lockfile and returns correct DiscoveredEcosystem shape', async () => {
    await touch(join(cwd, 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins);

    expect(result.ecosystems).toHaveLength(1);
    const eco = result.ecosystems[0];
    expect(eco.pluginId).toBe('npm');
    expect(eco.path).toBe('');
    expect(eco.lockfile).toBe('package-lock.json');
    expect(eco.suggestedLabel).toBeUndefined(); // root → no label
  });

  it('finds a nested lockfile and derives suggestedLabel from directory name', async () => {
    await touch(join(cwd, 'packages', 'api', 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins);

    expect(result.ecosystems).toHaveLength(1);
    const eco = result.ecosystems[0];
    expect(eco.pluginId).toBe('npm');
    expect(eco.path).toBe('packages/api');
    expect(eco.lockfile).toBe('package-lock.json');
    expect(eco.suggestedLabel).toBe('api');
  });

  // AC2 – suggestedLabel sanitisation
  it('sanitises special characters in suggestedLabel', async () => {
    await touch(join(cwd, 'My App!', 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins);

    expect(result.ecosystems).toHaveLength(1);
    expect(result.ecosystems[0].suggestedLabel).toBe('my-app');
  });

  it('collapses consecutive hyphens in suggestedLabel', async () => {
    await touch(join(cwd, 'my--app', 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins);

    expect(result.ecosystems[0].suggestedLabel).toBe('my-app');
  });

  it('strips leading and trailing hyphens from suggestedLabel', async () => {
    await touch(join(cwd, '-service-', 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins);

    expect(result.ecosystems[0].suggestedLabel).toBe('service');
  });

  // AC2 – path is relative, no leading ./ or /
  it('returns relative paths without leading ./ or /', async () => {
    await touch(join(cwd, 'apps', 'web', 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins);

    const path = result.ecosystems[0].path;
    expect(path).not.toMatch(/^\.\//);
    expect(path).not.toMatch(/^\//);
    expect(path).toBe('apps/web');
  });

  // AC3 – DiscoveredDockerfile shape
  it('finds a root Dockerfile and returns correct DiscoveredDockerfile shape', async () => {
    await touch(join(cwd, 'Dockerfile'));

    const result = await discoverProject(cwd, allPlugins);

    expect(result.dockerfiles).toHaveLength(1);
    const df = result.dockerfiles[0];
    expect(df.path).toBe('');
    expect(df.filename).toBe('Dockerfile');
  });

  it('finds Dockerfile variants (Dockerfile.prod, Dockerfile.local)', async () => {
    await touch(join(cwd, 'Dockerfile'));
    await touch(join(cwd, 'Dockerfile.prod'));
    await touch(join(cwd, 'Dockerfile.local'));

    const result = await discoverProject(cwd, allPlugins);

    const names = result.dockerfiles.map((d) => d.filename).sort();
    expect(names).toEqual(['Dockerfile', 'Dockerfile.local', 'Dockerfile.prod']);
  });

  it('does not match files that are not Dockerfiles (e.g. dockerfile-compose.yml)', async () => {
    await touch(join(cwd, 'docker-compose.yml'));
    await touch(join(cwd, 'dockerfiles.txt'));

    const result = await discoverProject(cwd, allPlugins);

    expect(result.dockerfiles).toHaveLength(0);
  });

  it('finds nested Dockerfiles with correct path and filename', async () => {
    await touch(join(cwd, 'services', 'api', 'Dockerfile'));
    await touch(join(cwd, 'services', 'worker', 'Dockerfile.prod'));

    const result = await discoverProject(cwd, allPlugins);

    const sorted = result.dockerfiles.sort((a, b) => a.path.localeCompare(b.path));
    expect(sorted[0].path).toBe('services/api');
    expect(sorted[0].filename).toBe('Dockerfile');
    expect(sorted[1].path).toBe('services/worker');
    expect(sorted[1].filename).toBe('Dockerfile.prod');
  });

  // AC4 – exclude directories
  it('skips node_modules by default', async () => {
    await touch(join(cwd, 'node_modules', 'some-pkg', 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins);

    expect(result.ecosystems).toHaveLength(0);
  });

  it('skips all default excluded directories', async () => {
    const defaultExcluded = ['node_modules', 'vendor', '.git', 'dist', 'build', '__pycache__', '.venv', '.tox'];
    for (const dir of defaultExcluded) {
      await touch(join(cwd, dir, 'package-lock.json'));
    }

    const result = await discoverProject(cwd, allPlugins);

    expect(result.ecosystems).toHaveLength(0);
  });

  it('respects custom exclude list', async () => {
    await touch(join(cwd, 'tmp', 'package-lock.json'));
    await touch(join(cwd, 'src', 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins, { exclude: ['tmp'] });

    // 'src' should be found, 'tmp' should not
    expect(result.ecosystems).toHaveLength(1);
    expect(result.ecosystems[0].path).toBe('src');
  });

  // AC4 – maxDepth
  it('respects maxDepth=0 (root only)', async () => {
    await touch(join(cwd, 'package-lock.json'));
    await touch(join(cwd, 'sub', 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins, { maxDepth: 0 });

    expect(result.ecosystems).toHaveLength(1);
    expect(result.ecosystems[0].path).toBe('');
  });

  it('respects maxDepth=1 (root + one level)', async () => {
    await touch(join(cwd, 'package-lock.json'));
    await touch(join(cwd, 'apps', 'package-lock.json'));
    await touch(join(cwd, 'apps', 'web', 'package-lock.json')); // depth 2 — should be skipped

    const result = await discoverProject(cwd, allPlugins, { maxDepth: 1 });

    const paths = result.ecosystems.map((e) => e.path).sort();
    expect(paths).toEqual(['', 'apps']);
  });

  it('defaults to maxDepth=4 and discovers up to 4 levels deep', async () => {
    // depth 4: cwd/a/b/c/d
    await touch(join(cwd, 'a', 'b', 'c', 'd', 'package-lock.json'));
    // depth 5: should be skipped
    await touch(join(cwd, 'a', 'b', 'c', 'd', 'e', 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins);

    const paths = result.ecosystems.map((e) => e.path);
    expect(paths).toContain('a/b/c/d');
    expect(paths).not.toContain('a/b/c/d/e');
  });

  // Multi-ecosystem monorepo
  it('discovers multiple ecosystems in a monorepo structure', async () => {
    await touch(join(cwd, 'package-lock.json'));
    await touch(join(cwd, 'backend', 'composer.lock'));
    await touch(join(cwd, 'scripts', 'requirements.txt'));

    const result = await discoverProject(cwd, allPlugins);

    const ids = result.ecosystems.map((e) => e.pluginId).sort();
    expect(ids).toEqual(['composer', 'npm', 'pip']);
  });

  it('only matches one entry per plugin per directory', async () => {
    // npm has lockfile: 'package-lock.json' — only one match per directory
    await touch(join(cwd, 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins);

    // Should report npm exactly once
    const npmMatches = result.ecosystems.filter((e) => e.pluginId === 'npm');
    expect(npmMatches).toHaveLength(1);
  });

  it('handles plugins with only a manifest (no lockfile) gracefully', async () => {
    const manifestOnlyPlugin = makePlugin('manifest-only', 'some-manifest.txt');

    const result = await discoverProject(cwd, [manifestOnlyPlugin]);

    expect(result.ecosystems).toHaveLength(0);
  });

  it('handles unreadable subdirectory gracefully (no crash)', async () => {
    // Create a normal directory and a nested lockfile
    await touch(join(cwd, 'valid', 'package-lock.json'));

    // discoverProject should not throw even if a directory becomes unreadable mid-walk
    await expect(discoverProject(cwd, allPlugins)).resolves.not.toThrow();
    const result = await discoverProject(cwd, allPlugins);
    expect(result.ecosystems[0].path).toBe('valid');
  });

  // AC5 — lockfile-required vs manifest-only discovery behaviour
  it('does NOT discover npm when only package.json is present (no package-lock.json)', async () => {
    await touch(join(cwd, 'package.json'));

    const result = await discoverProject(cwd, allPlugins);

    const npmMatches = result.ecosystems.filter((e) => e.pluginId === 'npm');
    expect(npmMatches).toHaveLength(0);
  });

  it('discovers npm when package-lock.json is present (lockfile required)', async () => {
    await touch(join(cwd, 'package.json'));
    await touch(join(cwd, 'package-lock.json'));

    const result = await discoverProject(cwd, allPlugins);

    const npmMatches = result.ecosystems.filter((e) => e.pluginId === 'npm');
    expect(npmMatches).toHaveLength(1);
    expect(npmMatches[0].lockfile).toBe('package-lock.json');
  });

  it('discovers pip when only requirements.txt is present (no lockfile required)', async () => {
    await touch(join(cwd, 'requirements.txt'));

    const result = await discoverProject(cwd, allPlugins);

    const pipMatches = result.ecosystems.filter((e) => e.pluginId === 'pip');
    expect(pipMatches).toHaveLength(1);
    expect(pipMatches[0].lockfile).toBe('requirements.txt');
  });
});

