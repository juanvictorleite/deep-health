import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

import {
  ComposerReachabilityAdapter,
  normalizeComposerConstraint,
} from '@modules/ecosystem/plugins/composer-reachability';
import { collectComposerLockfileConstraints } from '@modules/ecosystem/utils/lockfile-inspect';

const mockedReadFile = readFile as unknown as ReturnType<typeof vi.fn>;

// ─── Fixtures ────────────────────────────────────────────────────────────────

// laravel/framework requires nesbot/carbon ^2.72 — blocks upgrade to 3.0.0
const COMPOSER_LOCK_CARBON_BLOCKED = JSON.stringify({
  'packages': [
    {
      name: 'laravel/framework',
      version: 'v10.48.0',
      require: {
        'php': '>=8.1',
        'ext-mbstring': '*',
        'nesbot/carbon': '^2.72',
      },
    },
    {
      name: 'nesbot/carbon',
      version: 'v2.72.0',
      require: {
        'php': '>=7.4',
        'ext-json': '*',
      },
    },
  ],
  'packages-dev': [],
});

// some-package requires symfony/http-foundation ^6.0 — satisfies 6.4.0
const COMPOSER_LOCK_HTTP_FOUNDATION_REACHABLE = JSON.stringify({
  'packages': [
    {
      name: 'some-package',
      version: 'v1.0.0',
      require: {
        'symfony/http-foundation': '^6.0',
      },
    },
    {
      name: 'symfony/http-foundation',
      version: 'v6.0.0',
      require: {
        'php': '>=8.1',
      },
    },
  ],
  'packages-dev': [],
});

// Dev dependency also declares a constraint on a production package
const COMPOSER_LOCK_DEV_CONSTRAINS_PROD = JSON.stringify({
  'packages': [
    {
      name: 'nesbot/carbon',
      version: 'v2.72.0',
      require: {
        'php': '>=7.4',
      },
    },
  ],
  'packages-dev': [
    {
      name: 'phpunit/phpunit',
      version: 'v10.0.0',
      require: {
        'nesbot/carbon': '^2.0',
      },
    },
  ],
});

// Multiple parents blocking the same package
const COMPOSER_LOCK_MULTI_PARENT_BLOCKED = JSON.stringify({
  'packages': [
    {
      name: 'parent-a',
      version: 'v1.0.0',
      require: {
        'nesbot/carbon': '^2.0',
      },
    },
    {
      name: 'parent-b',
      version: 'v1.0.0',
      require: {
        'nesbot/carbon': '>=2.0 <3.0',
      },
    },
    {
      name: 'nesbot/carbon',
      version: 'v2.72.0',
      require: {},
    },
  ],
  'packages-dev': [],
});

// Only platform requirements — no real package constraints
const COMPOSER_LOCK_PLATFORM_ONLY = JSON.stringify({
  'packages': [
    {
      name: 'some/package',
      version: 'v1.0.0',
      require: {
        'php': '>=8.1',
        'ext-json': '*',
        'ext-mbstring': '*',
        'lib-pcre': '>=8.0',
      },
    },
  ],
  'packages-dev': [],
});

// ─── normalizeComposerConstraint ─────────────────────────────────────────────

describe('normalizeComposerConstraint', () => {
  it('replaces commas with spaces (Composer AND → semver range)', () => {
    expect(normalizeComposerConstraint('>=1.0,<2.0')).toBe('>=1.0 <2.0');
  });

  it('replaces single pipe with || (Composer OR → semver OR)', () => {
    expect(normalizeComposerConstraint('^1.0|^2.0')).toBe('^1.0||^2.0');
  });

  it('does not double-replace already-double pipes', () => {
    expect(normalizeComposerConstraint('^1.0||^2.0')).toBe('^1.0||^2.0');
  });

  it('strips v prefix from version-like tokens', () => {
    expect(normalizeComposerConstraint('>=v1.0,<v2.0')).toBe('>=1.0 <2.0');
  });

  it('strips v prefix when constraint starts with v', () => {
    expect(normalizeComposerConstraint('v1.2.3')).toBe('1.2.3');
  });

  it('leaves already-valid semver ranges unchanged', () => {
    expect(normalizeComposerConstraint('^2.72')).toBe('^2.72');
    expect(normalizeComposerConstraint('>=1.0.0')).toBe('>=1.0.0');
    expect(normalizeComposerConstraint('~8.4.31')).toBe('~8.4.31');
  });

  it('handles complex constraints with commas and pipes', () => {
    expect(normalizeComposerConstraint('>=1.0,<2.0|^3.0')).toBe('>=1.0 <2.0||^3.0');
  });

  it('handles spaces around operators without doubling', () => {
    expect(normalizeComposerConstraint('^1.0 || ^2.0')).toBe('^1.0 || ^2.0');
  });

  it('handles wildcard constraint', () => {
    expect(normalizeComposerConstraint('*')).toBe('*');
  });
});

// ─── collectComposerLockfileConstraints ──────────────────────────────────────

describe('collectComposerLockfileConstraints', () => {
  it('builds constraint map from packages array', () => {
    const map = collectComposerLockfileConstraints(COMPOSER_LOCK_CARBON_BLOCKED);
    expect(map.has('nesbot/carbon')).toBe(true);
    const carbonParents = map.get('nesbot/carbon')!;
    expect(carbonParents.get('laravel/framework')).toBe('^2.72');
  });

  it('skips php platform requirement', () => {
    const map = collectComposerLockfileConstraints(COMPOSER_LOCK_CARBON_BLOCKED);
    expect(map.has('php')).toBe(false);
  });

  it('skips ext-* platform requirements', () => {
    const map = collectComposerLockfileConstraints(COMPOSER_LOCK_CARBON_BLOCKED);
    expect(map.has('ext-mbstring')).toBe(false);
    expect(map.has('ext-json')).toBe(false);
  });

  it('skips lib-* platform requirements', () => {
    const map = collectComposerLockfileConstraints(COMPOSER_LOCK_PLATFORM_ONLY);
    expect(map.has('lib-pcre')).toBe(false);
  });

  it('returns empty map when all constraints are platform requirements', () => {
    const map = collectComposerLockfileConstraints(COMPOSER_LOCK_PLATFORM_ONLY);
    // some/package has no non-platform deps — expect no real package entries
    expect(map.size).toBe(0);
  });

  it('also scans packages-dev array', () => {
    const map = collectComposerLockfileConstraints(COMPOSER_LOCK_DEV_CONSTRAINS_PROD);
    expect(map.has('nesbot/carbon')).toBe(true);
    const carbonParents = map.get('nesbot/carbon')!;
    expect(carbonParents.get('phpunit/phpunit')).toBe('^2.0');
  });

  it('returns empty map on malformed JSON', () => {
    const map = collectComposerLockfileConstraints('NOT JSON {{{');
    expect(map.size).toBe(0);
  });

  it('returns empty map when packages array is empty', () => {
    const map = collectComposerLockfileConstraints(
      JSON.stringify({ packages: [], 'packages-dev': [] }),
    );
    expect(map.size).toBe(0);
  });

  it('returns empty map on JSON that is not an object', () => {
    expect(collectComposerLockfileConstraints('"just a string"').size).toBe(0);
    expect(collectComposerLockfileConstraints('[1,2,3]').size).toBe(0);
  });

  it('handles packages with no require field gracefully', () => {
    const lockContent = JSON.stringify({
      packages: [{ name: 'some/pkg', version: 'v1.0.0' }],
      'packages-dev': [],
    });
    expect(() => collectComposerLockfileConstraints(lockContent)).not.toThrow();
    const map = collectComposerLockfileConstraints(lockContent);
    expect(map.size).toBe(0);
  });

  it('collects constraints from multiple parents for same dep', () => {
    const map = collectComposerLockfileConstraints(COMPOSER_LOCK_MULTI_PARENT_BLOCKED);
    const carbonParents = map.get('nesbot/carbon')!;
    expect(carbonParents.get('parent-a')).toBe('^2.0');
    expect(carbonParents.get('parent-b')).toBe('>=2.0 <3.0');
  });
});

// ─── ComposerReachabilityAdapter ─────────────────────────────────────────────

describe('ComposerReachabilityAdapter.ecosystemId', () => {
  it('is "composer"', () => {
    const adapter = new ComposerReachabilityAdapter();
    expect(adapter.ecosystemId).toBe('composer');
  });
});

describe('ComposerReachabilityAdapter.checkReachability — file errors', () => {
  beforeEach(() => mockedReadFile.mockReset());

  it('returns all reachable when readFile returns non-string (missing file simulation)', async () => {
    mockedReadFile.mockResolvedValue(null);
    const adapter = new ComposerReachabilityAdapter();
    const result = await adapter.checkReachability(['nesbot/carbon@3.0.0'], { cwd: '/app' });
    expect(result).toEqual([{ packageRef: 'nesbot/carbon@3.0.0', reachable: true }]);
  });

  it('returns all reachable when composer.lock contains invalid JSON', async () => {
    mockedReadFile.mockResolvedValue('NOT JSON {{{');
    const adapter = new ComposerReachabilityAdapter();
    const result = await adapter.checkReachability(['nesbot/carbon@3.0.0'], { cwd: '/app' });
    expect(result).toEqual([{ packageRef: 'nesbot/carbon@3.0.0', reachable: true }]);
  });

  it('returns reachable when no constraints exist for the package', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_HTTP_FOUNDATION_REACHABLE);
    const adapter = new ComposerReachabilityAdapter();
    const result = await adapter.checkReachability(['nesbot/carbon@3.0.0'], { cwd: '/app' });
    expect(result[0]).toMatchObject({ packageRef: 'nesbot/carbon@3.0.0', reachable: true });
  });
});

describe('ComposerReachabilityAdapter.checkReachability — blocked scenarios', () => {
  beforeEach(() => mockedReadFile.mockReset());

  it('AC3: nesbot/carbon@3.0.0 is blocked by laravel/framework constraint ^2.72', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_CARBON_BLOCKED);
    const adapter = new ComposerReachabilityAdapter();
    const results = await adapter.checkReachability(['nesbot/carbon@3.0.0'], { cwd: '/app' });

    const check = results.find((r) => r.packageRef === 'nesbot/carbon@3.0.0')!;
    expect(check.reachable).toBe(false);
    expect(check.blockReason).toContain('laravel/framework');
    expect(check.blockReason).toContain('^2.72');
    expect(check.blockedBy).toEqual(
      expect.arrayContaining([expect.stringContaining('laravel/framework')]),
    );
  });

  it('multiple parents blocking same package are all listed in blockedBy', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_MULTI_PARENT_BLOCKED);
    const adapter = new ComposerReachabilityAdapter();
    // 3.0.0 does not satisfy ^2.0 or >=2.0 <3.0 — both parents block
    const results = await adapter.checkReachability(['nesbot/carbon@3.0.0'], { cwd: '/app' });

    const check = results.find((r) => r.packageRef === 'nesbot/carbon@3.0.0')!;
    expect(check.reachable).toBe(false);
    expect(check.blockedBy).toEqual(
      expect.arrayContaining([
        expect.stringContaining('parent-a'),
        expect.stringContaining('parent-b'),
      ]),
    );
  });

  it('dev dependency constraint also blocks when not satisfied', async () => {
    // phpunit/phpunit requires nesbot/carbon ^2.0 — 3.0.0 is blocked
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_DEV_CONSTRAINS_PROD);
    const adapter = new ComposerReachabilityAdapter();
    const results = await adapter.checkReachability(['nesbot/carbon@3.0.0'], { cwd: '/app' });

    const check = results.find((r) => r.packageRef === 'nesbot/carbon@3.0.0')!;
    expect(check.reachable).toBe(false);
    expect(check.blockedBy).toEqual(
      expect.arrayContaining([expect.stringContaining('phpunit/phpunit')]),
    );
  });
});

describe('ComposerReachabilityAdapter.checkReachability — reachable scenarios', () => {
  beforeEach(() => mockedReadFile.mockReset());

  it('AC3: symfony/http-foundation@6.4.0 satisfies ^6.0 parent constraint → reachable', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_HTTP_FOUNDATION_REACHABLE);
    const adapter = new ComposerReachabilityAdapter();
    const results = await adapter.checkReachability(
      ['symfony/http-foundation@6.4.0'],
      { cwd: '/app' },
    );

    const check = results.find((r) => r.packageRef === 'symfony/http-foundation@6.4.0')!;
    expect(check.reachable).toBe(true);
  });

  it('platform constraints (php, ext-*) do not block package upgrades', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_CARBON_BLOCKED);
    const adapter = new ComposerReachabilityAdapter();
    // Check that php/ext-* are not treated as packages in the constraint map
    const results = await adapter.checkReachability(['php@8.2.0'], { cwd: '/app' });
    // php would never be in the packages array, but even if passed, it should be reachable
    // because platform reqs are excluded from constraint map
    const check = results.find((r) => r.packageRef === 'php@8.2.0')!;
    expect(check.reachable).toBe(true);
  });

  it('dev dependency constraint is satisfied → reachable', async () => {
    // phpunit/phpunit requires nesbot/carbon ^2.0 — 2.73.0 satisfies ^2.0
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_DEV_CONSTRAINS_PROD);
    const adapter = new ComposerReachabilityAdapter();
    const results = await adapter.checkReachability(['nesbot/carbon@2.73.0'], { cwd: '/app' });

    const check = results.find((r) => r.packageRef === 'nesbot/carbon@2.73.0')!;
    expect(check.reachable).toBe(true);
  });

  it('handles malformed packageRef without @version gracefully → reachable', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_CARBON_BLOCKED);
    const adapter = new ComposerReachabilityAdapter();
    const results = await adapter.checkReachability(['malformed-ref'], { cwd: '/app' });
    expect(results[0]).toMatchObject({ packageRef: 'malformed-ref', reachable: true });
  });

  it('version with v prefix in lockfile is handled by normalization', async () => {
    // Use a fixture where the constraint uses v prefix
    const lockContent = JSON.stringify({
      packages: [
        {
          name: 'vendor/package',
          version: 'v1.0.0',
          require: {
            'other/pkg': '>=v1.0,<v2.0',
          },
        },
      ],
      'packages-dev': [],
    });
    mockedReadFile.mockResolvedValue(lockContent);
    const adapter = new ComposerReachabilityAdapter();
    // 1.5.0 satisfies >=1.0,<2.0 → reachable
    const results = await adapter.checkReachability(['other/pkg@1.5.0'], { cwd: '/app' });
    const check = results.find((r) => r.packageRef === 'other/pkg@1.5.0')!;
    expect(check.reachable).toBe(true);
  });

  it('mixed packages — some blocked, some reachable', async () => {
    const lockContent = JSON.stringify({
      'packages': [
        {
          name: 'laravel/framework',
          version: 'v10.48.0',
          require: {
            'nesbot/carbon': '^2.72',
            'symfony/http-foundation': '^6.0',
          },
        },
      ],
      'packages-dev': [],
    });
    mockedReadFile.mockResolvedValue(lockContent);
    const adapter = new ComposerReachabilityAdapter();
    const results = await adapter.checkReachability(
      ['nesbot/carbon@3.0.0', 'symfony/http-foundation@6.4.0'],
      { cwd: '/app' },
    );

    const carbonCheck = results.find((r) => r.packageRef === 'nesbot/carbon@3.0.0')!;
    const symfonyCheck = results.find((r) => r.packageRef === 'symfony/http-foundation@6.4.0')!;

    expect(carbonCheck.reachable).toBe(false);
    expect(symfonyCheck.reachable).toBe(true);
  });
});

// ─── ComposerReachabilityAdapter — deep mode (cross-package conflict) ─────────

/**
 * Scenario: pkg-a requires pkg-b with ^9.0, but pkg-b's safe version is 8.83.0.
 * 8.83.0 does NOT satisfy ^9.0, so pkg-a is blocked as a cross-package conflict.
 */
const COMPOSER_LOCK_DEEP_CROSS_CONFLICT = JSON.stringify({
  'packages': [
    {
      name: 'vendor/pkg-a',
      version: 'v1.0.0',
      require: {
        'vendor/pkg-b': '^9.0',
      },
    },
    {
      name: 'vendor/pkg-b',
      version: 'v8.80.0',
      require: {
        'php': '>=8.1',
      },
    },
  ],
  'packages-dev': [],
});

/**
 * Scenario: pkg-a requires pkg-b with ^8.0, and pkg-b's safe version is 8.83.0.
 * 8.83.0 satisfies ^8.0, so no conflict.
 */
const COMPOSER_LOCK_DEEP_NO_CONFLICT = JSON.stringify({
  'packages': [
    {
      name: 'vendor/pkg-a',
      version: 'v1.0.0',
      require: {
        'vendor/pkg-b': '^8.0',
      },
    },
    {
      name: 'vendor/pkg-b',
      version: 'v8.80.0',
      require: {},
    },
  ],
  'packages-dev': [],
});

describe('ComposerReachabilityAdapter.checkReachability — deep mode', () => {
  beforeEach(() => mockedReadFile.mockReset());

  it('deep=true: pkg-a blocked when its dependency pkg-b safe version violates the constraint', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_DEEP_CROSS_CONFLICT);
    const adapter = new ComposerReachabilityAdapter({ deep: true });
    // pkg-b safe version 8.83.0 does not satisfy vendor/pkg-a's requirement ^9.0
    const results = await adapter.checkReachability(
      ['vendor/pkg-a@1.1.0', 'vendor/pkg-b@8.83.0'],
      { cwd: '/app' },
    );

    const pkgACheck = results.find((r) => r.packageRef === 'vendor/pkg-a@1.1.0')!;
    expect(pkgACheck.reachable).toBe(false);
    expect(pkgACheck.blockReason).toContain('Cross-package conflict');
    expect(pkgACheck.blockReason).toContain('vendor/pkg-b');
    expect(pkgACheck.blockReason).toContain('^9.0');
    expect(pkgACheck.blockReason).toContain('8.83.0');
    expect(pkgACheck.blockedBy).toEqual(
      expect.arrayContaining([expect.stringContaining('vendor/pkg-b')]),
    );
  });

  it('deep=true: no conflict when dependency safe version satisfies the constraint', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_DEEP_NO_CONFLICT);
    const adapter = new ComposerReachabilityAdapter({ deep: true });
    // pkg-b safe version 8.83.0 satisfies vendor/pkg-a's requirement ^8.0
    const results = await adapter.checkReachability(
      ['vendor/pkg-a@1.1.0', 'vendor/pkg-b@8.83.0'],
      { cwd: '/app' },
    );

    const pkgACheck = results.find((r) => r.packageRef === 'vendor/pkg-a@1.1.0')!;
    expect(pkgACheck.reachable).toBe(true);
  });

  it('deep=false (default): cross-conflict NOT detected even when constraint is violated', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_DEEP_CROSS_CONFLICT);
    const adapter = new ComposerReachabilityAdapter();
    const results = await adapter.checkReachability(
      ['vendor/pkg-a@1.1.0', 'vendor/pkg-b@8.83.0'],
      { cwd: '/app' },
    );

    const pkgACheck = results.find((r) => r.packageRef === 'vendor/pkg-a@1.1.0')!;
    // No deep flag — pkg-a has no parent blocking it → reachable
    expect(pkgACheck.reachable).toBe(true);
  });

  it('deep=false explicit: cross-conflict NOT detected', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_DEEP_CROSS_CONFLICT);
    const adapter = new ComposerReachabilityAdapter({ deep: false });
    const results = await adapter.checkReachability(
      ['vendor/pkg-a@1.1.0', 'vendor/pkg-b@8.83.0'],
      { cwd: '/app' },
    );

    const pkgACheck = results.find((r) => r.packageRef === 'vendor/pkg-a@1.1.0')!;
    expect(pkgACheck.reachable).toBe(true);
  });

  it('deep=true: cross-conflict only fires when the dep is also in the auto_safe list', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_DEEP_CROSS_CONFLICT);
    const adapter = new ComposerReachabilityAdapter({ deep: true });
    // vendor/pkg-b is NOT in the packages list being checked
    const results = await adapter.checkReachability(
      ['vendor/pkg-a@1.1.0'],
      { cwd: '/app' },
    );

    const pkgACheck = results.find((r) => r.packageRef === 'vendor/pkg-a@1.1.0')!;
    // vendor/pkg-b is not in safeVersionByName, so no cross-conflict
    expect(pkgACheck.reachable).toBe(true);
  });

  it('deep=true: platform requirements in forward deps are never treated as conflicts', async () => {
    const lockContent = JSON.stringify({
      'packages': [
        {
          name: 'vendor/pkg-a',
          version: 'v1.0.0',
          require: {
            'php': '>=8.1',
            'ext-mbstring': '*',
            'lib-pcre': '>=8.0',
          },
        },
      ],
      'packages-dev': [],
    });
    mockedReadFile.mockResolvedValue(lockContent);
    const adapter = new ComposerReachabilityAdapter({ deep: true });
    const results = await adapter.checkReachability(
      ['vendor/pkg-a@1.1.0'],
      { cwd: '/app' },
    );
    const pkgACheck = results.find((r) => r.packageRef === 'vendor/pkg-a@1.1.0')!;
    expect(pkgACheck.reachable).toBe(true);
  });

  it('deep=true: existing parent-blocks-child tests still pass unchanged', async () => {
    mockedReadFile.mockResolvedValue(COMPOSER_LOCK_CARBON_BLOCKED);
    const adapter = new ComposerReachabilityAdapter({ deep: true });
    const results = await adapter.checkReachability(['nesbot/carbon@3.0.0'], { cwd: '/app' });

    const check = results.find((r) => r.packageRef === 'nesbot/carbon@3.0.0')!;
    expect(check.reachable).toBe(false);
    expect(check.blockReason).toContain('Parent constraint blocks');
    expect(check.blockReason).toContain('laravel/framework');
  });
});
