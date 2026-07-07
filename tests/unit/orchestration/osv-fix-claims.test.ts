/**
 * Table tests for the pure osv-fix-claims seam (ADR 0017 / issue 0014).
 *
 * Covers:
 * - parseOsvFixJson: dedup (last-wins), malformed JSON, and every structural
 *   guard against malformed osv-scanner fix JSON shapes.
 * - claimIsSatisfiedOnDisk: exact match, semver-gte match, unsatisfied claims,
 *   non-semver exact-string matching, empty/undefined version sets.
 * - reconcileFixClaims: full verification, partial verification (satisfied /
 *   false claims split), and the root-version substitution on verified claims.
 *
 * These tests pin CURRENT behavior (moved verbatim from osv-fix-applier.ts,
 * ADR 0017) — they are regression pins, not aspirations. osv-fix-applier.test.ts
 * remains the untouched oracle for the staging adapter.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@infra/utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), phase: vi.fn(), skip: vi.fn(), header: vi.fn(), tagged: vi.fn() },
}));

import { logger } from '@infra/utils/logger.js';
import { parseOsvFixJson, claimIsSatisfiedOnDisk, reconcileFixClaims, type PackageUpdate } from '@orchestration/osv-fix-claims';

function osvFixJsonFor(updates: PackageUpdate[]): string {
  return JSON.stringify({ patches: [{ packageUpdates: updates }] });
}

// ── parseOsvFixJson ────────────────────────────────────────────────────────────

describe('parseOsvFixJson', () => {
  it('parses a single patch with a single package update', () => {
    const result = parseOsvFixJson(osvFixJsonFor([
      { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' },
    ]));

    expect(result).toEqual([{ name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' }]);
  });

  it('dedupes duplicate package names across patches — last one wins', () => {
    const result = parseOsvFixJson(JSON.stringify({
      patches: [
        { packageUpdates: [{ name: 'lodash', versionFrom: '4.17.18', versionTo: '4.17.20' }] },
        { packageUpdates: [{ name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' }] },
      ],
    }));

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' });
  });

  it('returns [] and logs a warning on malformed JSON', () => {
    const result = parseOsvFixJson('NOT_VALID_JSON');

    expect(result).toEqual([]);
    expect((logger.tagged as ReturnType<typeof vi.fn>).mock.calls.some((c) =>
      String(c[2]).includes('Could not parse osv-scanner fix JSON output'),
    )).toBe(true);
  });

  it.each([
    ['null document', 'null'],
    ['non-object document', '"just a string"'],
    ['object without patches array', '{"notPatches":[]}'],
    ['patches is not an array', '{"patches":"nope"}'],
  ])('returns [] for %s', (_label, stdout) => {
    expect(parseOsvFixJson(stdout)).toEqual([]);
  });

  it('skips a null entry inside patches[]', () => {
    const result = parseOsvFixJson(JSON.stringify({
      patches: [null, { packageUpdates: [{ name: 'lodash', versionFrom: '1.0.0', versionTo: '1.0.1' }] }],
    }));

    expect(result).toEqual([{ name: 'lodash', versionFrom: '1.0.0', versionTo: '1.0.1' }]);
  });

  it('skips a patch whose packageUpdates is not an array', () => {
    const result = parseOsvFixJson(JSON.stringify({
      patches: [{ packageUpdates: 'not-array' }],
    }));

    expect(result).toEqual([]);
  });

  it('skips a null entry inside packageUpdates[]', () => {
    const result = parseOsvFixJson(JSON.stringify({
      patches: [{ packageUpdates: [null, { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' }] }],
    }));

    expect(result).toEqual([{ name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' }]);
  });

  it('skips an update with an empty/missing name', () => {
    const result = parseOsvFixJson(JSON.stringify({
      patches: [{ packageUpdates: [{ name: '', versionFrom: '1.0', versionTo: '2.0' }] }],
    }));

    expect(result).toEqual([]);
  });

  it('coerces missing versionFrom/versionTo to empty strings', () => {
    const result = parseOsvFixJson(JSON.stringify({
      patches: [{ packageUpdates: [{ name: 'lodash' }] }],
    }));

    expect(result).toEqual([{ name: 'lodash', versionFrom: '', versionTo: '' }]);
  });
});

// ── claimIsSatisfiedOnDisk ──────────────────────────────────────────────────────

describe('claimIsSatisfiedOnDisk', () => {
  const claim = (versionTo: string): PackageUpdate => ({ name: 'lodash', versionFrom: '0.0.0', versionTo });

  it('returns false when versionsOnDisk is undefined', () => {
    expect(claimIsSatisfiedOnDisk(claim('4.17.21'), undefined)).toBe(false);
  });

  it('returns false when versionsOnDisk is empty', () => {
    expect(claimIsSatisfiedOnDisk(claim('4.17.21'), new Set())).toBe(false);
  });

  it('returns true on exact match', () => {
    expect(claimIsSatisfiedOnDisk(claim('4.17.21'), new Set(['4.17.21']))).toBe(true);
  });

  it('returns true when disk has a strictly newer semver version', () => {
    expect(claimIsSatisfiedOnDisk(claim('4.17.21'), new Set(['4.17.22']))).toBe(true);
  });

  it('returns false when disk has only an older semver version', () => {
    expect(claimIsSatisfiedOnDisk(claim('4.17.21'), new Set(['4.17.19']))).toBe(false);
  });

  it('returns false when claimed versionTo is not valid semver and no exact match exists', () => {
    expect(claimIsSatisfiedOnDisk(claim('not-semver'), new Set(['4.17.21']))).toBe(false);
  });

  it('matches non-semver versionTo only by exact string equality', () => {
    expect(claimIsSatisfiedOnDisk(claim('git://ref#abc'), new Set(['git://ref#abc']))).toBe(true);
    expect(claimIsSatisfiedOnDisk(claim('git://ref#abc'), new Set(['git://ref#def']))).toBe(false);
  });

  it('ignores invalid semver entries on disk when scanning for a gte match', () => {
    expect(claimIsSatisfiedOnDisk(claim('4.17.21'), new Set(['not-semver', '4.17.22']))).toBe(true);
  });
});

// ── reconcileFixClaims ──────────────────────────────────────────────────────────

describe('reconcileFixClaims', () => {
  it('verifies all claims present on disk, all dropped empty', () => {
    const claims: PackageUpdate[] = [
      { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' },
      { name: 'axios', versionFrom: '1.6.0', versionTo: '1.7.0' },
    ];
    const versionsOnDisk = new Map([
      ['lodash', new Set(['4.17.21'])],
      ['axios', new Set(['1.7.0'])],
    ]);
    const rootVersionsOnDisk = new Map<string, string>();

    const { verified, dropped } = reconcileFixClaims(claims, versionsOnDisk, rootVersionsOnDisk);

    expect(verified).toEqual(claims);
    expect(dropped).toEqual([]);
  });

  it('drops claims not satisfied on disk (false claim)', () => {
    const claims: PackageUpdate[] = [{ name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' }];
    const versionsOnDisk = new Map<string, Set<string>>();
    const rootVersionsOnDisk = new Map<string, string>();

    const { verified, dropped } = reconcileFixClaims(claims, versionsOnDisk, rootVersionsOnDisk);

    expect(verified).toEqual([]);
    expect(dropped).toEqual(claims);
  });

  it('partial verification: splits satisfied and unsatisfied claims', () => {
    const claims: PackageUpdate[] = [
      { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' },
      { name: 'bn.js', versionFrom: '4.12.0', versionTo: '4.12.3' },
    ];
    const versionsOnDisk = new Map([['lodash', new Set(['4.17.21'])]]);
    const rootVersionsOnDisk = new Map<string, string>();

    const { verified, dropped } = reconcileFixClaims(claims, versionsOnDisk, rootVersionsOnDisk);

    expect(verified.map((v) => v.name)).toEqual(['lodash']);
    expect(dropped.map((d) => d.name)).toEqual(['bn.js']);
  });

  it('substitutes the root version on disk for verified claims when known', () => {
    const claims: PackageUpdate[] = [{ name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' }];
    const versionsOnDisk = new Map([['lodash', new Set(['4.17.22'])]]);
    const rootVersionsOnDisk = new Map([['lodash', '4.17.22']]);

    const { verified } = reconcileFixClaims(claims, versionsOnDisk, rootVersionsOnDisk);

    expect(verified).toEqual([{ name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.22' }]);
  });

  it('falls back to the claimed versionTo when no root version is known', () => {
    const claims: PackageUpdate[] = [{ name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' }];
    const versionsOnDisk = new Map([['lodash', new Set(['4.17.21'])]]);
    const rootVersionsOnDisk = new Map<string, string>();

    const { verified } = reconcileFixClaims(claims, versionsOnDisk, rootVersionsOnDisk);

    expect(verified[0]!.versionTo).toBe('4.17.21');
  });

  it('returns empty verified/dropped for an empty claims list', () => {
    const { verified, dropped } = reconcileFixClaims([], new Map(), new Map());

    expect(verified).toEqual([]);
    expect(dropped).toEqual([]);
  });
});
