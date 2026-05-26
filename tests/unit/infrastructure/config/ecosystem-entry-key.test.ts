/**
 * Tests for ecosystemEntryKey() — unique key derivation per EcosystemConfig entry.
 *
 * Acceptance criteria:
 *   AC1 — no label → returns entry.id
 *   AC2 — with label → returns "id:label" composite
 *   AC3 — different entries with same id but different labels produce distinct keys
 *   AC4 — edge cases: empty string fields, undefined label
 */
import { describe, it, expect } from 'vitest';
import { ecosystemEntryKey } from '@infra/config/ecosystem-entry-key';

// ── AC1: no label → returns entry.id ─────────────────────────────────────────

describe('ecosystemEntryKey — AC1: no label returns entry.id', () => {
  it('returns id when label is undefined', () => {
    expect(ecosystemEntryKey({ id: 'npm' })).toBe('npm');
  });

  it('returns id when label is explicitly undefined', () => {
    expect(ecosystemEntryKey({ id: 'composer', label: undefined })).toBe('composer');
  });

  it('returns id for pip with no label', () => {
    expect(ecosystemEntryKey({ id: 'pip' })).toBe('pip');
  });

  it('returns id for any arbitrary plugin id with no label', () => {
    expect(ecosystemEntryKey({ id: 'custom-plugin' })).toBe('custom-plugin');
  });
});

// ── AC2: with label → returns "id:label" composite ───────────────────────────

describe('ecosystemEntryKey — AC2: with label returns id:label composite', () => {
  it('returns "npm:frontend" for npm with label=frontend', () => {
    expect(ecosystemEntryKey({ id: 'npm', label: 'frontend' })).toBe('npm:frontend');
  });

  it('returns "npm:backend" for npm with label=backend', () => {
    expect(ecosystemEntryKey({ id: 'npm', label: 'backend' })).toBe('npm:backend');
  });

  it('returns "pip:api" for pip with label=api', () => {
    expect(ecosystemEntryKey({ id: 'pip', label: 'api' })).toBe('pip:api');
  });

  it('returns "composer:legacy" for composer with label=legacy', () => {
    expect(ecosystemEntryKey({ id: 'composer', label: 'legacy' })).toBe('composer:legacy');
  });

  it('returns composite with hyphenated label', () => {
    expect(ecosystemEntryKey({ id: 'npm', label: 'app-v2' })).toBe('npm:app-v2');
  });

  it('returns composite with numeric label', () => {
    expect(ecosystemEntryKey({ id: 'npm', label: '42' })).toBe('npm:42');
  });
});

// ── AC3: different entries with same id but different labels produce distinct keys ──

describe('ecosystemEntryKey — AC3: distinct keys for same id, different labels', () => {
  it('two npm entries with frontend/backend labels produce distinct keys', () => {
    const key1 = ecosystemEntryKey({ id: 'npm', label: 'frontend' });
    const key2 = ecosystemEntryKey({ id: 'npm', label: 'backend' });
    expect(key1).not.toBe(key2);
    expect(key1).toBe('npm:frontend');
    expect(key2).toBe('npm:backend');
  });

  it('a labeled entry and an unlabeled entry of the same id produce distinct keys', () => {
    const labeled = ecosystemEntryKey({ id: 'npm', label: 'web' });
    const unlabeled = ecosystemEntryKey({ id: 'npm' });
    expect(labeled).not.toBe(unlabeled);
  });

  it('three pip entries with different labels all produce distinct keys', () => {
    const keys = [
      ecosystemEntryKey({ id: 'pip', label: 'api' }),
      ecosystemEntryKey({ id: 'pip', label: 'worker' }),
      ecosystemEntryKey({ id: 'pip', label: 'scripts' }),
    ];
    const unique = new Set(keys);
    expect(unique.size).toBe(3);
  });

  it('same label on different ids produces distinct keys', () => {
    const npmFrontend = ecosystemEntryKey({ id: 'npm', label: 'frontend' });
    const pipFrontend = ecosystemEntryKey({ id: 'pip', label: 'frontend' });
    expect(npmFrontend).not.toBe(pipFrontend);
    expect(npmFrontend).toBe('npm:frontend');
    expect(pipFrontend).toBe('pip:frontend');
  });
});

// ── AC4: edge cases ───────────────────────────────────────────────────────────

describe('ecosystemEntryKey — AC4: edge cases', () => {
  it('treats empty string label as falsy → returns id only', () => {
    // An empty string label means no label was effectively set.
    // Schema enforces ^[a-z0-9-]+$ (min length 1), but the function
    // must handle the edge case gracefully: empty string → id only.
    expect(ecosystemEntryKey({ id: 'npm', label: '' })).toBe('npm');
  });

  it('is a pure function — same input always produces same output', () => {
    const entry = { id: 'npm', label: 'frontend' };
    expect(ecosystemEntryKey(entry)).toBe(ecosystemEntryKey(entry));
  });

  it('does not mutate the input entry', () => {
    const entry = { id: 'npm', label: 'frontend' };
    const keyBefore = JSON.stringify(entry);
    ecosystemEntryKey(entry);
    expect(JSON.stringify(entry)).toBe(keyBefore);
  });

  it('accepts a minimal entry with only id and label fields (Pick type)', () => {
    // The function accepts Pick<EcosystemConfig, 'id' | 'label'> so extra fields are ignored
    const entry = { id: 'npm', label: 'web', path: 'apps/web', fixer: 'osv' as const };
    expect(ecosystemEntryKey(entry)).toBe('npm:web');
  });
});

// ── Integration: orchestrator updates keying ──────────────────────────────────

describe('ecosystemEntryKey — integration: monorepo update record keying', () => {
  it('generates non-colliding keys for a typical monorepo config', () => {
    // Simulates two npm entries and one pip entry in a monorepo
    const entries = [
      { id: 'npm', label: 'frontend' },
      { id: 'npm', label: 'backend' },
      { id: 'pip' },
    ];
    const keys = entries.map(ecosystemEntryKey);
    expect(keys).toEqual(['npm:frontend', 'npm:backend', 'pip']);
    expect(new Set(keys).size).toBe(3);
  });

  it('generates the expected key for a tramontina-trade style config', () => {
    // pip at api/app with label "app", npm at web with label "web"
    const pipEntry = { id: 'pip', label: 'app' };
    const npmEntry = { id: 'npm', label: 'web' };
    expect(ecosystemEntryKey(pipEntry)).toBe('pip:app');
    expect(ecosystemEntryKey(npmEntry)).toBe('npm:web');
  });

  it('single-entry configs (no label) use plain id keys', () => {
    const entries = [{ id: 'npm' }, { id: 'composer' }, { id: 'pip' }];
    const keys = entries.map(ecosystemEntryKey);
    expect(keys).toEqual(['npm', 'composer', 'pip']);
  });
});
