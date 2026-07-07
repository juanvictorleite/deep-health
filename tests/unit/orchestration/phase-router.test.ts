/**
 * Unit tests for resolveExecutionPlan (ADR 0010 — Phase Router extraction).
 *
 * Pure fixture tests: config + options in, ExecutionPlan out. No Docker,
 * no runner mocks, no I/O — mirrors the ADR's verification section.
 */
import { describe, it, expect } from 'vitest';

import type { EcosystemPlugin } from '@modules/ecosystem/types';
import { createEcosystemRegistry } from '@modules/ecosystem/registry';
import type { ProjectConfig } from '@core/types/config';

import type { OrchestratorOptions } from '@orchestration/orchestrator';
import { resolveExecutionPlan } from '@orchestration/phase-router';

function makeFakePlugin(id: string): EcosystemPlugin {
  return {
    id,
    name: id,
    manifest: `${id}.manifest`,
    osvEcosystems: [id],
    reportLabel: id,
    supportedFixers: ['osv'],
    defaultValidationCommands: [],
    defaultAdvisors: [],
    postUpdateOsvVerify: 'never',
    buildScanArgs: () => [],
    getProtectedPackages: () => [],
    runUpdater: async () => {
      throw new Error('not implemented in fake plugin');
    },
  };
}

const npmPlugin = makeFakePlugin('npm');
const composerPlugin = makeFakePlugin('composer');
const registry = createEcosystemRegistry([npmPlugin, composerPlugin]);

function baseConfig(overrides: Record<string, unknown> = {}): ProjectConfig {
  return {
    project: { name: 'test', client: 'acme' },
    ecosystems: [{ id: 'npm' }, { id: 'composer' }],
    protected_packages: {},
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: true,
    },
    conflict_resolution: 'stop_and_ask',
    ...overrides,
  } as unknown as ProjectConfig;
}

function baseOptions(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  return {
    configPath: 'security-scan.config.json',
    cwd: '/project',
    dryRun: false,
    verbose: false,
    ...overrides,
  };
}

describe('resolveExecutionPlan — phase selection', () => {
  it('runs every phase when no --phases option is given (default)', () => {
    const plan = resolveExecutionPlan(baseConfig(), baseOptions(), registry);

    expect(plan.runScan).toBe(true);
    expect(plan.runReport).toBe(true);
    expect(plan.activeEcosystems.map((e) => e.plugin.id)).toEqual(['npm', 'composer']);
  });

  it('--phases scan: only the scan phase runs, no ecosystems, no report', () => {
    const plan = resolveExecutionPlan(baseConfig(), baseOptions({ phases: ['scan'] }), registry);

    expect(plan.runScan).toBe(true);
    expect(plan.runReport).toBe(false);
    expect(plan.activeEcosystems).toEqual([]);
  });

  it('--phases npm,report: scan is excluded, only npm ecosystem is active, report runs', () => {
    const plan = resolveExecutionPlan(
      baseConfig(),
      baseOptions({ phases: ['npm', 'report'] }),
      registry,
    );

    expect(plan.runScan).toBe(false);
    expect(plan.runReport).toBe(true);
    expect(plan.activeEcosystems.map((e) => e.plugin.id)).toEqual(['npm']);
  });

  it('an unknown phase name matches nothing — every gated phase is excluded', () => {
    const plan = resolveExecutionPlan(
      baseConfig(),
      baseOptions({ phases: ['totally-unknown-phase'] }),
      registry,
    );

    expect(plan.runScan).toBe(false);
    expect(plan.runReport).toBe(false);
    expect(plan.activeEcosystems).toEqual([]);
  });

  it('filters an ecosystem entry by its labeled key (id:label), not just its plain id', () => {
    const config = baseConfig({
      ecosystems: [
        { id: 'npm', label: 'frontend' },
        { id: 'npm', label: 'backend' },
      ],
    });

    const plan = resolveExecutionPlan(
      config,
      baseOptions({ phases: ['npm:frontend'] }),
      registry,
    );

    expect(plan.activeEcosystems).toHaveLength(1);
    expect(plan.activeEcosystems[0]?.ecoEntry.label).toBe('frontend');
  });

  it('skips config entries whose plugin id is not registered', () => {
    const config = baseConfig({ ecosystems: [{ id: 'npm' }, { id: 'unregistered-plugin' }] });

    const plan = resolveExecutionPlan(config, baseOptions(), registry);

    expect(plan.activeEcosystems.map((e) => e.plugin.id)).toEqual(['npm']);
  });

  it('resolves ecosystemCwd relative to cwd when the entry declares a path, else uses cwd', () => {
    const config = baseConfig({
      ecosystems: [
        { id: 'npm', path: 'apps/frontend' },
        { id: 'composer' },
      ],
    });

    const plan = resolveExecutionPlan(config, baseOptions({ cwd: '/repo' }), registry);

    const npmEntry = plan.activeEcosystems.find((e) => e.plugin.id === 'npm');
    const composerEntry = plan.activeEcosystems.find((e) => e.plugin.id === 'composer');

    expect(npmEntry?.ecosystemCwd).toBe('/repo/apps/frontend');
    expect(composerEntry?.ecosystemCwd).toBe('/repo');
  });

  it('resolves authorizeBreaking true when authorized by plain id', () => {
    const plan = resolveExecutionPlan(
      baseConfig(),
      baseOptions({ authorizeBreaking: { npm: true } }),
      registry,
    );

    const npmEntry = plan.activeEcosystems.find((e) => e.plugin.id === 'npm');
    const composerEntry = plan.activeEcosystems.find((e) => e.plugin.id === 'composer');

    expect(npmEntry?.authorizeBreaking).toBe(true);
    expect(composerEntry?.authorizeBreaking).toBe(false);
  });

  it('resolves authorizeBreaking true when authorized by labeled entry key', () => {
    const config = baseConfig({ ecosystems: [{ id: 'npm', label: 'frontend' }] });

    const plan = resolveExecutionPlan(
      config,
      baseOptions({ authorizeBreaking: { 'npm:frontend': true } }),
      registry,
    );

    expect(plan.activeEcosystems[0]?.authorizeBreaking).toBe(true);
  });
});

describe('resolveExecutionPlan — onFailureFor policy resolution', () => {
  it('reads the configured on_failure value for a secondary engine (warn)', () => {
    const config = baseConfig({ scanners: { sonarqube: { on_failure: 'warn' } } });

    const plan = resolveExecutionPlan(config, baseOptions(), registry);

    expect(plan.onFailureFor('sonarqube')).toBe('warn');
  });

  it('reads the configured on_failure value for a secondary engine (fail)', () => {
    const config = baseConfig({ scanners: { sonarqube: { on_failure: 'fail' } } });

    const plan = resolveExecutionPlan(config, baseOptions(), registry);

    expect(plan.onFailureFor('sonarqube')).toBe('fail');
  });

  it('defaults to "fail" for an engine id with no matching config block', () => {
    const config = baseConfig({ scanners: { sonarqube: { on_failure: 'warn' } } });

    const plan = resolveExecutionPlan(config, baseOptions(), registry);

    expect(plan.onFailureFor('unrecognised-engine')).toBe('fail');
  });

  it('defaults to "fail" when config has no scanners key at all', () => {
    const config = baseConfig();

    const plan = resolveExecutionPlan(config, baseOptions(), registry);

    expect(plan.onFailureFor('sonarqube')).toBe('fail');
  });

  it('leaves the primary engine (osv) unaffected — resolves via the same generic lookup', () => {
    const config = baseConfig({ scanners: { osv: { runner: 'local' } } });

    const plan = resolveExecutionPlan(config, baseOptions(), registry);

    // osv config has no `on_failure` field — falls back to 'fail' like any
    // other engine with no on_failure declared (this is a generic lookup,
    // not primary/secondary-aware).
    expect(plan.onFailureFor('osv')).toBe('fail');
  });
});
