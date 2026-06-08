import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


import { ConfigLoadError } from '@core/errors';
import type { ProjectConfig } from '@core/types/config';
import type { Result } from '@core/types/result';
import { loadConfig, validateEcosystemsAgainstRegistry } from '@infra/config/loader';
import { composerPlugin } from '@modules/ecosystem/plugins/composer';
import { npmPlugin } from '@modules/ecosystem/plugins/npm';
import { EcosystemRegistry } from '@modules/ecosystem/registry';
import { describe, it, expect } from 'vitest';

import { withTempConfig, minimalConfigWithObj } from '../../helpers/config-fixtures';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../fixtures');

function makeRegistry(): EcosystemRegistry {
  const reg = new EcosystemRegistry();
  reg.register(npmPlugin);
  reg.register(composerPlugin);
  return reg;
}

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    project: { name: 'test', client: 'test' },
    ecosystems: [{ id: 'npm' }, { id: 'composer' }],
    protected_packages: {},
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: false,
    },
    conflict_resolution: 'fail',
    ...overrides,
  };
}

/**
 * Local test helper: unwrap a Result<T, unknown> or fail the test if it's an Err.
 */
function unwrapTest<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`Expected Ok but got Err: ${String((r as { error: unknown }).error)}`);
  return r.value;
}

describe('loadConfig', () => {
  it('loads a valid config file', async () => {
    const result = await loadConfig('security-scan.config.json', fixturesDir);
    expect(result.ok).toBe(true);
    const config = unwrapTest(result);
    expect(config.project.name).toBe('Test PHP Project');
    expect(config.project.client).toBe('Test Client');
    expect(config.protected_packages['composer']).toHaveLength(2);
    expect(config.protected_packages['npm']).toHaveLength(2);
  });

  it('loads ecosystems[] from config', async () => {
    const result = await loadConfig('security-scan.config.json', fixturesDir);
    expect(result.ok).toBe(true);
    const config = unwrapTest(result);
    expect(Array.isArray(config.ecosystems)).toBe(true);
    expect(config.ecosystems.length).toBeGreaterThanOrEqual(1);
    const ids = config.ecosystems.map((e) => e.id);
    expect(ids).toContain('composer');
    expect(ids).toContain('npm');
  });

  it('returns Err with ConfigLoadError when file does not exist', async () => {
    const result = await loadConfig('nonexistent.json', fixturesDir);
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(ConfigLoadError);
  });

  it('file-not-found error includes actionable hint', async () => {
    const result = await loadConfig('nonexistent.json', fixturesDir);
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(ConfigLoadError);
    expect((result.error as ConfigLoadError).message).toMatch(/security-scan init/i);
  });

  it('returns Err with ConfigLoadError for missing required fields', async () => {
    const incomplete = JSON.stringify({ project: { name: 'test' } }, null, 2);
    await withTempConfig(incomplete, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });

  it('returns Err with ConfigLoadError when ecosystems[] is empty', async () => {
    const json = JSON.stringify({
      config_version: '1',
      project: { name: 'test', client: 'test' },
      ecosystems: [],
      protected_packages: {},
      safe_update_policy: {
        allow_patch_and_minor_within_constraints: true,
        require_authorization_for_constraint_change: true,
      },
      conflict_resolution: 'stop_and_ask',
    }, null, 2);
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });

  it('correctly loads protected packages', async () => {
    const result = await loadConfig('security-scan.config.json', fixturesDir);
    expect(result.ok).toBe(true);
    const config = unwrapTest(result);
    const laravelFramework = config.protected_packages['composer']?.find(
      (p) => p.package === 'laravel/framework',
    );
    expect(laravelFramework).toBeDefined();
    expect(laravelFramework?.constraint).toBe('^10.8');
  });

  it('passes cross-validation with registry when all ecosystem ids are registered', async () => {
    const registry = makeRegistry();
    const result = await loadConfig('security-scan.config.json', fixturesDir, registry);
    expect(result.ok).toBe(true);
    const config = unwrapTest(result);
    expect(config.ecosystems.map((e) => e.id)).toContain('npm');
    expect(config.ecosystems.map((e) => e.id)).toContain('composer');
  });

  it('returns Err with ConfigLoadError when ecosystem id is not in registry', async () => {
    const json = JSON.stringify({
      config_version: '1',
      project: { name: 'test', client: 'test' },
      ecosystems: [{ id: 'unknown-eco' }],
      protected_packages: {},
      safe_update_policy: {
        allow_patch_and_minor_within_constraints: true,
        require_authorization_for_constraint_change: false,
      },
      conflict_resolution: 'fail',
    }, null, 2);
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const registry = makeRegistry();
      const result = await loadConfig(filename, dir, registry);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });

  it('returns Err with ConfigLoadError for invalid JSON syntax', async () => {
    const invalidJson = '{ "project": { "name": "broken"';
    await withTempConfig(invalidJson, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
      expect((result.error as ConfigLoadError).message).toMatch(/Invalid JSON/);
    });
  });

  it('JSON parse error message includes actionable hint', async () => {
    const invalidJson = '{ bad json }';
    await withTempConfig(invalidJson, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect((result.error as ConfigLoadError).message).toMatch(/jsonlint\.com/i);
    });
  });
});

describe('validateEcosystemsAgainstRegistry', () => {
  it('returns empty errors for valid ecosystems', () => {
    const registry = makeRegistry();
    const config = baseConfig({ ecosystems: [{ id: 'npm' }, { id: 'composer' }] });
    const errors = validateEcosystemsAgainstRegistry(config, registry);
    expect(errors).toHaveLength(0);
  });

  it('returns error for unknown ecosystem id', () => {
    const registry = makeRegistry();
    const config = baseConfig({ ecosystems: [{ id: 'cargo' }] });
    const errors = validateEcosystemsAgainstRegistry(config, registry);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/cargo/);
    expect(errors[0]).toMatch(/not registered/i);
  });

  it('returns error when fixer is incompatible with plugin', () => {
    const registry = makeRegistry();
    // composer does not support any fixers — specifying one is an error
    const config = baseConfig({ ecosystems: [{ id: 'composer', fixer: 'npm-audit' }] });
    const errors = validateEcosystemsAgainstRegistry(config, registry);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/composer/);
    expect(errors[0]).toMatch(/fixer/i);
  });

  it('returns error when fixer is not in supported list', () => {
    // composer supports no fixers; specifying npm-audit for it is unsupported
    const registry = makeRegistry();
    const config = baseConfig({ ecosystems: [{ id: 'composer', fixer: 'npm-audit' as const }] });
    const errors = validateEcosystemsAgainstRegistry(config, registry);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/npm-audit/);
    expect(errors[0]).toMatch(/does not support|not supported/i);
  });

  it('passes when fixer is in plugin supportedFixers', () => {
    const registry = makeRegistry();
    // npm supports 'npm-audit'
    const config = baseConfig({ ecosystems: [{ id: 'npm', fixer: 'npm-audit' }] });
    const errors = validateEcosystemsAgainstRegistry(config, registry);
    expect(errors).toHaveLength(0);
  });

  it('accumulates multiple errors', () => {
    const registry = makeRegistry();
    const config = baseConfig({
      ecosystems: [
        { id: 'unknown-a' },
        { id: 'unknown-b' },
      ],
    });
    const errors = validateEcosystemsAgainstRegistry(config, registry);
    expect(errors).toHaveLength(2);
  });
});

describe('fixer schema validation', () => {
  it('accepts fixer: osv in ecosystems[] (osv is the default fixer strategy for npm)', async () => {
    const json = JSON.stringify({
      config_version: '1',
      project: { name: 'test', client: 'test' },
      ecosystems: [{ id: 'npm', fixer: 'osv' }],
      protected_packages: {},
      safe_update_policy: {
        allow_patch_and_minor_within_constraints: true,
        require_authorization_for_constraint_change: false,
      },
      conflict_resolution: 'fail',
    }, null, 2);

    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(true);
      const config = unwrapTest(result);
      expect(config.ecosystems[0]?.fixer).toBe('osv');
    });
  });

  it('accepts fixer: npm-audit in ecosystems[]', async () => {
    const json = JSON.stringify({
      config_version: '1',
      project: { name: 'test', client: 'test' },
      ecosystems: [{ id: 'npm', fixer: 'npm-audit' }],
      protected_packages: {},
      safe_update_policy: {
        allow_patch_and_minor_within_constraints: true,
        require_authorization_for_constraint_change: false,
      },
      conflict_resolution: 'fail',
    }, null, 2);

    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(true);
      const config = unwrapTest(result);
      expect(config.ecosystems[0]?.fixer).toBe('npm-audit');
    });
  });

  it('rejects unknown fixer strategy in ecosystems[]', async () => {
    const json = JSON.stringify({
      config_version: '1',
      project: { name: 'test', client: 'test' },
      ecosystems: [{ id: 'npm', fixer: 'unknown-strategy' }],
      protected_packages: {},
      safe_update_policy: {
        allow_patch_and_minor_within_constraints: true,
        require_authorization_for_constraint_change: false,
      },
      conflict_resolution: 'fail',
    }, null, 2);

    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });
});

describe('OSV scanner config schema — runner + image fields', () => {
  it('accepts osv.runner: docker with a custom image', async () => {
    const json = minimalConfigWithObj({
      scanners: { osv: { runner: 'docker', image: 'ghcr.io/google/osv-scanner:v1.9.0' } },
    });
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(true);
      const config = unwrapTest(result);
      expect(config.scanners?.osv?.runner).toBe('docker');
      expect(config.scanners?.osv?.image).toBe('ghcr.io/google/osv-scanner:v1.9.0');
    });
  });

  it('accepts osv.runner: local', async () => {
    const json = minimalConfigWithObj({ scanners: { osv: { runner: 'local' } } });
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(true);
      const config = unwrapTest(result);
      expect(config.scanners?.osv?.runner).toBe('local');
    });
  });

  it('rejects osv.runner: auto (removed — only docker and local are valid)', async () => {
    const json = minimalConfigWithObj({ scanners: { osv: { runner: 'auto' } } });
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });

  it('defaults osv.runner to docker when not specified', async () => {
    const json = minimalConfigWithObj({ scanners: { osv: {} } });
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(true);
      const config = unwrapTest(result);
      expect(config.scanners?.osv?.runner).toBe('docker');
    });
  });

  it('rejects an invalid osv.runner value', async () => {
    const json = minimalConfigWithObj({ scanners: { osv: { runner: 'kubernetes' } } });
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });

  it('invalid enum error message includes expected values', async () => {
    const json = minimalConfigWithObj({ scanners: { osv: { runner: 'kubernetes' } } });
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
      // Should show expected enum values (docker and local only — auto was removed)
      expect((result.error as ConfigLoadError).message).toMatch(/"local"/);
      expect((result.error as ConfigLoadError).message).toMatch(/"docker"/);
    });
  });

  it('accepts image field without runner (image is optional)', async () => {
    const json = minimalConfigWithObj({
      scanners: { osv: { image: 'ghcr.io/google/osv-scanner:v1.9.0' } },
    });
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(true);
      const config = unwrapTest(result);
      expect(config.scanners?.osv?.image).toBe('ghcr.io/google/osv-scanner:v1.9.0');
      // runner defaults to 'docker'
      expect(config.scanners?.osv?.runner).toBe('docker');
    });
  });
});

// sonar.projectKey moved from project-config to sonar-project.properties.
// Format validation now happens at scan time inside the SonarQube engine (see
// sonarqube-engine.test.ts). The schema rejects project_key as an unknown key
// via strict mode — covered by the "strict schema enforcement" describe below.

describe('strict schema enforcement — unknown keys', () => {
  it('rejects unknown top-level config key', async () => {
    const json = minimalConfigWithObj({ unknown_top_key: 'oops' });
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });

  it('unknown-key error message shows the rejected key name', async () => {
    const json = minimalConfigWithObj({ unknown_top_key: 'oops' });
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
      expect((result.error as ConfigLoadError).message).toMatch(/"unknown_top_key"/);
    });
  });

  it('rejects unknown key inside project block', async () => {
    const json = JSON.stringify({
      config_version: '1',
      project: { name: 'test', client: 'test', extra_field: 'oops' },
      ecosystems: [{ id: 'npm' }],
      protected_packages: {},
      safe_update_policy: {
        allow_patch_and_minor_within_constraints: true,
        require_authorization_for_constraint_change: false,
      },
      conflict_resolution: 'fail',
    }, null, 2);
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });

  it('rejects unknown key inside scanners.osv block', async () => {
    const json = minimalConfigWithObj({
      scanners: { osv: { runner: 'local', unknown_osv_key: 'oops' } },
    });
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });

  it('rejects unknown key inside ecosystems[] entry', async () => {
    const json = JSON.stringify({
      config_version: '1',
      project: { name: 'test', client: 'test' },
      ecosystems: [{ id: 'npm', unknown_eco_key: 'oops' }],
      protected_packages: {},
      safe_update_policy: {
        allow_patch_and_minor_within_constraints: true,
        require_authorization_for_constraint_change: false,
      },
      conflict_resolution: 'fail',
    }, null, 2);
    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });

  it('rejects legacy cloud_storage credentials keys (OAuth flow stores tokens outside config)', async () => {
    const json = JSON.stringify({
      config_version: '1',
      project: { name: 'test', client: 'test' },
      ecosystems: [{ id: 'npm' }],
      protected_packages: {},
      safe_update_policy: {
        allow_patch_and_minor_within_constraints: true,
        require_authorization_for_constraint_change: false,
      },
      conflict_resolution: 'fail',
      cloud_storage: {
        provider: 'google_drive',
        folder_id: 'abc123',
        credentials: '.security-scan/gdrive-service-account.json',
      },
    }, null, 2);

    await withTempConfig(json, async (absPath, filename) => {
      const dir = require('node:path').dirname(absPath);
      const result = await loadConfig(filename, dir);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ConfigLoadError);
    });
  });
});
