import { basename } from 'node:path';

import type { ProjectConfig, ProtectedPackage } from '@core/types/config';
import type { UpdateResultJson } from '@core/types/update';
import { resolveEcosystemImage, PIP_DEFAULT_IMAGE } from '@infra/provisioner/image-resolvers';
import type { VersionSource } from '@infra/utils/infer-version';

import { runPipUpdater } from './pip-updater';
import type { EcosystemPlugin, EcosystemUpdaterContext } from '../types';
import { detectPipTooling } from './pip-tooling-detector';
import type { PipToolingDetection } from './pip-tooling-detector';

/** Cached detection from prepareScan — consumed by buildScanArgs within the same scan cycle. */
let _cachedDetection: PipToolingDetection | undefined;

/** @internal Exposed for testing only. */
export function _resetDetectionCache(): void {
  _cachedDetection = undefined;
}

// ─── Version inference helpers ────────────────────────────────────────────────

/**
 * Extract a major.minor version from a raw Python version string.
 *
 * Rules:
 * - Trim whitespace; strip leading `v` (case-insensitive).
 * - Accept numeric versions like "3", "3.11", "3.11.2".
 * - Returns at most `major.minor` (e.g. "3.11.2" → "3.11", "3" → "3").
 * - Returns undefined for empty/non-numeric input.
 */
function extractPythonMajorMinor(raw: string): string | undefined {
  const stripped = raw.trim().replace(/^v/i, '');
  if (!stripped || !/^\d[\d.]*$/.test(stripped)) return undefined;
  const parts = stripped.split('.');
  // Keep at most major.minor
  const result = parts.slice(0, 2).join('.');
  return result || undefined;
}

/**
 * Parse a PEP 517 `requires-python` or `python_requires` constraint.
 *
 * Supported patterns:
 * - `>=3.10`   → "3.10"
 * - `^3.11`    → "3.11"
 * - `~=3.9.2`  → "3.9"  (major.minor only)
 * - `3.11`     → "3.11"
 *
 * Returns undefined when unparseable or too broad.
 */
function parsePythonConstraint(constraint: string): string | undefined {
  const trimmed = constraint.trim();
  if (!trimmed || trimmed === '*') return undefined;

  // Take the first "version-like" part of potentially compound constraints
  const firstPart = trimmed.split(/\s*[,|]\s*/)[0]?.trim();
  if (!firstPart) return undefined;

  // General numeric version after operator prefix
  const match = firstPart.match(/[>=^~!]*(\d[\d.]*)/);
  if (!match) return undefined;

  const version = match[1]!;
  if (!version || !/^\d[\d.]*$/.test(version)) return undefined;

  return extractPythonMajorMinor(version);
}

export const pipPlugin: EcosystemPlugin = {
  id: 'pip',
  name: 'pip',
  manifest: 'requirements.txt',
  osvEcosystems: ['PyPI'],

  /** Label used in executive report evidence tables */
  reportLabel: 'Python/pip',

  runtimeSpec: {
    defaultImage: PIP_DEFAULT_IMAGE,
    resolveImage: (version) => resolveEcosystemImage('pip', version),
    containerBinaries: ['pip', 'pip3'],
    runMode: { kind: 'shell-wrap' },
  },

  postUpdateOsvVerify: 'always',

  supportedFixers: ['osv'],

  defaultValidationCommands: [
    { name: 'check', command: 'pip check' },
  ],

  defaultAdvisors: [
    { name: 'audit', command: 'pip-audit --format json', format: 'json' as const },
  ],

  async prepareScan(entryCwd: string): Promise<void> {
    _cachedDetection = await detectPipTooling(entryCwd).catch(() => undefined);
  },

  buildScanArgs(): string[] {
    if (_cachedDetection?.lockfile) {
      return ['--lockfile', basename(_cachedDetection.lockfile)];
    }
    return ['--lockfile', 'requirements.txt'];
  },

  getProtectedPackages(config: ProjectConfig): ProtectedPackage[] {
    return config.protected_packages['pip'] ?? [];
  },

  async runUpdater(ctx: EcosystemUpdaterContext): Promise<UpdateResultJson> {
    // Detect tooling independently for fixer routing (scan-phase cache is separate)
    const detection = await detectPipTooling(ctx.cwd).catch(() => undefined);
    return runPipUpdater(
      ctx.runner,
      ctx.config,
      ctx.scanResult,
      ctx.cwd,
      ctx.authorizeBreaking,
      ctx.validationCommands ?? [],
      ctx.fixerStrategy ?? 'osv',
      ctx.preFixBackups,
      ctx.osvFixOutcome,
      ctx.preRunSnapshots,
      ctx.advisorResults,
      ctx.ecosystemKey,
      detection,
    );
  },

  /**
   * Declarative version sources for the pip ecosystem.
   *
   * Precedence:
   * 1. `.python-version`
   * 2. `.tool-versions` (asdf/mise format: `python X.Y.Z`)
   * 3. `pyproject.toml` (requires-python field)
   * 4. `setup.cfg` (python_requires field)
   * 5. `runtime.txt` (Heroku format: `python-X.Y.Z`)
   * 6. `Dockerfile` (FROM python:X.Y[.Z][-variant])
   * 7. `Pipfile` (python_version = 'X.Y')
   *
   * Returns at most major.minor (e.g. "3.11.2" → "3.11").
   */
  versionSources: [
    {
      file: '.python-version',
      label: '.python-version',
      extract: (content: string): string | undefined =>
        extractPythonMajorMinor(content),
    },
    {
      file: '.tool-versions',
      label: '.tool-versions (asdf/mise)',
      extract: (content: string): string | undefined => {
        for (const line of content.split('\n')) {
          const match = line.trim().match(/^python\s+(\S+)/i);
          if (match) {
            const version = extractPythonMajorMinor(match[1]!);
            if (version !== undefined) return version;
          }
        }
        return undefined;
      },
    },
    {
      file: 'pyproject.toml',
      label: 'pyproject.toml (requires-python)',
      extract: (content: string): string | undefined => {
        const match = content.match(/requires-python\s*=\s*["']([^"']+)["']/);
        if (!match) return undefined;
        return parsePythonConstraint(match[1]!);
      },
    },
    {
      file: 'setup.cfg',
      label: 'setup.cfg (python_requires)',
      extract: (content: string): string | undefined => {
        const match = content.match(/python_requires\s*=\s*(.+)/);
        if (!match) return undefined;
        return parsePythonConstraint(match[1]!.trim());
      },
    },
    {
      file: 'runtime.txt',
      label: 'runtime.txt (Heroku)',
      extract: (content: string): string | undefined => {
        const match = content.match(/^python-(\d[\d.]*)/i);
        if (!match) return undefined;
        return extractPythonMajorMinor(match[1]!);
      },
    },
    {
      file: 'Dockerfile',
      label: 'Dockerfile (FROM python:X.Y)',
      extract: (content: string): string | undefined => {
        const match = content.match(/^FROM\s+python:(\d[\d.]*)/im);
        if (!match) return undefined;
        return extractPythonMajorMinor(match[1]!);
      },
    },
    {
      file: 'Pipfile',
      label: 'Pipfile (python_version)',
      extract: (content: string): string | undefined => {
        const match = content.match(/python_version\s*=\s*["'](\S+)["']/);
        if (!match) return undefined;
        return extractPythonMajorMinor(match[1]!);
      },
    },
  ] satisfies VersionSource[],
};
