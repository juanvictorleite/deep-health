/**
 * Tests for BuildConfig / build: {} validation in
 * NpmRunnerConfigSchema, PipRunnerConfigSchema, and ComposerRunnerConfigSchema.
 *
 * Runner config is per-ecosystem via ecosystems[].runner.
 *
 * Covers:
 *  (1) passes with empty runner {}
 *  (2) passes with build: { dockerfile: 'Dockerfile' }
 *  (3) passes with image + build together (no longer mutually exclusive)
 *  (4) fails with build: {} (missing dockerfile)
 *  (5) fails with build: { dockerfile: './Dockerfile' } (dot-slash)
 *  (6) fails with build: { dockerfile: '../Dockerfile' } (traversal)
 *  (7) passes with build: { dockerfile, target, context, args }
 *  (8) target rejects invalid chars
 */
import { ProjectConfigSchema } from '@infra/config/schema';
import { describe, it, expect } from 'vitest';


/** Minimal valid project config skeleton — runner is configured per-ecosystem. */
function makeConfigWithEcosystemRunner(ecosystemId: string, runner: Record<string, unknown>): unknown {
  return {
    config_version: '1',
    project: { name: 'Test', client: 'Test' },
    ecosystems: [{ id: ecosystemId, runner }],
    protected_packages: { npm: [] },
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: false,
    },
    conflict_resolution: 'manual',
  };
}

describe('ProjectConfigSchema — build config validation (per-ecosystem runner)', () => {
  // ─── npm ───────────────────────────────────────────────────────────────────

  describe('ecosystems[npm].runner', () => {
    // (1) passes with empty runner {}
    it('(1) passes with empty runner {}', () => {
      const result = ProjectConfigSchema.safeParse(makeConfigWithEcosystemRunner('npm', {}));
      expect(result.success).toBe(true);
    });

    // (2) passes with build: { dockerfile: 'Dockerfile' }
    it('(2) passes with build: { dockerfile: "Dockerfile" }', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', { build: { dockerfile: 'Dockerfile' } }),
      );
      expect(result.success).toBe(true);
    });

    // (3) passes with image + build together (no longer mutually exclusive)
    it('(3) passes with image + build together (coexistence is valid)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', {
          image: 'node:20',
          build: { dockerfile: 'Dockerfile' },
        }),
      );
      expect(result.success).toBe(true);
    });

    // (4) fails with build: {} (missing dockerfile)
    it('(4) fails with build: {} (dockerfile is required)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', { build: {} }),
      );
      expect(result.success).toBe(false);
    });

    // (5) fails with build: { dockerfile: './Dockerfile' } (dot-slash)
    it('(5) fails with build: { dockerfile: "./Dockerfile" } (dot-slash prefix)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', { build: { dockerfile: './Dockerfile' } }),
      );
      expect(result.success).toBe(false);
      const messages = result.error?.issues.map((i) => i.message) ?? [];
      expect(messages.some((m) => m.includes('must not start with ./'))).toBe(true);
    });

    // (6) fails with build: { dockerfile: '../Dockerfile' } (traversal)
    it('(6) fails with build: { dockerfile: "../Dockerfile" } (parent traversal)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', { build: { dockerfile: '../Dockerfile' } }),
      );
      expect(result.success).toBe(false);
      const messages = result.error?.issues.map((i) => i.message) ?? [];
      expect(messages.some((m) => m.includes('must not start with ../'))).toBe(true);
    });

    // (7) passes with full build object
    it('(7) passes with build: { dockerfile, target, context, args }', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', {
          build: {
            dockerfile: 'Dockerfile',
            target: 'node-stage',
            context: '.',
            args: { NODE_VERSION: '20' },
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    // (8) target rejects invalid chars
    it('(8) fails when build.target contains invalid characters (spaces)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', {
          build: {
            dockerfile: 'Dockerfile',
            target: 'my stage',
          },
        }),
      );
      expect(result.success).toBe(false);
    });

    it('(8) fails when build.target contains invalid characters (dot)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', {
          build: {
            dockerfile: 'Dockerfile',
            target: 'my.stage',
          },
        }),
      );
      expect(result.success).toBe(false);
    });

    it('(8) passes when build.target contains only valid chars (alphanumeric, underscore, hyphen)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', {
          build: {
            dockerfile: 'Dockerfile',
            target: 'my-stage_v2',
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    it('rejects unknown field runners at top-level config (.strict() enforcement)', () => {
      const result = ProjectConfigSchema.safeParse({
        config_version: '1',
        project: { name: 'Test', client: 'Test' },
        ecosystems: [{ id: 'npm' }],
        protected_packages: { npm: [] },
        safe_update_policy: {
          allow_patch_and_minor_within_constraints: true,
          require_authorization_for_constraint_change: false,
        },
        conflict_resolution: 'manual',
        runners: { npm: { language_version: '20' } },
      });
      expect(result.success).toBe(false);
    });

    it('passes with language_version only (no build)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', { language_version: '20' }),
      );
      expect(result.success).toBe(true);
    });
  });

  // ─── pip ───────────────────────────────────────────────────────────────────

  describe('ecosystems[pip].runner', () => {
    it('(1) passes with empty runner {}', () => {
      const result = ProjectConfigSchema.safeParse(makeConfigWithEcosystemRunner('pip', {}));
      expect(result.success).toBe(true);
    });

    it('(2) passes with build: { dockerfile: ".docker/pip.Dockerfile" }', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('pip', { build: { dockerfile: '.docker/pip.Dockerfile' } }),
      );
      expect(result.success).toBe(true);
    });

    it('(3) passes with image + build together (coexistence is valid)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('pip', {
          image: 'python:3.11-slim',
          build: { dockerfile: 'Dockerfile' },
        }),
      );
      expect(result.success).toBe(true);
    });

    it('(4) fails with build: {} (dockerfile is required)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('pip', { build: {} }),
      );
      expect(result.success).toBe(false);
    });
  });

  // ─── build.dockerfile relative path validation ────────────────────────────

  describe('ecosystems[npm].runner — build.dockerfile relative path validation', () => {
    const validPaths = ['Dockerfile', '.docker/node.Dockerfile', 'docker/Dockerfile'];
    const invalidPaths = ['./Dockerfile', '../Dockerfile', 'some/../Dockerfile'];

    for (const dockerfilePath of validPaths) {
      it(`passes when build.dockerfile is '${dockerfilePath}'`, () => {
        const result = ProjectConfigSchema.safeParse(
          makeConfigWithEcosystemRunner('npm', {
            build: { dockerfile: dockerfilePath },
          }),
        );
        expect(result.success).toBe(true);
      });
    }

    for (const dockerfilePath of invalidPaths) {
      it(`fails when build.dockerfile is '${dockerfilePath}'`, () => {
        const result = ProjectConfigSchema.safeParse(
          makeConfigWithEcosystemRunner('npm', {
            build: { dockerfile: dockerfilePath },
          }),
        );
        expect(result.success).toBe(false);
      });
    }

    it("rejects '../Dockerfile' with the parent-traversal error message (not the dot-slash message)", () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('npm', {
          build: { dockerfile: '../Dockerfile' },
        }),
      );
      expect(result.success).toBe(false);
      const messages = result.error?.issues.map((i) => i.message) ?? [];
      expect(messages.some((m) => m.includes('must not start with ../'))).toBe(true);
      expect(messages.some((m) => m.includes('parent directory traversal is not allowed'))).toBe(true);
      expect(messages.every((m) => !m.match(/must not start with \.\//))).toBe(true);
    });
  });

  // ─── composer ──────────────────────────────────────────────────────────────

  describe('ecosystems[composer].runner', () => {
    it('(1) passes with empty runner {}', () => {
      const result = ProjectConfigSchema.safeParse(makeConfigWithEcosystemRunner('composer', {}));
      expect(result.success).toBe(true);
    });

    it('(2) passes with build: { dockerfile: ".docker/php.Dockerfile" }', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('composer', { build: { dockerfile: '.docker/php.Dockerfile' } }),
      );
      expect(result.success).toBe(true);
    });

    it('(3) passes with image + build together (coexistence is valid)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('composer', {
          image: 'php:8.2-cli',
          build: { dockerfile: 'Dockerfile' },
        }),
      );
      expect(result.success).toBe(true);
    });

    it('(4) fails with build: {} (dockerfile is required)', () => {
      const result = ProjectConfigSchema.safeParse(
        makeConfigWithEcosystemRunner('composer', { build: {} }),
      );
      expect(result.success).toBe(false);
    });
  });
});
