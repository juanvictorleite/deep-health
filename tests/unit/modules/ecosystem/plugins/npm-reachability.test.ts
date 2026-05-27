import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { NpmReachabilityAdapter } from '@modules/ecosystem/plugins/npm-reachability';

const mockedReadFile = readFile as unknown as ReturnType<typeof vi.fn>;

// AC5 fixture: cookies-next@4.2.1 has dependency constraint cookie <0.7.0,
// blocking an upgrade of cookie to 0.7.0.
const LOCKFILE_V2_COOKIE_BLOCKED = JSON.stringify({
  name: 'my-app',
  lockfileVersion: 2,
  packages: {
    '': { name: 'my-app', version: '1.0.0' },
    'node_modules/cookie': { version: '0.5.0' },
    'node_modules/cookies-next': {
      version: '4.2.1',
      dependencies: {
        cookie: '<0.7.0',
      },
    },
  },
});

// AC5 fixture: next@14.2.35 has postcss constraint ~8.4.31 (patch-range),
// blocking an upgrade of postcss to 8.5.10 (which does not satisfy ~8.4.31).
const LOCKFILE_V2_POSTCSS_BLOCKED = JSON.stringify({
  name: 'my-app',
  lockfileVersion: 2,
  packages: {
    '': { name: 'my-app', version: '1.0.0' },
    'node_modules/postcss': { version: '8.4.31' },
    'node_modules/next': {
      version: '14.2.35',
      dependencies: {
        postcss: '~8.4.31',
      },
    },
    'node_modules/next/node_modules/postcss': { version: '8.4.31' },
  },
});

// v1 equivalent of LOCKFILE_V2_COOKIE_BLOCKED
const LOCKFILE_V1_COOKIE_BLOCKED = JSON.stringify({
  name: 'my-app',
  lockfileVersion: 1,
  dependencies: {
    cookie: { version: '0.5.0' },
    'cookies-next': {
      version: '4.2.1',
      requires: {
        cookie: '<0.7.0',
      },
    },
  },
});

describe('NpmReachabilityAdapter.ecosystemId', () => {
  it('is "npm"', () => {
    const adapter = new NpmReachabilityAdapter();
    expect(adapter.ecosystemId).toBe('npm');
  });
});

describe('NpmReachabilityAdapter.checkReachability — file errors', () => {
  beforeEach(() => mockedReadFile.mockReset());

  it('returns all reachable when package-lock.json read fails', async () => {
    mockedReadFile.mockResolvedValue(null);
    const adapter = new NpmReachabilityAdapter();
    const result = await adapter.checkReachability(['cookie@0.7.0'], { cwd: '/app' });
    expect(result).toEqual([{ packageRef: 'cookie@0.7.0', reachable: true }]);
  });

  it('returns all reachable when package-lock.json contains invalid JSON', async () => {
    mockedReadFile.mockResolvedValue('NOT JSON {');
    const adapter = new NpmReachabilityAdapter();
    const result = await adapter.checkReachability(['cookie@0.7.0'], { cwd: '/app' });
    expect(result).toEqual([{ packageRef: 'cookie@0.7.0', reachable: true }]);
  });

  it('returns reachable when no constraints exist for the package', async () => {
    const lockfile = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        '': { name: 'app', version: '1.0.0' },
        'node_modules/unrelated': { version: '1.0.0', dependencies: { something: '^1.0.0' } },
      },
    });
    mockedReadFile.mockResolvedValue(lockfile);
    const adapter = new NpmReachabilityAdapter();
    const result = await adapter.checkReachability(['cookie@0.7.0'], { cwd: '/app' });
    expect(result[0]).toMatchObject({ packageRef: 'cookie@0.7.0', reachable: true });
  });
});

describe('NpmReachabilityAdapter.checkReachability — AC5 real-world fixtures', () => {
  beforeEach(() => mockedReadFile.mockReset());

  it('v2: cookie@0.7.0 (safe target) is blocked by cookies-next@4.2.1 with constraint <0.7.0', async () => {
    mockedReadFile.mockResolvedValue(LOCKFILE_V2_COOKIE_BLOCKED);
    const adapter = new NpmReachabilityAdapter();
    const results = await adapter.checkReachability(['cookie@0.7.0'], { cwd: '/app' });

    const check = results.find((r) => r.packageRef === 'cookie@0.7.0')!;
    expect(check.reachable).toBe(false);
    expect(check.blockReason).toContain('cookies-next');
    expect(check.blockReason).toContain('<0.7.0');
    expect(check.blockedBy).toEqual(expect.arrayContaining([expect.stringContaining('cookies-next')]));
  });

  it('v2: postcss@8.5.10 (safe target) is blocked by next@14.2.35 constraint ~8.4.31', async () => {
    mockedReadFile.mockResolvedValue(LOCKFILE_V2_POSTCSS_BLOCKED);
    const adapter = new NpmReachabilityAdapter();
    const results = await adapter.checkReachability(['postcss@8.5.10'], { cwd: '/app' });

    const check = results.find((r) => r.packageRef === 'postcss@8.5.10')!;
    expect(check.reachable).toBe(false);
    expect(check.blockReason).toContain('next');
    expect(check.blockedBy).toEqual(expect.arrayContaining([expect.stringContaining('next')]));
  });

  it('v1: cookie@0.7.0 (safe target) is blocked by cookies-next (requires field)', async () => {
    mockedReadFile.mockResolvedValue(LOCKFILE_V1_COOKIE_BLOCKED);
    const adapter = new NpmReachabilityAdapter();
    const results = await adapter.checkReachability(['cookie@0.7.0'], { cwd: '/app' });

    const check = results.find((r) => r.packageRef === 'cookie@0.7.0')!;
    expect(check.reachable).toBe(false);
    expect(check.blockReason).toContain('cookies-next');
    expect(check.blockedBy).toEqual(expect.arrayContaining([expect.stringContaining('cookies-next')]));
  });

  it('package not blocked when safe version satisfies all parent constraints', async () => {
    const lockfile = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        '': { name: 'app', version: '1.0.0' },
        'node_modules/lodash': { version: '4.17.20' },
        'node_modules/some-parent': {
          version: '1.0.0',
          dependencies: {
            lodash: '^4.17.0',
          },
        },
      },
    });
    mockedReadFile.mockResolvedValue(lockfile);
    const adapter = new NpmReachabilityAdapter();
    const results = await adapter.checkReachability(['lodash@4.17.21'], { cwd: '/app' });

    const check = results.find((r) => r.packageRef === 'lodash@4.17.21')!;
    expect(check.reachable).toBe(true);
  });

  it('handles malformed packageRef without @version gracefully', async () => {
    mockedReadFile.mockResolvedValue(LOCKFILE_V2_COOKIE_BLOCKED);
    const adapter = new NpmReachabilityAdapter();
    const results = await adapter.checkReachability(['malformed-ref'], { cwd: '/app' });
    expect(results[0]).toMatchObject({ packageRef: 'malformed-ref', reachable: true });
  });

  it('mixed packages — some blocked, some not', async () => {
    const lockfile = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        '': { name: 'app', version: '1.0.0' },
        'node_modules/cookie': { version: '0.5.0' },
        'node_modules/lodash': { version: '4.17.20' },
        'node_modules/cookies-next': {
          version: '4.2.1',
          dependencies: { cookie: '<0.7.0' },
        },
        'node_modules/some-parent': {
          version: '1.0.0',
          dependencies: { lodash: '^4.17.0' },
        },
      },
    });
    mockedReadFile.mockResolvedValue(lockfile);
    const adapter = new NpmReachabilityAdapter();
    const results = await adapter.checkReachability(
      ['cookie@0.7.0', 'lodash@4.17.21'],
      { cwd: '/app' },
    );

    const cookieCheck = results.find((r) => r.packageRef === 'cookie@0.7.0')!;
    const lodashCheck = results.find((r) => r.packageRef === 'lodash@4.17.21')!;

    expect(cookieCheck.reachable).toBe(false);
    expect(lodashCheck.reachable).toBe(true);
  });
});
