/**
 * Fixture-driven table tests for the pure osv-parse seam (ADR 0014 / issue 0011).
 *
 * Covers:
 * - CVSS_V3 base-score computation (scope changed/unchanged, malformed vectors,
 *   missing severity, zero-impact vectors, non-string scores, unknown metric letters)
 * - Safe-version resolution across semver ranges, GIT ranges, missing events,
 *   and non-semver current versions
 * - Structural edge cases in the raw osv-scanner JSON (missing results/packages/
 *   vulnerabilities, unknown ecosystems, null fields, multi-vuln dedup)
 *
 * These tests pin CURRENT behavior (verified against the pre-extraction
 * osv-engine.ts implementation) — they are regression pins, not aspirations.
 * No I/O: parseOsvJsonOutput is exercised directly with an in-memory registry stub.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseOsvJsonOutput } from '@modules/scanner/osv-parse';
import type { ProjectConfig } from '@core/types/config';
import type { EcosystemRegistry } from '@modules/ecosystem/registry';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(): ProjectConfig {
  return {
    project: { name: 'test', client: 'test' },
    ecosystems: [{ id: 'npm' }],
    protected_packages: {},
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: false,
    },
    conflict_resolution: 'fail',
  };
}

type FakePlugin = ReturnType<EcosystemRegistry['getAll']>[number];

function makeRegistry(options: {
  osvEcosystem?: string;
  pluginId?: string;
  protectedPackages?: { package: string; constraint: string; reason: string }[];
  ghost?: boolean;
} = {}): EcosystemRegistry {
  const { osvEcosystem = 'npm', pluginId = 'npm', protectedPackages = [], ghost = false } = options;

  const plugin = {
    id: pluginId,
    osvEcosystems: [osvEcosystem],
    buildScanArgs: () => [],
    getProtectedPackages: () => protectedPackages,
  } as unknown as FakePlugin;

  return {
    // 'ghost': findByOsvEcosystem resolves a plugin that getAll() never returns —
    // exercises the protectedByPlugin.get(pluginId) ?? new Map() fallback.
    getAll: () => (ghost ? [] : [plugin]),
    register: vi.fn(),
    get: vi.fn(),
    findByOsvEcosystem: (eco: string) => (eco.toLowerCase() === osvEcosystem.toLowerCase() ? plugin : undefined),
  } as unknown as EcosystemRegistry;
}

interface RangeEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}

function makeVuln(options: {
  id?: string;
  summary?: string | null;
  cvssScore?: string | number;
  ranges?: { type?: string; events: RangeEvent[] }[];
  affected?: unknown;
} = {}): Record<string, unknown> {
  const { id = 'GHSA-test-0001', summary = 'test vulnerability', cvssScore, ranges, affected } = options;
  const vuln: Record<string, unknown> = { id, summary };

  if (affected !== undefined) {
    vuln['affected'] = affected;
  } else if (ranges) {
    vuln['affected'] = [{ ranges: ranges.map((r) => ({ type: r.type, events: r.events })) }];
  }

  if (cvssScore !== undefined) {
    vuln['severity'] = [{ type: 'CVSS_V3', score: cvssScore }];
  }

  return vuln;
}

function makeStdout(options: {
  pkgName?: string;
  pkgVersion?: string | null;
  ecosystem?: string;
  vulns?: Record<string, unknown>[];
  noPackages?: boolean;
  noVulnerabilities?: boolean;
  noResults?: boolean;
}): string {
  if (options.noResults) return JSON.stringify({ schemaVersion: '1.0' });

  const { pkgName = 'lodash', pkgVersion = '4.17.15', ecosystem = 'npm', vulns = [makeVuln()] } = options;

  const packageEntry: Record<string, unknown> = {
    package: { name: pkgName, version: pkgVersion, ecosystem },
  };
  if (!options.noVulnerabilities) packageEntry['vulnerabilities'] = vulns;

  return JSON.stringify({
    results: [options.noPackages ? {} : { packages: [packageEntry] }],
  });
}

// ─── CVSS base-score table ────────────────────────────────────────────────────

describe('parseOsvJsonOutput — CVSS base-score extraction', () => {
  const cvssCases: [name: string, score: string | number, assert: (cvss: string) => void][] = [
    ['scope=Changed (S:C) full-impact vector yields a positive numeric score', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', (cvss) => {
      expect(cvss).not.toBe('—');
      expect(parseFloat(cvss)).toBeGreaterThan(0);
    }],
    ['scope=Unchanged (S:U) full-impact vector yields a positive numeric score', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', (cvss) => {
      expect(cvss).not.toBe('—');
      expect(parseFloat(cvss)).toBeGreaterThan(0);
    }],
    ['zero-impact vector (C:N/I:N/A:N) yields exactly "0.0"', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N', (cvss) => {
      expect(cvss).toBe('0.0');
    }],
    ['malformed vector (no CVSS:x.y/ prefix) yields "—"', 'INVALID_SCORE', (cvss) => {
      expect(cvss).toBe('—');
    }],
    ['unknown/missing metric letters fall back to 0 without throwing', 'CVSS:3.1/AV:X/AC:X/PR:X/UI:X/S:U/C:X/I:X/A:X', (cvss) => {
      expect(typeof cvss).toBe('string');
    }],
    ['non-string score triggers the catch branch and yields "—"', 42, (cvss) => {
      expect(cvss).toBe('—');
    }],
  ];

  it.each(cvssCases)('%s', (_name, cvssScore, assertCvss) => {
    const stdout = makeStdout({
      vulns: [makeVuln({ cvssScore, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] })],
    });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    const vuln = result.ecosystems['npm']?.vulnerabilities[0];
    expect(vuln).toBeDefined();
    assertCvss(vuln!.cvss);
  });

  it('returns "—" when no severity field is present at all', () => {
    const stdout = makeStdout({ vulns: [makeVuln({ ranges: [{ events: [{ fixed: '4.17.21' }] }] })] });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities[0]?.cvss).toBe('—');
  });
});

// ─── Safe-version resolution table ────────────────────────────────────────────

describe('parseOsvJsonOutput — safe-version resolution', () => {
  const ROLLUP_RANGES: { events: RangeEvent[] }[] = [
    { events: [{ introduced: '0' }, { fixed: '2.80.0' }] },
    { events: [{ introduced: '3.0.0' }, { fixed: '3.30.0' }] },
    { events: [{ introduced: '4.0.0' }, { fixed: '4.59.0' }] },
  ];

  it('selects the range containing v4.57.1 → safeVersion 4.59.0', () => {
    const stdout = makeStdout({ pkgName: 'rollup', pkgVersion: '4.57.1', vulns: [makeVuln({ ranges: ROLLUP_RANGES })] });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities[0]?.safeVersion).toBe('4.59.0');
  });

  it('selects the range containing v3.25.0 → safeVersion 3.30.0', () => {
    const stdout = makeStdout({ pkgName: 'rollup', pkgVersion: '3.25.0', vulns: [makeVuln({ ranges: ROLLUP_RANGES })] });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities[0]?.safeVersion).toBe('3.30.0');
  });

  it('returns null when only a last_affected (no-fix) range covers the current version', () => {
    const ranges = [
      { events: [{ introduced: '0' }, { last_affected: '2.99.0' }] },
      { events: [{ introduced: '3.0.0' }, { fixed: '3.5.0' }] },
    ];
    const stdout = makeStdout({ pkgName: 'pkg', pkgVersion: '2.5.0', vulns: [makeVuln({ ranges })] });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities[0]?.safeVersion).toBeNull();
  });

  it('falls back to the first fixed event across ranges when currentVersion is non-semver', () => {
    const stdout = makeStdout({ pkgName: 'pkg', pkgVersion: 'dev', vulns: [makeVuln({ ranges: ROLLUP_RANGES })] });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities[0]?.safeVersion).toBe('2.80.0');
  });

  it('returns null when currentVersion is non-semver and no range has a fixed event', () => {
    const stdout = makeStdout({
      pkgName: 'pkg',
      pkgVersion: 'dev',
      vulns: [makeVuln({ ranges: [{ events: [{ introduced: '0' }] }] })],
    });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities[0]?.safeVersion).toBeNull();
  });

  it('excludes GIT-typed ranges from safe-version selection even when they would otherwise match', () => {
    // A GIT range's SHA "fixed" event would coerce to a bogus semver (e.g. "9e08eb8f..." -> "9.0.0")
    // and must never be selected; the real semver range below must win instead.
    const ranges = [
      { type: 'GIT', events: [{ introduced: '0' }, { fixed: '9e08eb8fabc123' }] },
      { type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.5.0' }] },
    ];
    const stdout = makeStdout({ pkgName: 'pkg', pkgVersion: '1.0.0', vulns: [makeVuln({ ranges })] });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities[0]?.safeVersion).toBe('1.5.0');
  });

  it('treats a range with no introduced event as "since 0" (still matches before fixed)', () => {
    const stdout = makeStdout({
      pkgName: 'pkg',
      pkgVersion: '1.0.0',
      vulns: [makeVuln({ ranges: [{ events: [{ fixed: '2.0.0' }] }] })],
    });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities[0]?.safeVersion).toBe('2.0.0');
  });

  it('skips a range whose fixed version does not coerce to semver', () => {
    const stdout = makeStdout({
      pkgName: 'pkg',
      pkgVersion: '1.0.0',
      vulns: [makeVuln({ ranges: [{ events: [{ introduced: '0' }, { fixed: 'not-a-version' }] }] })],
    });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities[0]?.safeVersion).toBeNull();
  });
});

// ─── Structural edge cases ─────────────────────────────────────────────────────

describe('parseOsvJsonOutput — structural edge cases', () => {
  it('returns empty ecosystems when the JSON has no results field', () => {
    const result = parseOsvJsonOutput(makeStdout({ noResults: true }), makeConfig(), makeRegistry());
    expect(result.ecosystems).toEqual({});
  });

  it('does not throw when a result entry has no packages array', () => {
    const result = parseOsvJsonOutput(makeStdout({ noPackages: true }), makeConfig(), makeRegistry());
    expect(result.ecosystems).toEqual({});
  });

  it('skips a package whose ecosystem has no matching plugin', () => {
    const result = parseOsvJsonOutput(
      makeStdout({ ecosystem: 'UnknownEco' }),
      makeConfig(),
      makeRegistry({ osvEcosystem: 'npm' }),
    );
    expect(result.ecosystems['npm']).toBeUndefined();
  });

  it('creates an ecosystem bucket (zero-count) when a matched package has no vulnerabilities array', () => {
    const result = parseOsvJsonOutput(
      makeStdout({ noVulnerabilities: true }),
      makeConfig(),
      makeRegistry(),
    );
    expect(result.ecosystems['npm']?.vulnerabilities_total).toBe(0);
    expect(result.ecosystems['npm']?.vulnerabilities).toEqual([]);
  });

  it('falls back to empty strings for null package name/version fields', () => {
    const stdout = JSON.stringify({
      results: [{ packages: [{ package: { name: null, version: null, ecosystem: 'npm' }, vulnerabilities: [] }] }],
    });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities_total).toBe(0);
  });

  it('falls back to empty strings for null vuln id/summary fields', () => {
    const stdout = JSON.stringify({
      results: [{
        packages: [{
          package: { name: 'lodash', version: '4.17.15', ecosystem: 'npm' },
          vulnerabilities: [{ id: null, summary: null, affected: [{ ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] }],
        }],
      }],
    });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    const vuln = result.ecosystems['npm']?.vulnerabilities[0];
    expect(vuln?.ghsaId).toBe('');
    expect(vuln?.risk).toBe('');
  });

  it('uses the empty-map fallback when the resolved plugin is not present in the registry protected-package map', () => {
    // findByOsvEcosystem resolves a plugin that getAll() never returned, so
    // protectedByPlugin.get(pluginId) misses and the ?? new Map() fallback fires.
    const stdout = makeStdout({ vulns: [makeVuln({ ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] })] });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry({ ghost: true }));
    expect(result.ecosystems['npm']?.vulnerabilities).toHaveLength(1);
  });

  it('deduplicates repeated package refs within the same classification bucket', () => {
    // Two vulnerabilities for the same package@version, both auto_safe — the package
    // ref must appear once in auto_safe_packages even though the counter increments twice.
    const stdout = makeStdout({
      pkgName: 'lodash',
      pkgVersion: '4.17.0',
      vulns: [
        makeVuln({ id: 'GHSA-one', ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.5' }] }] }),
        makeVuln({ id: 'GHSA-two', ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.10' }] }] }),
      ],
    });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    const npm = result.ecosystems['npm']!;
    expect(npm.auto_safe).toBe(2);
    expect(npm.auto_safe_packages).toEqual(['lodash@4.17.0']);
  });

  it('classifies a major-version-bump fix as "breaking"', () => {
    const stdout = makeStdout({
      pkgName: 'legacy-pkg',
      pkgVersion: '1.2.3',
      vulns: [makeVuln({ ranges: [{ events: [{ introduced: '0' }, { fixed: '2.0.0' }] }] })],
    });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    const vuln = result.ecosystems['npm']?.vulnerabilities[0];
    expect(vuln?.classification).toBe('breaking');
    expect(result.ecosystems['npm']?.breaking_packages).toContain('legacy-pkg@1.2.3');
  });

  it('classifies a package with no available safe version as "manual"', () => {
    const stdout = makeStdout({
      pkgName: 'unfixed-pkg',
      pkgVersion: '1.0.0',
      vulns: [makeVuln({ ranges: [{ events: [{ introduced: '0' }, { last_affected: '9.99.99' }] }] })],
    });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    const vuln = result.ecosystems['npm']?.vulnerabilities[0];
    expect(vuln?.classification).toBe('manual');
    expect(result.ecosystems['npm']?.manual_packages).toContain('unfixed-pkg@1.0.0');
  });

  it('aggregates multiple packages across multiple result entries into the same ecosystem bucket', () => {
    const stdout = JSON.stringify({
      results: [
        { packages: [{ package: { name: 'pkg-a', version: '1.0.0', ecosystem: 'npm' }, vulnerabilities: [makeVuln({ ranges: [{ events: [{ introduced: '0' }, { fixed: '1.5.0' }] }] })] }] },
        { packages: [{ package: { name: 'pkg-b', version: '2.0.0', ecosystem: 'npm' }, vulnerabilities: [makeVuln({ ranges: [{ events: [{ introduced: '0' }, { fixed: '2.5.0' }] }] })] }] },
      ],
    });
    const result = parseOsvJsonOutput(stdout, makeConfig(), makeRegistry());
    expect(result.ecosystems['npm']?.vulnerabilities_total).toBe(2);
    expect(result.ecosystems['npm']?.vulnerabilities.map((v) => v.package)).toEqual(['pkg-a', 'pkg-b']);
  });
});
