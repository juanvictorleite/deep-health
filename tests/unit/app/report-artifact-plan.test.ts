import { describe, expect, it } from 'vitest';

import { resolveArtifactPlan } from '@app/report-artifact-plan';
import type { ProjectConfig } from '@core/types/config';
import type { ScanResultJson } from '@core/types/scan';

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    project: { name: 'Project', client: 'Acme' },
    ecosystems: [{ id: 'npm' }],
    protected_packages: {},
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: false,
    },
    conflict_resolution: 'manual',
    ...overrides,
  };
}

function makeEngineResult(status: ScanResultJson['status']): ScanResultJson {
  return {
    $schema: 'osv-scan-result/v1',
    agent: 'sonarqube',
    status,
    environment: 'local',
    ecosystems: {},
    error: null,
  };
}

describe('resolveArtifactPlan()', () => {
  it('returns an empty plan and disabled flags when outputs.formats is absent', () => {
    const plan = resolveArtifactPlan({ config: makeConfig() });
    expect(plan.markdownEnabled).toBe(false);
    expect(plan.docxEnabled).toBe(false);
    expect(plan.descriptors).toEqual([]);
  });

  it('returns an empty plan when outputs.formats is an empty array', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ outputs: { formats: [] } }),
    });
    expect(plan.descriptors).toEqual([]);
  });

  it('resolves a single markdown-consolidated descriptor when only markdown is enabled', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ outputs: { formats: ['markdown'] } }),
    });
    expect(plan.markdownEnabled).toBe(true);
    expect(plan.docxEnabled).toBe(false);
    expect(plan.descriptors).toEqual([{ kind: 'markdown-consolidated' }]);
  });

  it('resolves a single docx-consolidated descriptor when only docx is enabled', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ outputs: { formats: ['docx'] } }),
    });
    expect(plan.descriptors).toEqual([{ kind: 'docx-consolidated' }]);
  });

  it('resolves markdown-consolidated then docx-consolidated, in that order, when both formats are enabled', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ outputs: { formats: ['markdown', 'docx'] } }),
    });
    expect(plan.descriptors).toEqual([
      { kind: 'markdown-consolidated' },
      { kind: 'docx-consolidated' },
    ]);
  });

  it('resolves one markdown-split descriptor per ecosystem entry in split mode', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({
        ecosystems: [{ id: 'npm', label: 'frontend' }, { id: 'npm', label: 'api' }],
        outputs: { formats: ['markdown'] },
      }),
      splitReports: true,
    });
    expect(plan.descriptors).toEqual([
      { kind: 'markdown-split', entryKey: 'npm:frontend' },
      { kind: 'markdown-split', entryKey: 'npm:api' },
    ]);
  });

  it('interleaves markdown-split and docx-split per entry (markdown before docx within each entry)', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({
        ecosystems: [{ id: 'npm', label: 'frontend' }, { id: 'npm', label: 'api' }],
        outputs: { formats: ['markdown', 'docx'] },
      }),
      splitReports: true,
    });
    expect(plan.descriptors).toEqual([
      { kind: 'markdown-split', entryKey: 'npm:frontend' },
      { kind: 'docx-split', entryKey: 'npm:frontend' },
      { kind: 'markdown-split', entryKey: 'npm:api' },
      { kind: 'docx-split', entryKey: 'npm:api' },
    ]);
  });

  it('falls back to consolidated descriptors when split mode is requested but there are no ecosystems', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ ecosystems: [], outputs: { formats: ['markdown'] } }),
      splitReports: true,
    });
    expect(plan.descriptors).toEqual([{ kind: 'markdown-consolidated' }]);
  });

  it('uses config.outputs.split_reports when the splitReports input is not provided', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({
        ecosystems: [{ id: 'npm', label: 'frontend' }],
        outputs: { formats: ['markdown'], split_reports: true },
      }),
    });
    expect(plan.descriptors).toEqual([{ kind: 'markdown-split', entryKey: 'npm:frontend' }]);
  });

  it('CLI splitReports:true overrides config split_reports:false', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({
        ecosystems: [{ id: 'npm', label: 'frontend' }],
        outputs: { formats: ['markdown'], split_reports: false },
      }),
      splitReports: true,
    });
    expect(plan.descriptors).toEqual([{ kind: 'markdown-split', entryKey: 'npm:frontend' }]);
  });

  it('CLI splitReports:false overrides config split_reports:true', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({
        ecosystems: [{ id: 'npm', label: 'frontend' }],
        outputs: { formats: ['markdown'], split_reports: true },
      }),
      splitReports: false,
    });
    expect(plan.descriptors).toEqual([{ kind: 'markdown-consolidated' }]);
  });

  it('appends a sonarqube-html descriptor after report descriptors when a non-skipped sonarqube result is present', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ outputs: { formats: ['markdown'] } }),
      engineResults: { sonarqube: makeEngineResult('success') },
    });
    expect(plan.descriptors).toEqual([
      { kind: 'markdown-consolidated' },
      { kind: 'sonarqube-html' },
    ]);
  });

  it('includes a sonarqube-html descriptor for an error-status sonarqube result (not just success)', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ outputs: { formats: ['markdown'] } }),
      engineResults: { sonarqube: makeEngineResult('error') },
    });
    expect(plan.descriptors.some((d) => d.kind === 'sonarqube-html')).toBe(true);
  });

  it('omits the sonarqube-html descriptor when the sonarqube result status is skipped', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ outputs: { formats: ['markdown'] } }),
      engineResults: { sonarqube: makeEngineResult('skipped') },
    });
    expect(plan.descriptors).toEqual([{ kind: 'markdown-consolidated' }]);
  });

  it('omits the sonarqube-html descriptor when engineResults has no sonarqube key', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ outputs: { formats: ['markdown'] } }),
      engineResults: { osv: makeEngineResult('success') },
    });
    expect(plan.descriptors).toEqual([{ kind: 'markdown-consolidated' }]);
  });

  it('omits the sonarqube-html descriptor when engineResults is undefined', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ outputs: { formats: ['markdown'] } }),
    });
    expect(plan.descriptors).toEqual([{ kind: 'markdown-consolidated' }]);
  });

  it('never adds a sonarqube-html descriptor when no formats are enabled, even with sonarqube data present', () => {
    const plan = resolveArtifactPlan({
      config: makeConfig({ outputs: { formats: [] } }),
      engineResults: { sonarqube: makeEngineResult('success') },
    });
    expect(plan.descriptors).toEqual([]);
  });
});
