import { describe, it, expect } from 'vitest';
import { extractPackageName, mergeOsvFirstWins } from '@modules/ecosystem/fixers/index';
import type { OsvFixOutcome } from '@modules/ecosystem/fixers/index';

// ── extractPackageName unit tests ─────────────────────────────────────────────

describe('extractPackageName', () => {
  it('extracts name from non-scoped package spec with version', () => {
    expect(extractPackageName('lodash@4.17.21')).toBe('lodash');
  });

  it('extracts name from scoped package spec with version', () => {
    expect(extractPackageName('@scope/pkg@1.0.0')).toBe('@scope/pkg');
  });

  it('returns bare name when no version present (non-scoped)', () => {
    expect(extractPackageName('lodash')).toBe('lodash');
  });

  it('returns bare scoped name when no version present', () => {
    expect(extractPackageName('@scope/pkg')).toBe('@scope/pkg');
  });

  it('handles deep scoped package with patch version', () => {
    expect(extractPackageName('@babel/core@7.21.0')).toBe('@babel/core');
  });

  it('returns full spec when no @ found beyond position 0 for scoped package without version', () => {
    expect(extractPackageName('@org/tool')).toBe('@org/tool');
  });

  it('handles package with pre-release version', () => {
    expect(extractPackageName('react@18.0.0-rc.0')).toBe('react');
  });
});

// ── mergeOsvFirstWins unit tests ──────────────────────────────────────────────

describe('mergeOsvFirstWins — AC7(a): empty osvFixOutcome returns fixer packages as-is', () => {
  it('returns fixerPackages unchanged when osvFixOutcome is undefined', () => {
    const result = mergeOsvFirstWins(undefined, ['lodash@4.17.21', 'axios@1.7.0']);
    expect(result).toEqual(['lodash@4.17.21', 'axios@1.7.0']);
  });

  it('returns fixerPackages unchanged when osvFixOutcome has empty packagesUpdated', () => {
    const osvFixOutcome: OsvFixOutcome = { applied: false, packagesUpdated: [] };
    const result = mergeOsvFirstWins(osvFixOutcome, ['requests@2.31.0']);
    expect(result).toEqual(['requests@2.31.0']);
  });

  it('returns empty array when osvFixOutcome is undefined and fixerPackages is empty', () => {
    const result = mergeOsvFirstWins(undefined, []);
    expect(result).toEqual([]);
  });
});

describe('mergeOsvFirstWins — AC7(b): osv packages + empty fixer returns osv only', () => {
  it('returns OSV packages only when fixerPackages is empty', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' },
        { name: 'axios', versionFrom: '1.6.0', versionTo: '1.7.0' },
      ],
    };
    const result = mergeOsvFirstWins(osvFixOutcome, []);
    expect(result).toEqual(['lodash@4.17.21', 'axios@1.7.0']);
  });

  it('OSV packages appear in the same order as packagesUpdated', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'c', versionFrom: '1.0.0', versionTo: '1.1.0' },
        { name: 'a', versionFrom: '2.0.0', versionTo: '2.1.0' },
        { name: 'b', versionFrom: '3.0.0', versionTo: '3.1.0' },
      ],
    };
    const result = mergeOsvFirstWins(osvFixOutcome, []);
    expect(result).toEqual(['c@1.1.0', 'a@2.1.0', 'b@3.1.0']);
  });
});

describe('mergeOsvFirstWins — AC7(c): no overlap concatenates osv then fixer', () => {
  it('returns OSV packages first, then complementary fixer packages when no overlap', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' },
      ],
    };
    const result = mergeOsvFirstWins(osvFixOutcome, ['axios@1.7.0', 'minimist@1.2.8']);
    expect(result).toEqual(['lodash@4.17.21', 'axios@1.7.0', 'minimist@1.2.8']);
  });

  it('multiple OSV + multiple fixer with no overlap produces full concatenated list', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'pkg-a', versionFrom: '1.0.0', versionTo: '1.1.0' },
        { name: 'pkg-b', versionFrom: '2.0.0', versionTo: '2.1.0' },
      ],
    };
    const result = mergeOsvFirstWins(osvFixOutcome, ['pkg-c@3.1.0', 'pkg-d@4.2.0']);
    expect(result).toEqual(['pkg-a@1.1.0', 'pkg-b@2.1.0', 'pkg-c@3.1.0', 'pkg-d@4.2.0']);
  });
});

describe('mergeOsvFirstWins — AC7(d): overlap: OSV version wins, fixer version excluded', () => {
  it('OSV version is used when both OSV and fixer have the same package name', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' },
      ],
    };
    // Fixer claims lodash@4.17.22 (higher), but OSV-first-wins → OSV's 4.17.21 is kept
    const result = mergeOsvFirstWins(osvFixOutcome, ['lodash@4.17.22']);
    expect(result).toContain('lodash@4.17.21');
    expect(result).not.toContain('lodash@4.17.22');
    expect(result).toHaveLength(1);
  });

  it('mixed overlap: OSV wins for overlapping packages; fixer adds non-overlapping ones', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'axios', versionFrom: '1.6.0', versionTo: '1.7.0' },
        { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' },
      ],
    };
    // Fixer has lodash (overlap) and minimist (new)
    const result = mergeOsvFirstWins(osvFixOutcome, ['lodash@4.17.22', 'minimist@1.2.8']);
    expect(result).toContain('axios@1.7.0');
    expect(result).toContain('lodash@4.17.21'); // OSV version wins
    expect(result).not.toContain('lodash@4.17.22'); // fixer version excluded
    expect(result).toContain('minimist@1.2.8'); // complementary fixer package added
    expect(result).toHaveLength(3);
  });

  it('OSV wins even when fixer version is higher (ground truth = staging lockfile)', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'express', versionFrom: '4.17.0', versionTo: '4.18.0' },
      ],
    };
    const result = mergeOsvFirstWins(osvFixOutcome, ['express@4.19.0']);
    expect(result).toEqual(['express@4.18.0']);
  });

  it('all fixer packages excluded when all are already covered by OSV', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'a', versionFrom: '1.0.0', versionTo: '1.1.0' },
        { name: 'b', versionFrom: '2.0.0', versionTo: '2.1.0' },
      ],
    };
    const result = mergeOsvFirstWins(osvFixOutcome, ['a@1.2.0', 'b@2.2.0']);
    expect(result).toEqual(['a@1.1.0', 'b@2.1.0']);
  });
});

describe('mergeOsvFirstWins — AC7(e): scoped packages handled correctly', () => {
  it('handles scoped OSV package without fixer packages', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: '@babel/core', versionFrom: '7.20.0', versionTo: '7.21.0' },
      ],
    };
    const result = mergeOsvFirstWins(osvFixOutcome, []);
    expect(result).toEqual(['@babel/core@7.21.0']);
  });

  it('scoped OSV package wins over scoped fixer package with same name', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: '@angular/core', versionFrom: '15.0.0', versionTo: '15.1.0' },
      ],
    };
    const result = mergeOsvFirstWins(osvFixOutcome, ['@angular/core@15.2.0']);
    expect(result).toContain('@angular/core@15.1.0');
    expect(result).not.toContain('@angular/core@15.2.0');
    expect(result).toHaveLength(1);
  });

  it('scoped fixer package is added when not in OSV', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' },
      ],
    };
    const result = mergeOsvFirstWins(osvFixOutcome, ['@org/utils@2.0.0']);
    expect(result).toContain('lodash@4.17.21');
    expect(result).toContain('@org/utils@2.0.0');
    expect(result).toHaveLength(2);
  });

  it('mixed scoped and non-scoped packages handled correctly in both OSV and fixer', () => {
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: '@scope/pkg', versionFrom: '1.0.0', versionTo: '1.1.0' },
        { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.21' },
      ],
    };
    // fixer tries to overwrite @scope/pkg and adds @other/lib
    const result = mergeOsvFirstWins(osvFixOutcome, ['@scope/pkg@1.2.0', '@other/lib@3.0.0']);
    expect(result).toContain('@scope/pkg@1.1.0');   // OSV wins for @scope/pkg
    expect(result).not.toContain('@scope/pkg@1.2.0'); // fixer version excluded
    expect(result).toContain('lodash@4.17.21');       // OSV only
    expect(result).toContain('@other/lib@3.0.0');     // fixer only, complementary
    expect(result).toHaveLength(3);
  });
});

// ── OSV-first-wins in osv-then-audit-fixer context ────────────────────────────

describe('mergeOsvFirstWins — used in osv-then-audit-fixer context', () => {
  it('represents the corrected AC4a scenario: OSV version is kept even when audit has higher version', () => {
    // OSV fixed lodash@4.17.19 (only got to .19)
    // Audit fixed lodash@4.17.21 (upgraded higher)
    // New behavior: OSV wins (lodash@4.17.19), audit is excluded
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'axios', versionFrom: '1.6.0', versionTo: '1.7.0' },
        { name: 'lodash', versionFrom: '4.17.20', versionTo: '4.17.19' },
      ],
    };
    const auditVerified = ['lodash@4.17.21']; // audit found higher version
    const result = mergeOsvFirstWins(osvFixOutcome, auditVerified);

    expect(result).toContain('axios@1.7.0');      // OSV package preserved
    expect(result).toContain('lodash@4.17.19');   // OSV version wins (ground truth)
    expect(result).not.toContain('lodash@4.17.21'); // audit version excluded
    expect(result).toHaveLength(2);
  });

  it('represents AC4b scenario: OSV package not in audit is preserved, audit-only package added', () => {
    // OSV fixed axios; audit fixed lodash (no overlap with OSV)
    const osvFixOutcome: OsvFixOutcome = {
      applied: true,
      packagesUpdated: [
        { name: 'axios', versionFrom: '1.6.0', versionTo: '1.7.0' },
      ],
    };
    const auditVerified = ['lodash@4.17.21'];
    const result = mergeOsvFirstWins(osvFixOutcome, auditVerified);

    expect(result).toContain('axios@1.7.0');    // OSV package preserved
    expect(result).toContain('lodash@4.17.21'); // audit-only package added
    expect(result).toHaveLength(2);
  });

  it('represents AC4c scenario: when osvFixOutcome is absent, returns only auditVerified', () => {
    const result = mergeOsvFirstWins(undefined, ['lodash@4.17.21']);
    expect(result).toEqual(['lodash@4.17.21']);
  });
});
