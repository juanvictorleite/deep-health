import { describe, it, expect, vi } from 'vitest';
import { enrichWithReachability, type ReachabilityAdapter, type ReachabilityCheck } from '@core/policy/reachability';
import type { EcosystemScanResult, VulnerabilityEntry } from '@core/types/scan';

function makeVuln(overrides: Partial<VulnerabilityEntry> & Pick<VulnerabilityEntry, 'package' | 'currentVersion' | 'safeVersion'>): VulnerabilityEntry {
  return {
    ecosystem: 'npm',
    cvss: '—',
    ghsaId: 'GHSA-001',
    risk: '',
    classification: 'auto_safe',
    reason: '',
    ...overrides,
  };
}

function makeEcosystem(overrides: Partial<EcosystemScanResult> = {}): EcosystemScanResult {
  return {
    vulnerabilities_total: 0,
    auto_safe: 0,
    breaking: 0,
    manual: 0,
    auto_safe_packages: [],
    breaking_packages: [],
    manual_packages: [],
    vulnerabilities: [],
    blocked_packages: [],
    blocked: 0,
    ...overrides,
  };
}

function makeAdapter(checks: ReachabilityCheck[]): ReachabilityAdapter {
  return {
    ecosystemId: 'npm',
    checkReachability: vi.fn().mockResolvedValue(checks),
  };
}

describe('enrichWithReachability — no-op paths', () => {
  it('returns a clone unchanged when no adapter exists for the ecosystem', async () => {
    const original = makeEcosystem({
      auto_safe: 1,
      auto_safe_packages: ['lodash@4.17.20'],
      vulnerabilities: [makeVuln({ package: 'lodash', currentVersion: '4.17.20', safeVersion: '4.17.21' })],
    });
    const result = await enrichWithReachability({ npm: original }, new Map(), '/cwd');
    expect(result['npm']).toEqual(original);
    expect(result['npm']).not.toBe(original);
  });

  it('returns a clone unchanged when auto_safe_packages is empty', async () => {
    const original = makeEcosystem();
    const adapter = makeAdapter([]);
    const result = await enrichWithReachability(
      { npm: original },
      new Map([['npm', adapter]]),
      '/cwd',
    );
    expect(result['npm']).toEqual(original);
    expect(result['npm']).not.toBe(original);
  });

  it('handles an empty ecosystems record', async () => {
    const result = await enrichWithReachability({}, new Map(), '/cwd');
    expect(result).toEqual({});
  });
});

describe('enrichWithReachability — adapter receives safeVersion refs', () => {
  it('passes name@safeVersion to the adapter (not name@currentVersion)', async () => {
    const original = makeEcosystem({
      auto_safe: 1,
      auto_safe_packages: ['cookie@0.5.0'],
      vulnerabilities: [makeVuln({ package: 'cookie', currentVersion: '0.5.0', safeVersion: '0.7.0' })],
    });
    const adapter = makeAdapter([{ packageRef: 'cookie@0.7.0', reachable: true }]);
    await enrichWithReachability({ npm: original }, new Map([['npm', adapter]]), '/cwd');
    expect(adapter.checkReachability).toHaveBeenCalledWith(['cookie@0.7.0'], { cwd: '/cwd' });
  });

  it('falls back to currentRef when safeVersion is unknown', async () => {
    const original = makeEcosystem({
      auto_safe: 1,
      auto_safe_packages: ['cookie@0.5.0'],
      vulnerabilities: [makeVuln({ package: 'cookie', currentVersion: '0.5.0', safeVersion: null, classification: 'auto_safe' })],
    });
    const adapter = makeAdapter([{ packageRef: 'cookie@0.5.0', reachable: true }]);
    await enrichWithReachability({ npm: original }, new Map([['npm', adapter]]), '/cwd');
    expect(adapter.checkReachability).toHaveBeenCalledWith(['cookie@0.5.0'], { cwd: '/cwd' });
  });
});

describe('enrichWithReachability — blocked packages move from auto_safe to blocked', () => {
  it('moves a blocked package and adjusts counts', async () => {
    const original = makeEcosystem({
      auto_safe: 2,
      auto_safe_packages: ['cookie@0.5.0', 'lodash@4.17.20'],
      vulnerabilities: [
        makeVuln({ package: 'cookie', currentVersion: '0.5.0', safeVersion: '0.7.0' }),
        makeVuln({ package: 'lodash', currentVersion: '4.17.20', safeVersion: '4.17.21' }),
      ],
    });

    const checks: ReachabilityCheck[] = [
      {
        packageRef: 'cookie@0.7.0',
        reachable: false,
        blockReason: 'Parent constraint blocks upgrade to 0.7.0: cookies-next (<0.7.0)',
        blockedBy: ['cookies-next (<0.7.0)'],
      },
      { packageRef: 'lodash@4.17.21', reachable: true },
    ];

    const result = await enrichWithReachability(
      { npm: original },
      new Map([['npm', makeAdapter(checks)]]),
      '/cwd',
    );

    const enriched = result['npm']!;
    expect(enriched.auto_safe_packages).toEqual(['lodash@4.17.20']);
    expect(enriched.auto_safe).toBe(1);
    expect(enriched.blocked_packages).toEqual(['cookie@0.5.0']);
    expect(enriched.blocked).toBe(1);
  });

  it('annotates VulnerabilityEntry for blocked packages with reachable=false', async () => {
    const original = makeEcosystem({
      auto_safe: 1,
      auto_safe_packages: ['cookie@0.5.0'],
      vulnerabilities: [
        makeVuln({ package: 'cookie', currentVersion: '0.5.0', safeVersion: '0.7.0' }),
      ],
    });

    const checks: ReachabilityCheck[] = [
      {
        packageRef: 'cookie@0.7.0',
        reachable: false,
        blockReason: 'Parent constraint blocks upgrade to 0.7.0: cookies-next (<0.7.0)',
        blockedBy: ['cookies-next (<0.7.0)'],
      },
    ];

    const result = await enrichWithReachability(
      { npm: original },
      new Map([['npm', makeAdapter(checks)]]),
      '/cwd',
    );

    const vuln = result['npm']!.vulnerabilities[0]!;
    expect(vuln.reachable).toBe(false);
    expect(vuln.blockReason).toBe('Parent constraint blocks upgrade to 0.7.0: cookies-next (<0.7.0)');
    expect(vuln.blockedBy).toEqual(['cookies-next (<0.7.0)']);
  });

  it('sets reachable=true on VulnerabilityEntry for reachable packages', async () => {
    const original = makeEcosystem({
      auto_safe: 1,
      auto_safe_packages: ['lodash@4.17.20'],
      vulnerabilities: [
        makeVuln({ package: 'lodash', currentVersion: '4.17.20', safeVersion: '4.17.21' }),
      ],
    });

    const checks: ReachabilityCheck[] = [
      { packageRef: 'lodash@4.17.21', reachable: true },
    ];

    const result = await enrichWithReachability(
      { npm: original },
      new Map([['npm', makeAdapter(checks)]]),
      '/cwd',
    );

    const vuln = result['npm']!.vulnerabilities[0]!;
    expect(vuln.reachable).toBe(true);
    expect(vuln.blockReason).toBeUndefined();
    expect(vuln.blockedBy).toBeUndefined();
  });

  it('does NOT mutate the original EcosystemScanResult', async () => {
    const original = makeEcosystem({
      auto_safe: 1,
      auto_safe_packages: ['cookie@0.5.0'],
      vulnerabilities: [
        makeVuln({ package: 'cookie', currentVersion: '0.5.0', safeVersion: '0.7.0' }),
      ],
    });

    const originalClone = structuredClone(original);

    await enrichWithReachability(
      { npm: original },
      new Map([
        [
          'npm',
          makeAdapter([
            {
              packageRef: 'cookie@0.7.0',
              reachable: false,
              blockReason: 'blocked',
              blockedBy: ['p (^0.5)'],
            },
          ]),
        ],
      ]),
      '/cwd',
    );

    expect(original).toEqual(originalClone);
  });

  it('handles all packages blocked', async () => {
    const original = makeEcosystem({
      auto_safe: 2,
      auto_safe_packages: ['cookie@0.5.0', 'postcss@8.4.31'],
      vulnerabilities: [
        makeVuln({ package: 'cookie', currentVersion: '0.5.0', safeVersion: '0.7.0' }),
        makeVuln({ package: 'postcss', currentVersion: '8.4.31', safeVersion: '8.5.10' }),
      ],
    });

    const checks: ReachabilityCheck[] = [
      { packageRef: 'cookie@0.7.0', reachable: false, blockReason: 'b1', blockedBy: ['p1'] },
      { packageRef: 'postcss@8.5.10', reachable: false, blockReason: 'b2', blockedBy: ['p2'] },
    ];

    const result = await enrichWithReachability(
      { npm: original },
      new Map([['npm', makeAdapter(checks)]]),
      '/cwd',
    );

    const enriched = result['npm']!;
    expect(enriched.auto_safe_packages).toEqual([]);
    expect(enriched.auto_safe).toBe(0);
    expect(enriched.blocked_packages).toEqual(['cookie@0.5.0', 'postcss@8.4.31']);
    expect(enriched.blocked).toBe(2);
  });

  it('uses the base ecosystemId for monorepo keys (npm:web → npm adapter)', async () => {
    const original = makeEcosystem({
      auto_safe: 1,
      auto_safe_packages: ['cookie@0.5.0'],
      vulnerabilities: [
        makeVuln({ package: 'cookie', currentVersion: '0.5.0', safeVersion: '0.7.0' }),
      ],
    });

    const adapter = makeAdapter([{ packageRef: 'cookie@0.7.0', reachable: true }]);
    const result = await enrichWithReachability(
      { 'npm:web': original },
      new Map([['npm', adapter]]),
      '/cwd',
    );

    expect(adapter.checkReachability).toHaveBeenCalled();
    expect(result['npm:web']).toBeDefined();
    expect(result['npm:web']!.auto_safe_packages).toEqual(['cookie@0.5.0']);
  });
});
