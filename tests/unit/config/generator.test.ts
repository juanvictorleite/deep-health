import { describe, it, expect } from 'vitest';
import { generateConfigYaml, normalizeSonarProjectKey } from '@infra/config/generator';
import { parse } from 'yaml';
import { ProjectConfigSchema } from '@infra/config/schema';

describe('generateConfigYaml', () => {
  it('generates valid YAML that passes schema validation', () => {
    const yaml = generateConfigYaml();
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('uses provided project name and client', () => {
    const yaml = generateConfigYaml({ projectName: 'My App', client: 'ACME Corp' });
    const parsed = parse(yaml) as { project: { name: string; client: string } };
    expect(parsed.project.name).toBe('My App');
    expect(parsed.project.client).toBe('ACME Corp');
  });

  it('includes empty protected_packages arrays with example comments', () => {
    const yaml = generateConfigYaml();
    const parsed = parse(yaml) as {
      protected_packages: { composer: unknown[]; npm: unknown[]; pip: unknown[] };
    };
    expect(Array.isArray(parsed.protected_packages.composer)).toBe(true);
    expect(Array.isArray(parsed.protected_packages.npm)).toBe(true);
    expect(Array.isArray(parsed.protected_packages.pip)).toBe(true);
    expect(yaml).toContain('# - package:');
  });

  it('includes a header comment', () => {
    const yaml = generateConfigYaml();
    expect(yaml).toContain('# security-scan');
  });

  it('generates valid YAML with custom PHP version reflected in ecosystems via ecosystemConfigs', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [
        {
          id: 'composer',
          validationCommands: [{ name: 'tests', command: 'php artisan test --compact' }],
          advisors: [{ name: 'audit', command: 'composer audit' }],
        },
      ],
    });
    const parsed = parse(yaml) as { ecosystems: Array<{ id: string }> };
    const composer = parsed.ecosystems.find((e) => e.id === 'composer');
    expect(composer).toBeDefined();
  });

  it('includes ecosystems[] with at least one entry by default', () => {
    const yaml = generateConfigYaml();
    const parsed = parse(yaml) as { ecosystems: unknown[] };
    expect(Array.isArray(parsed.ecosystems)).toBe(true);
    expect(parsed.ecosystems.length).toBeGreaterThanOrEqual(1);
  });

  it('defaults npm fixer to "osv" in generated config', () => {
    const yaml = generateConfigYaml();
    const parsed = parse(yaml) as { ecosystems: Array<{ id: string; fixer?: string }> };
    const npm = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npm).toBeDefined();
    expect(npm?.fixer).toBe('osv');
  });

  it('includes both composer and npm ecosystems when both provided via ecosystemConfigs', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [
        {
          id: 'composer',
          validationCommands: [{ name: 'tests', command: 'php artisan test --compact' }],
          advisors: [{ name: 'audit', command: 'composer audit' }],
        },
        {
          id: 'npm',
          fixerStrategy: 'npm-audit',
          validationCommands: [{ name: 'build', command: 'npm run build' }],
          advisors: [{ name: 'audit', command: 'npm audit' }],
        },
      ],
    });
    const parsed = parse(yaml) as { ecosystems: Array<{ id: string }> };
    const ids = parsed.ecosystems.map((e) => e.id);
    expect(ids).toContain('composer');
    expect(ids).toContain('npm');
  });

  it('includes markdown in outputs.formats when enableSonarQube and ecosystemConfigs provided', () => {
    const yaml = generateConfigYaml({
      enableSonarQube: true,
      outputs: { formats: ['markdown'], dir: '.security-scan/reports' },
      ecosystemConfigs: [{ id: 'npm', fixerStrategy: 'npm-audit' }],
    });
    const parsed = parse(yaml) as { outputs?: { formats?: string[] } };
    expect(parsed.outputs?.formats).toContain('markdown');
    // 'sonarqube' is not an output format — it is not a toggle in formats
    expect(parsed.outputs?.formats).not.toContain('sonarqube');
  });

  it('includes pip ecosystem entry when specified in ecosystemConfigs', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [
        {
          id: 'pip',
          validationCommands: [{ name: 'check', command: 'pip check' }],
          advisors: [{ name: 'audit', command: 'pip-audit' }],
        },
      ],
    });
    const parsed = parse(yaml) as { ecosystems: Array<{ id: string }> };
    const pip = parsed.ecosystems.find((e) => e.id === 'pip');
    expect(pip).toBeDefined();
  });

  it('always emits pip: [] in protected_packages even when pip not in ecosystemConfigs', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{ id: 'npm', fixerStrategy: 'osv' }],
    });
    const parsed = parse(yaml) as { protected_packages: Record<string, unknown[]> };
    expect(Array.isArray(parsed.protected_packages['pip'])).toBe(true);
  });

  it('passes schema validation when pip runner.language_version provided (no sonarqube)', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{ id: 'pip', runner: { language_version: '3.11' } }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    // runner block is generated inline under ecosystem entry
    expect(result.success).toBe(true);
  });

  it('passes schema validation when both npm and pip runner.language_version provided', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [
        { id: 'npm', runner: { language_version: '20' } },
        { id: 'pip', runner: { language_version: '3.11' } },
      ],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('passes schema validation when composer runner.language_version provided (without SonarQube)', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{ id: 'composer', runner: { language_version: '8.2' } }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('passes schema validation when npm + pip + composer runner.language_version provided together', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [
        { id: 'npm', runner: { language_version: '20' } },
        { id: 'pip', runner: { language_version: '3.11' } },
        { id: 'composer', runner: { language_version: '8.3' } },
      ],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});

describe('normalizeSonarProjectKey', () => {
  it('returns already-valid keys unchanged (idempotent)', () => {
    expect(normalizeSonarProjectKey('my-project')).toBe('my-project');
    expect(normalizeSonarProjectKey('org:my-project')).toBe('org:my-project');
    expect(normalizeSonarProjectKey('My_Project.v2')).toBe('My_Project.v2');
    expect(normalizeSonarProjectKey('ACME-CORP_123')).toBe('ACME-CORP_123');
  });

  it('replaces spaces with hyphens', () => {
    expect(normalizeSonarProjectKey('My App')).toBe('My-App');
    expect(normalizeSonarProjectKey('My  App')).toBe('My-App');
  });

  it('replaces invalid characters with hyphens', () => {
    expect(normalizeSonarProjectKey('My App!')).toBe('My-App');
    expect(normalizeSonarProjectKey('hello world@2024')).toBe('hello-world-2024');
  });

  it('collapses consecutive hyphens', () => {
    expect(normalizeSonarProjectKey('a  b  c')).toBe('a-b-c');
    expect(normalizeSonarProjectKey('a--b')).toBe('a-b');
  });

  it('strips leading and trailing hyphens', () => {
    expect(normalizeSonarProjectKey('!My Project!')).toBe('My-Project');
    expect(normalizeSonarProjectKey('-project-')).toBe('project');
  });

  it('falls back to my-project for empty or whitespace-only input', () => {
    expect(normalizeSonarProjectKey('')).toBe('my-project');
    expect(normalizeSonarProjectKey('   ')).toBe('my-project');
    expect(normalizeSonarProjectKey('!!!')).toBe('my-project');
  });

  it('generated config with enableSonarQube=true passes schema validation (no project_key in config anymore)', () => {
    // project_key moved to sonar-project.properties — config.yml only contains
    // CLI-layer fields. Still worth a round-trip check to confirm the template
    // emits valid YAML + a valid sonarqube block when the flag is on.
    const yaml = generateConfigYaml({
      projectName: 'My Project',
      enableSonarQube: true,
      ecosystemConfigs: [{ id: 'npm', fixerStrategy: 'npm-audit' }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);

    const sonarBlock = (parsed as { scanners?: { sonarqube?: Record<string, unknown> } })
      .scanners?.sonarqube;
    expect(sonarBlock).toBeDefined();
    expect(sonarBlock).toHaveProperty('enabled', true);
    expect(sonarBlock).toHaveProperty('mode', 'managed');
    // Removed fields must NOT leak into generated config.
    expect(sonarBlock).not.toHaveProperty('project_key');
    expect(sonarBlock).not.toHaveProperty('host_url');
    expect(sonarBlock).not.toHaveProperty('token_env');
    expect(sonarBlock).not.toHaveProperty('exclusions');
  });

  it('project names with special chars still produce valid YAML when enableSonarQube=true', () => {
    const yaml = generateConfigYaml({
      projectName: 'My App (v2)!',
      enableSonarQube: true,
      ecosystemConfigs: [{ id: 'npm' }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('defaults sonarQubeMode to managed when enableSonarQube=true and no mode provided', () => {
    const yaml = generateConfigYaml({
      projectName: 'My Project',
      enableSonarQube: true,
      ecosystemConfigs: [{ id: 'npm', fixerStrategy: 'npm-audit' }],
    });
    const parsed = parse(yaml) as { scanners?: { sonarqube?: Record<string, unknown> } };
    expect(parsed.scanners?.sonarqube?.mode).toBe('managed');
  });

  it('emits mode: external when sonarQubeMode is external', () => {
    const yaml = generateConfigYaml({
      projectName: 'External Sonar Project',
      enableSonarQube: true,
      sonarQubeMode: 'external',
      ecosystemConfigs: [{ id: 'npm', fixerStrategy: 'npm-audit' }],
    });
    const parsed = parse(yaml) as { scanners?: { sonarqube?: Record<string, unknown> } };
    expect(parsed.scanners?.sonarqube?.mode).toBe('external');
  });

  it('generated config with sonarQubeMode external passes schema validation', () => {
    const yaml = generateConfigYaml({
      projectName: 'External Sonar Project',
      enableSonarQube: true,
      sonarQubeMode: 'external',
      ecosystemConfigs: [{ id: 'npm' }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});

describe('generateConfigYaml — dockerfile image_source options', () => {
  it('generated config with npm runner image_source="dockerfile" passes schema validation', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{
        id: 'npm',
        runner: { language_version: '20', image_source: 'dockerfile', dockerfile_path: 'Dockerfile' },
      }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('generated config with npm runner (language_version only, no image_source) passes schema validation', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{ id: 'npm', runner: { language_version: '20' } }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('generated config with pip runner image_source="dockerfile" passes schema validation', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{
        id: 'pip',
        runner: { language_version: '3.11', image_source: 'dockerfile', dockerfile_path: 'Dockerfile' },
      }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('generated config with composer runner image_source="dockerfile" passes schema validation', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{
        id: 'composer',
        runner: { language_version: '8.2', image_source: 'dockerfile', dockerfile_path: '.docker/php.Dockerfile' },
      }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('generated config with npm runner build_context and build_args passes schema validation', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{
        id: 'npm',
        runner: {
          language_version: '20',
          image_source: 'dockerfile',
          dockerfile_path: 'Dockerfile',
          build_context: '.',
          build_args: { NODE_ENV: 'test' },
        },
      }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('generated config with pip runner build_context and build_args passes schema validation', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{
        id: 'pip',
        runner: {
          language_version: '3.11',
          image_source: 'dockerfile',
          dockerfile_path: 'Dockerfile',
          build_context: '.',
          build_args: { PYTHON_VERSION: '3.11' },
        },
      }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('generated config with composer runner build_context and build_args passes schema validation', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{
        id: 'composer',
        runner: {
          language_version: '8.2',
          image_source: 'dockerfile',
          dockerfile_path: '.docker/php.Dockerfile',
          build_context: '.docker/',
          build_args: { PHP_VERSION: '8.2' },
        },
      }],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('AC7: full inline runner (all fields) generates valid YAML with runner nested under ecosystem entry, not top-level', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [{
        id: 'npm',
        runner: {
          language_version: '20',
          image_source: 'dockerfile',
          dockerfile_path: 'Dockerfile',
          build_context: '.',
          build_args: { NODE_ENV: 'production', APP_VERSION: '1.0' },
          allow_build_context_escape: true,
        },
      }],
    });

    // Must parse as valid YAML
    const parsed = parse(yaml) as {
      ecosystems: Array<{ id: string; runner?: Record<string, unknown> }>;
      runners?: unknown;
    };

    // Must pass ProjectConfigSchema validation
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);

    // Runner block must be nested under the ecosystem entry, NOT as a top-level runners: section
    expect(parsed.runners).toBeUndefined();
    const npmEntry = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npmEntry).toBeDefined();
    expect(npmEntry?.runner).toBeDefined();
    expect(npmEntry?.runner?.language_version).toBe('20');
    expect(npmEntry?.runner?.image_source).toBe('dockerfile');
    expect(npmEntry?.runner?.dockerfile_path).toBe('Dockerfile');
    expect(npmEntry?.runner?.build_context).toBe('.');
    expect(npmEntry?.runner?.allow_build_context_escape).toBe(true);

    // build_args must be present (rendered as YAML mapping)
    const buildArgs = npmEntry?.runner?.build_args as Record<string, string> | undefined;
    expect(buildArgs?.NODE_ENV).toBe('production');
    expect(buildArgs?.APP_VERSION).toBe('1.0');
  });
});

describe('generateConfigYaml — empty validationCommands', () => {
  it('emits validationCommands: [] and keeps advisors on its own line when validationCommands is empty', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [
        {
          id: 'composer',
          validationCommands: [],
          advisors: [{ name: 'audit', command: 'composer audit' }],
        },
      ],
    });

    // (a) YAML must parse successfully
    const parsed = parse(yaml) as { ecosystems: Array<{ id: string; validationCommands?: unknown[]; advisors?: Array<{ name: string; command: string }> }> };

    // (b) validationCommands must be an empty array
    const composer = parsed.ecosystems.find((e) => e.id === 'composer');
    expect(composer).toBeDefined();
    expect(Array.isArray(composer?.validationCommands)).toBe(true);
    expect(composer?.validationCommands).toHaveLength(0);

    // (c) advisors must be present with the audit entry
    expect(Array.isArray(composer?.advisors)).toBe(true);
    expect(composer?.advisors).toHaveLength(1);
    expect(composer?.advisors?.[0]).toEqual({ name: 'audit', command: 'composer audit' });
  });

  it('emits validationCommands: [] for npm with empty validationCommands and advisors present', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [
        {
          id: 'npm',
          validationCommands: [],
          advisors: [{ name: 'audit', command: 'npm audit' }],
        },
      ],
    });

    const parsed = parse(yaml) as { ecosystems: Array<{ id: string; validationCommands?: unknown[]; advisors?: unknown[] }> };
    const npm = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npm?.validationCommands).toEqual([]);
    expect(npm?.advisors).toHaveLength(1);
  });

  it('generated YAML with empty validationCommands passes schema validation', () => {
    const yaml = generateConfigYaml({
      ecosystemConfigs: [
        {
          id: 'composer',
          validationCommands: [],
          advisors: [{ name: 'audit', command: 'composer audit' }],
        },
      ],
    });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});

describe('generateConfigYaml — single-quote YAML injection prevention', () => {
  it("escapes single quotes in project name (O'Brien → O''Brien in YAML)", () => {
    const yaml = generateConfigYaml({ projectName: "O'Brien", client: 'Client' });
    const parsed = parse(yaml) as { project: { name: string } };
    expect(parsed.project.name).toBe("O'Brien");
  });

  it("escapes single quotes in client name (Client's Co. → remains valid YAML)", () => {
    const yaml = generateConfigYaml({ projectName: 'My App', client: "Client's Co." });
    const parsed = parse(yaml) as { project: { client: string } };
    expect(parsed.project.client).toBe("Client's Co.");
  });

  it("generated YAML with single-quoted project name passes schema validation", () => {
    const yaml = generateConfigYaml({ projectName: "It's a Project", client: 'ACME' });
    const parsed = parse(yaml);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });
});
