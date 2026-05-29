import type { ProjectConfig, ProtectedPackage } from '@core/types/config';
import type { UpdateResultJson } from '@core/types/update';
import { COMPOSER_BOOTSTRAP, isPhpCliImage } from '@infra/provisioner/composer-runner';
import { resolveComposerDockerImage } from '@infra/provisioner/php-image-resolver';
import { COMPOSER_DEFAULT_IMAGE } from '@infra/provisioner/php-profiles';
import type { VersionSource } from '@infra/utils/infer-version';

import { runComposerUpdater } from './composer-updater';
import type { EcosystemPlugin, EcosystemUpdaterContext } from '../types';

// ─── Version inference helpers ────────────────────────────────────────────────

/**
 * Parse a `composer.json#require.php` constraint into a best-effort version string.
 *
 * Supported patterns:
 * - `>=8.2`   → "8.2"
 * - `^8.2`    → "8.2"
 * - `~8.2.0`  → "8.2.0"
 * - `8.2.*`   → "8.2"
 * - `8.2`     → "8.2"
 *
 * Returns undefined when the constraint is too broad or unparseable.
 */
function parseComposerPhpConstraint(constraint: string): string | undefined {
  const trimmed = constraint.trim();
  if (!trimmed || trimmed === '*') return undefined;

  // Take the first "version-like" part of potentially compound constraints
  const firstPart = trimmed.split(/\s*[|,&]\s*/)[0]?.trim();
  if (!firstPart) return undefined;

  // Handle wildcard suffix: "8.2.*" → "8.2"
  const wildcardMatch = firstPart.match(/[>=^~]*(\d[\d.]*)\.\*/);
  if (wildcardMatch) {
    return wildcardMatch[1] ?? undefined;
  }

  // General numeric version after operator prefix
  const match = firstPart.match(/[>=^~]*(\d[\d.]*)/);
  if (!match) return undefined;

  const version = match[1]!;
  if (!version || !/^\d[\d.]*$/.test(version)) return undefined;

  return version;
}

export const composerPlugin: EcosystemPlugin = {
  id: 'composer',
  name: 'Composer',
  manifest: 'composer.json',
  lockfile: 'composer.lock',
  // OSV returns 'packagist' for PHP packages; include 'composer' as fallback
  osvEcosystems: ['packagist', 'composer'],

  /** Label used in executive report evidence tables */
  reportLabel: 'PHP/Composer',

  /**
   * 'osv' (default): OSV-driven composer update only.
   * 'osv-then-audit': OSV update first, then composer audit to find additional packages.
   */
  supportedFixers: ['osv', 'osv-then-audit'],

  postUpdateOsvVerify: 'always',

  runtimeSpec: {
    defaultImage: COMPOSER_DEFAULT_IMAGE,
    resolveImage: resolveComposerDockerImage,
    containerBinaries: ['composer', 'php'],
    runMode: {
      kind: 'shell-wrap',
      preamble: (image) => (isPhpCliImage(image) ? COMPOSER_BOOTSTRAP : undefined),
    },
  },

  defaultValidationCommands: [
    { name: 'tests', command: 'php artisan test --compact' },
  ],

  defaultAdvisors: [
    { name: 'audit', command: 'composer audit' },
  ],

  buildScanArgs(): string[] {
    return ['--lockfile', 'composer.lock'];
  },

  getProtectedPackages(config: ProjectConfig): ProtectedPackage[] {
    return config.protected_packages['composer'] ?? [];
  },

  async runUpdater(ctx: EcosystemUpdaterContext): Promise<UpdateResultJson> {
    return runComposerUpdater(
      ctx.runner,
      ctx.config,
      ctx.scanResult,
      ctx.cwd,
      ctx.authorizeBreaking,
      ctx.validationCommands ?? [],
      ctx.fixerStrategy,
      ctx.preFixBackups,
      ctx.osvFixOutcome,
      ctx.preRunSnapshots,
      ctx.advisorResults,
      ctx.ecosystemKey,
    );
  },

  /**
   * Declarative version sources for PHP version inference.
   *
   * Precedence:
   * 1. `.php-version`
   * 2. `composer.json#require.php`
   */
  versionSources: [
    {
      file: '.php-version',
      label: '.php-version',
      extract: (content: string): string | undefined => {
        const stripped = content.replace(/^v/i, '').trim();
        if (stripped && /^\d[\d.]*$/.test(stripped)) {
          return stripped;
        }
        return undefined;
      },
    },
    {
      file: 'composer.json',
      label: 'composer.json#require.php',
      extract: (content: string): string | undefined => {
        try {
          const composer: unknown = JSON.parse(content);
          if (
            composer !== null &&
            typeof composer === 'object' &&
            'require' in (composer as Record<string, unknown>)
          ) {
            const req = (composer as Record<string, unknown>)['require'];
            if (typeof req === 'object' && req !== null && 'php' in req) {
              const phpConstraint = (req as Record<string, unknown>)['php'];
              if (typeof phpConstraint === 'string') {
                return parseComposerPhpConstraint(phpConstraint);
              }
            }
          }
        } catch {
          // malformed JSON — fall through
        }
        return undefined;
      },
    },
  ] satisfies VersionSource[],
};
