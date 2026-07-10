/**
 * Tests for config/loader.ts legacy-rejection, Zod-issue formatting, and
 * registry cross-validation branches.
 */

import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


vi.mock('@infra/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), tagged: vi.fn() },
}));

import { ConfigLoadError } from '@core/errors';
import type { ProjectConfig } from '@core/types/config';
import { loadConfig, validateEcosystemsAgainstRegistry } from '@infra/config/loader';
import { EcosystemRegistry } from '@modules/ecosystem/registry';
import type { EcosystemPlugin } from '@modules/ecosystem/types';
import { describe, it, expect, vi } from 'vitest';

// Minimal plugin stub
function makePluginStub(id: string, supportedFixers: string[]): EcosystemPlugin {
  return {
    id,
    name: id,
    lockfiles: [],
    osvEcosystems: [],
    reportLabel: id,
    supportedFixers,
    postUpdateOsvVerify: 'always',
    runtimeContainer: 'npm-docker' as const,
    defaultValidationCommands: [],
    defaultAdvisors: [],
    buildScanArgs: () => [],
    getProtectedPackages: () => [],
    runUpdater: async () => ({ agent: id, status: 'success', environment: 'local', packages_updated: [], validations: [] }),
  } as unknown as EcosystemPlugin;
}

async function writeTempConfig(content: string): Promise<string> {
  const dir = join(tmpdir(), `loader-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'security-scan.config.json');
  await writeFile(path, content, 'utf-8');
  return path;
}

// JSON with syntax error
const invalidJson = `{ "project": { "name": "broken"`;

describe('loadConfig() — JSON parse error branch', () => {
  it('returns Err with ConfigLoadError when JSON is malformed', async () => {
    const configPath = await writeTempConfig(invalidJson);
    const result = await loadConfig(configPath, '/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConfigLoadError);
      expect(result.error.message).toMatch(/Invalid JSON/);
    }
    await unlink(configPath);
  });
});

describe.each([
  {
    label: 'legacy scanners.npm field',
    config: { scanners: { npm: {} } },
    expectedMessage: /scanners\.npm/,
  },
  {
    label: 'legacy scanners.pip field',
    config: { scanners: { pip: {} } },
    expectedMessage: /scanners\.pip/,
  },
  {
    label: 'legacy scanners.composer field',
    config: { scanners: { composer: {} } },
    expectedMessage: /scanners\.composer/,
  },
  {
    label: 'top-level runners block',
    config: { runners: { npm: {} } },
    expectedMessage: /top-level 'runners' block/,
  },
  {
    label: 'ecosystems[].runner.mode with an id present',
    config: { ecosystems: [{ id: 'npm', runner: { mode: 'docker' } }] },
    expectedMessage: /ecosystems\[npm\]\.runner\.mode/,
  },
  {
    label: 'ecosystems[].runner.mode with a missing id falls back to "?"',
    config: { ecosystems: [{ runner: { mode: 'docker' } }] },
    expectedMessage: /ecosystems\[\?\]\.runner\.mode/,
  },
])('loadConfig() — legacy config rejection: $label', ({ config, expectedMessage }) => {
  it('returns Err(ConfigLoadError) carrying a migration message', async () => {
    const configPath = await writeTempConfig(JSON.stringify(config));
    const result = await loadConfig(configPath, '/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ConfigLoadError);
      expect(result.error.message).toMatch(expectedMessage);
    }
    await unlink(configPath);
  });
});

const VALID_BASE_CONFIG = {
  project: { name: 'demo', client: 'demo-client' },
  ecosystems: [{ id: 'npm' }],
  protected_packages: {},
  safe_update_policy: {
    allow_patch_and_minor_within_constraints: true,
    require_authorization_for_constraint_change: true,
  },
  conflict_resolution: 'manual',
};

describe('loadConfig() — Zod issue rendering', () => {
  it('reports unrecognized_keys with the offending key name when an object has an unknown field', async () => {
    const config = { ...VALID_BASE_CONFIG, project: { ...VALID_BASE_CONFIG.project, extra: 'nope' } };
    const configPath = await writeTempConfig(JSON.stringify(config));
    const result = await loadConfig(configPath, '/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('project:');
      expect(result.error.message).toContain('Unknown key(s) "extra"');
    }
    await unlink(configPath);
  });

  it('reports invalid_enum_value with the expected options when a field has an invalid enum value', async () => {
    const config = { ...VALID_BASE_CONFIG, report_language: 'klingon' };
    const configPath = await writeTempConfig(JSON.stringify(config));
    const result = await loadConfig(configPath, '/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('report_language:');
      expect(result.error.message).toContain('expected one of: "pt-br", "en"');
    }
    await unlink(configPath);
  });
});

describe('validateEcosystemsAgainstRegistry() — direct coverage', () => {
  it('returns error when plugin has no supported fixers but a fixer was specified', () => {
    const registry = new EcosystemRegistry();
    registry.register(makePluginStub('npm', [])); // no fixers

    const config = {
      ecosystems: [{ id: 'npm', fixer: 'osv' }],
    } as unknown as ProjectConfig;

    const errors = validateEcosystemsAgainstRegistry(config, registry);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('does not support any fixer strategy');
  });

  it('returns error when fixer is not in plugin supportedFixers list', () => {
    const registry = new EcosystemRegistry();
    registry.register(makePluginStub('npm', ['osv', 'npm-audit']));

    const config = {
      ecosystems: [{ id: 'npm', fixer: 'custom-fixer' }],
    } as unknown as ProjectConfig;

    const errors = validateEcosystemsAgainstRegistry(config, registry);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('custom-fixer');
  });

  it('returns empty errors when fixer is valid', () => {
    const registry = new EcosystemRegistry();
    registry.register(makePluginStub('npm', ['osv', 'npm-audit']));

    const config = {
      ecosystems: [{ id: 'npm', fixer: 'osv' }],
    } as unknown as ProjectConfig;

    const errors = validateEcosystemsAgainstRegistry(config, registry);
    expect(errors).toHaveLength(0);
  });

  it('returns error when ecosystem id is not registered', () => {
    const registry = new EcosystemRegistry();
    // registry is empty

    const config = {
      ecosystems: [{ id: 'ruby' }],
    } as unknown as ProjectConfig;

    const errors = validateEcosystemsAgainstRegistry(config, registry);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('"ruby"');
  });
});
