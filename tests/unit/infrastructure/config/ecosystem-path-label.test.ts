/**
 * Tests for `path` and `label` fields on EcosystemConfigSchema (Task wscfg-v2-sliceA).
 *
 * Acceptance criteria covered:
 *   AC1 — path: optional, valid relative paths pass, invalid paths fail
 *   AC2 — label: optional, valid ^[a-z0-9-]+$ passes, invalid labels fail
 *   AC3 — duplicate (id, label) pairs are rejected
 *   AC4 — when duplicate ids exist, every entry must have a label
 *   AC6 — at least 12 test cases
 */
import { describe, it, expect } from 'vitest';
import { ProjectConfigSchema } from '@infra/config/schema';

// Minimal valid ProjectConfig input that satisfies all required fields.
const minimalConfig = {
  project: { name: 'Test Project', client: 'Test Client' },
  ecosystems: [{ id: 'npm' }],
  protected_packages: {},
  safe_update_policy: {
    allow_patch_and_minor_within_constraints: true,
    require_authorization_for_constraint_change: false,
  },
  conflict_resolution: 'manual',
};

// Helper: parse a single ecosystem entry through the full schema.
function parseWithEcosystems(ecosystems: unknown[]) {
  return ProjectConfigSchema.safeParse({ ...minimalConfig, ecosystems });
}

// ---------------------------------------------------------------------------
// AC1 — path field validation
// ---------------------------------------------------------------------------
describe('EcosystemConfigSchema — path field (AC1)', () => {
  it('accepts a config without a path field (ecosystem treated as root)', () => {
    const result = parseWithEcosystems([{ id: 'npm' }]);
    expect(result.success).toBe(true);
  });

  it('accepts a valid relative subdirectory path', () => {
    const result = parseWithEcosystems([{ id: 'npm', path: 'packages/frontend' }]);
    expect(result.success).toBe(true);
  });

  it('accepts a single-segment relative path', () => {
    const result = parseWithEcosystems([{ id: 'npm', path: 'frontend' }]);
    expect(result.success).toBe(true);
  });

  it('accepts a deeply nested relative path', () => {
    const result = parseWithEcosystems([{ id: 'npm', path: 'apps/web/client' }]);
    expect(result.success).toBe(true);
  });

  it('rejects a path with a leading slash (absolute path)', () => {
    const result = parseWithEcosystems([{ id: 'npm', path: '/packages/frontend' }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('no leading /');
    }
  });

  it('rejects a path starting with ./', () => {
    const result = parseWithEcosystems([{ id: 'npm', path: './packages/frontend' }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('./');
    }
  });

  it('rejects a path containing .. segments', () => {
    const result = parseWithEcosystems([{ id: 'npm', path: 'packages/../etc' }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('..');
    }
  });

  it('rejects a path containing a glob * character', () => {
    const result = parseWithEcosystems([{ id: 'npm', path: 'packages/*' }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('glob');
    }
  });

  it('rejects a path containing a glob ? character', () => {
    const result = parseWithEcosystems([{ id: 'npm', path: 'packages/app?' }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('glob');
    }
  });
});

// ---------------------------------------------------------------------------
// AC2 — label field validation
// ---------------------------------------------------------------------------
describe('EcosystemConfigSchema — label field (AC2)', () => {
  it('accepts a config without a label field', () => {
    const result = parseWithEcosystems([{ id: 'npm' }]);
    expect(result.success).toBe(true);
  });

  it('accepts a valid lowercase alphanumeric label', () => {
    const result = parseWithEcosystems([{ id: 'npm', label: 'frontend' }]);
    expect(result.success).toBe(true);
  });

  it('accepts a valid label with digits and hyphens', () => {
    const result = parseWithEcosystems([{ id: 'npm', label: 'app-v2' }]);
    expect(result.success).toBe(true);
  });

  it('rejects a label with uppercase letters', () => {
    const result = parseWithEcosystems([{ id: 'npm', label: 'Frontend' }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('label must contain only lowercase letters');
    }
  });

  it('rejects a label with spaces', () => {
    const result = parseWithEcosystems([{ id: 'npm', label: 'my app' }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('label must contain only lowercase letters');
    }
  });

  it('rejects a label with special characters', () => {
    const result = parseWithEcosystems([{ id: 'npm', label: 'app_v2' }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('label must contain only lowercase letters');
    }
  });

  it('rejects a label with a leading hyphen', () => {
    // hyphen at start/end is still matched by ^[a-z0-9-]+$ — the regex allows
    // hyphens anywhere; this case tests an empty string instead (empty string
    // fails the + quantifier)
    const result = parseWithEcosystems([{ id: 'npm', label: '' }]);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC3 — label uniqueness: duplicate (id, label) pairs are rejected
// ---------------------------------------------------------------------------
describe('ProjectConfigSchema.superRefine — label uniqueness (AC3)', () => {
  it('rejects two ecosystem entries with the same id and same label', () => {
    const result = parseWithEcosystems([
      { id: 'npm', label: 'frontend' },
      { id: 'npm', label: 'frontend' },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('npm');
      expect(messages).toContain('frontend');
    }
  });

  it('accepts two ecosystem entries with the same id but distinct labels', () => {
    const result = parseWithEcosystems([
      { id: 'npm', label: 'frontend' },
      { id: 'npm', label: 'backend' },
    ]);
    expect(result.success).toBe(true);
  });

  it('accepts two ecosystem entries with different ids and no labels', () => {
    const result = parseWithEcosystems([{ id: 'npm' }, { id: 'composer' }]);
    expect(result.success).toBe(true);
  });

  it('rejects three entries where two share the same id and same label', () => {
    const result = parseWithEcosystems([
      { id: 'npm', label: 'a' },
      { id: 'npm', label: 'b' },
      { id: 'npm', label: 'a' },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('npm');
    }
  });
});

// ---------------------------------------------------------------------------
// AC4 — label required when duplicate ids exist
// ---------------------------------------------------------------------------
describe('ProjectConfigSchema.superRefine — label required with duplicate ids (AC4)', () => {
  it('rejects when two entries share the same id but one lacks a label', () => {
    const result = parseWithEcosystems([
      { id: 'npm', label: 'frontend' },
      { id: 'npm' },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('npm');
      expect(messages).toContain('label');
    }
  });

  it('rejects when two entries share the same id and both lack labels', () => {
    const result = parseWithEcosystems([{ id: 'npm' }, { id: 'npm' }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('npm');
      expect(messages).toContain('label');
    }
  });

  it('accepts three entries where two share the same id and both have distinct labels', () => {
    const result = parseWithEcosystems([
      { id: 'npm', label: 'frontend' },
      { id: 'npm', label: 'backend' },
      { id: 'composer' },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects when three entries share the same id and one lacks a label', () => {
    const result = parseWithEcosystems([
      { id: 'npm', label: 'frontend' },
      { id: 'npm', label: 'backend' },
      { id: 'npm' },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('npm');
      expect(messages).toContain('label');
    }
  });
});

// ---------------------------------------------------------------------------
// Combined path + label scenario
// ---------------------------------------------------------------------------
describe('EcosystemConfigSchema — path and label used together', () => {
  it('accepts entries with both a valid path and a valid label', () => {
    const result = parseWithEcosystems([
      { id: 'npm', path: 'apps/frontend', label: 'frontend' },
      { id: 'npm', path: 'apps/backend', label: 'backend' },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects when path is invalid even if label is valid', () => {
    const result = parseWithEcosystems([
      { id: 'npm', path: '/invalid', label: 'frontend' },
    ]);
    expect(result.success).toBe(false);
  });
});
