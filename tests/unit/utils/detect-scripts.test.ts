import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { detectProjectScripts } from '@infra/utils/detect-scripts';

const mockReadFile = vi.mocked(readFile);

// ─── npm ecosystem ────────────────────────────────────────────────────────────

describe('detectProjectScripts — npm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads package.json scripts and returns DetectedScript[] with correct commands', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        scripts: {
          test: 'jest',
          build: 'tsc',
          lint: 'eslint .',
        },
      }) as any,
    );

    const result = await detectProjectScripts('/repo', 'npm');

    expect(result).toHaveLength(3);
    expect(result.find((s) => s.name === 'test')).toBeDefined();
    expect(result.find((s) => s.name === 'build')).toBeDefined();
    expect(result.find((s) => s.name === 'lint')).toBeDefined();
  });

  it('uses "npm test" (short form) for the "test" script — not "npm run test"', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ scripts: { test: 'jest' } }) as any,
    );

    const result = await detectProjectScripts('/repo', 'npm');

    const testScript = result.find((s) => s.name === 'test');
    expect(testScript).toBeDefined();
    expect(testScript!.command).toBe('npm test');
  });

  it('uses "npm run <name>" for non-built-in scripts', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ scripts: { build: 'tsc', lint: 'eslint .' } }) as any,
    );

    const result = await detectProjectScripts('/repo', 'npm');

    const buildScript = result.find((s) => s.name === 'build');
    expect(buildScript!.command).toBe('npm run build');

    const lintScript = result.find((s) => s.name === 'lint');
    expect(lintScript!.command).toBe('npm run lint');
  });

  it('excludes dev, start, watch, serve, preview, prepare, postinstall, preinstall scripts', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        scripts: {
          dev: 'vite',
          start: 'node server.js',
          watch: 'tsc --watch',
          serve: 'serve dist',
          preview: 'vite preview',
          prepare: 'husky install',
          postinstall: 'patch-package',
          preinstall: 'check-node-version',
          test: 'jest',
        },
      }) as any,
    );

    const result = await detectProjectScripts('/repo', 'npm');

    const names = result.map((s) => s.name);
    expect(names).not.toContain('dev');
    expect(names).not.toContain('start');
    expect(names).not.toContain('watch');
    expect(names).not.toContain('serve');
    expect(names).not.toContain('preview');
    expect(names).not.toContain('prepare');
    expect(names).not.toContain('postinstall');
    expect(names).not.toContain('preinstall');
    expect(names).toContain('test');
  });

  it('marks test, build, lint, check, typecheck, ci, verify scripts as recommended', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        scripts: {
          test: 'jest',
          build: 'tsc',
          lint: 'eslint .',
          check: 'tsc --noEmit',
          typecheck: 'tsc --noEmit',
          ci: 'npm run lint && npm test',
          verify: 'npm run check && npm test',
          format: 'prettier --write .',
        },
      }) as any,
    );

    const result = await detectProjectScripts('/repo', 'npm');

    expect(result.find((s) => s.name === 'test')?.recommended).toBe(true);
    expect(result.find((s) => s.name === 'build')?.recommended).toBe(true);
    expect(result.find((s) => s.name === 'lint')?.recommended).toBe(true);
    expect(result.find((s) => s.name === 'check')?.recommended).toBe(true);
    expect(result.find((s) => s.name === 'typecheck')?.recommended).toBe(true);
    expect(result.find((s) => s.name === 'ci')?.recommended).toBe(true);
    expect(result.find((s) => s.name === 'verify')?.recommended).toBe(true);
    // format is not a recommended validation script
    expect(result.find((s) => s.name === 'format')?.recommended).toBe(false);
  });

  it('marks scoped scripts like "test:unit" and "lint:fix" with correct recommended flag', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        scripts: {
          'test:unit': 'jest --testPathPattern=unit',
          'test:integration': 'jest --testPathPattern=integration',
          'lint:fix': 'eslint . --fix',
        },
      }) as any,
    );

    const result = await detectProjectScripts('/repo', 'npm');

    expect(result.find((s) => s.name === 'test:unit')?.recommended).toBe(true);
    expect(result.find((s) => s.name === 'test:integration')?.recommended).toBe(true);
    expect(result.find((s) => s.name === 'lint:fix')?.recommended).toBe(true);
  });

  it('returns [] when package.json is not found', async () => {
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    const result = await detectProjectScripts('/repo', 'npm');

    expect(result).toEqual([]);
  });

  it('returns [] when package.json has no scripts field', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ name: 'my-project', version: '1.0.0' }) as any,
    );

    const result = await detectProjectScripts('/repo', 'npm');

    expect(result).toEqual([]);
  });

  it('returns [] when package.json scripts field is null', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ scripts: null }) as any,
    );

    const result = await detectProjectScripts('/repo', 'npm');

    expect(result).toEqual([]);
  });

  it('returns [] when package.json is malformed JSON', async () => {
    mockReadFile.mockResolvedValueOnce('{ not valid json' as any);

    const result = await detectProjectScripts('/repo', 'npm');

    expect(result).toEqual([]);
  });

  it('skips script entries whose value is not a string', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ scripts: { test: 'jest', badEntry: 42 } }) as any,
    );

    const result = await detectProjectScripts('/repo', 'npm');

    const names = result.map((s) => s.name);
    expect(names).toContain('test');
    expect(names).not.toContain('badEntry');
  });

  it('reads file from the correct path (relative to cwd)', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ scripts: {} }) as any);

    await detectProjectScripts('/my/project', 'npm');

    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('/my/project/package.json'),
      'utf-8',
    );
  });
});

// ─── composer ecosystem ───────────────────────────────────────────────────────

describe('detectProjectScripts — composer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads composer.json scripts and returns DetectedScript[] with correct commands', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        scripts: {
          test: 'vendor/bin/phpunit',
          lint: 'vendor/bin/phpcs',
          analyse: 'vendor/bin/phpstan analyse',
        },
      }) as any,
    );

    const result = await detectProjectScripts('/repo', 'composer');

    expect(result).toHaveLength(3);
    expect(result.find((s) => s.name === 'test')).toBeDefined();
    expect(result.find((s) => s.name === 'lint')).toBeDefined();
    expect(result.find((s) => s.name === 'analyse')).toBeDefined();
  });

  it('formats composer commands as "composer run-script <name>"', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        scripts: {
          test: 'vendor/bin/phpunit',
          lint: 'vendor/bin/phpcs',
        },
      }) as any,
    );

    const result = await detectProjectScripts('/repo', 'composer');

    const testScript = result.find((s) => s.name === 'test');
    expect(testScript!.command).toBe('composer run-script test');

    const lintScript = result.find((s) => s.name === 'lint');
    expect(lintScript!.command).toBe('composer run-script lint');
  });

  it('accepts scripts whose values are arrays (multi-command composer scripts)', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        scripts: {
          test: ['vendor/bin/phpunit', 'vendor/bin/phpcs'],
          build: 'echo done',
        },
      }) as any,
    );

    const result = await detectProjectScripts('/repo', 'composer');

    const names = result.map((s) => s.name);
    expect(names).toContain('test');
    expect(names).toContain('build');
  });

  it('excludes dev, start, watch, serve, prepare scripts for composer too', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        scripts: {
          dev: 'php artisan serve',
          watch: 'vite',
          test: 'vendor/bin/phpunit',
        },
      }) as any,
    );

    const result = await detectProjectScripts('/repo', 'composer');

    const names = result.map((s) => s.name);
    expect(names).not.toContain('dev');
    expect(names).not.toContain('watch');
    expect(names).toContain('test');
  });

  it('marks test, build, lint as recommended for composer', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        scripts: {
          test: 'vendor/bin/phpunit',
          lint: 'vendor/bin/phpcs',
          analyse: 'vendor/bin/phpstan analyse',
        },
      }) as any,
    );

    const result = await detectProjectScripts('/repo', 'composer');

    expect(result.find((s) => s.name === 'test')?.recommended).toBe(true);
    expect(result.find((s) => s.name === 'lint')?.recommended).toBe(true);
    // analyse is not in the recommended patterns list
    expect(result.find((s) => s.name === 'analyse')?.recommended).toBe(false);
  });

  it('returns [] when composer.json is not found', async () => {
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    const result = await detectProjectScripts('/repo', 'composer');

    expect(result).toEqual([]);
  });

  it('returns [] when composer.json has no scripts field', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ name: 'my/project' }) as any,
    );

    const result = await detectProjectScripts('/repo', 'composer');

    expect(result).toEqual([]);
  });

  it('reads file from the correct path (relative to cwd)', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ scripts: {} }) as any);

    await detectProjectScripts('/my/php-project', 'composer');

    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('/my/php-project/composer.json'),
      'utf-8',
    );
  });
});

// ─── pip and unknown ecosystems ───────────────────────────────────────────────

describe('detectProjectScripts — pip and unknown ecosystems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] for pip ecosystem without reading any file', async () => {
    const result = await detectProjectScripts('/repo', 'pip');

    expect(result).toEqual([]);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('returns [] for unknown ecosystem without reading any file', async () => {
    const result = await detectProjectScripts('/repo', 'ruby');

    expect(result).toEqual([]);
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
