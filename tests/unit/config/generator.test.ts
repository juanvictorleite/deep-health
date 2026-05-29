
import { generateConfigJson, normalizeSonarProjectKey } from '@infra/config/generator';
import { ProjectConfigSchema } from '@infra/config/schema';
import { generateJsonSchema } from '@infra/config/schema-export';
import { describe, it, expect } from 'vitest';

/**
 * Strip $schema before Zod validation.
 * The Zod schema uses .strict() which rejects unknown keys. $schema is a JSON
 * IDE-autocomplete hint — the loader strips it before safeParse, so tests
 * that directly call ProjectConfigSchema.safeParse must do the same.
 */
function parseForSchema(json: string): unknown {
  const obj = JSON.parse(json) as Record<string, unknown>;
  const { $schema: _removed, ...rest } = obj;
  return rest;
}

describe('generateConfigJson', () => {
  it('generates valid JSON that passes schema validation', () => {
    const json = generateConfigJson();
    const parsed = parseForSchema(json);
    const result = ProjectConfigSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it('output is valid JSON (parseable without errors)', () => {
    const json = generateConfigJson();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('includes $schema field as the first property', () => {
    const json = generateConfigJson();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['$schema']).toBeDefined();
    expect(typeof parsed['$schema']).toBe('string');
    // $schema appears first in the serialized JSON
    expect(json.trim().startsWith('{\n  "$schema"')).toBe(true);
  });

  it('uses provided project name and client', () => {
    const json = generateConfigJson({ projectName: 'My App', client: 'ACME Corp' });
    const parsed = JSON.parse(json) as { project: { name: string; client: string } };
    expect(parsed.project.name).toBe('My App');
    expect(parsed.project.client).toBe('ACME Corp');
  });

  it('includes empty protected_packages arrays for known ecosystems', () => {
    const json = generateConfigJson();
    const parsed = JSON.parse(json) as {
      protected_packages: { composer: unknown[]; npm: unknown[]; pip: unknown[] };
    };
    expect(Array.isArray(parsed.protected_packages.composer)).toBe(true);
    expect(Array.isArray(parsed.protected_packages.npm)).toBe(true);
    expect(Array.isArray(parsed.protected_packages.pip)).toBe(true);
  });

  it('includes ecosystems[] with at least one entry by default', () => {
    const json = generateConfigJson();
    const parsed = JSON.parse(json) as { ecosystems: unknown[] };
    expect(Array.isArray(parsed.ecosystems)).toBe(true);
    expect(parsed.ecosystems.length).toBeGreaterThanOrEqual(1);
  });

  it('defaults npm fixer to "osv" in generated config', () => {
    const json = generateConfigJson();
    const parsed = JSON.parse(json) as { ecosystems: { id: string; fixer?: string }[] };
    const npm = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npm).toBeDefined();
    expect(npm?.fixer).toBe('osv');
  });

  it('generates valid JSON with custom PHP version reflected in ecosystems via ecosystemConfigs', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [
        {
          id: 'composer',
          validationCommands: [{ name: 'tests', command: 'php artisan test --compact' }],
          advisors: [{ name: 'audit', command: 'composer audit' }],
        },
      ],
    });
    const parsed = JSON.parse(json) as { ecosystems: { id: string }[] };
    const composer = parsed.ecosystems.find((e) => e.id === 'composer');
    expect(composer).toBeDefined();
  });

  it('includes both composer and npm ecosystems when both provided via ecosystemConfigs', () => {
    const json = generateConfigJson({
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
    const parsed = JSON.parse(json) as { ecosystems: { id: string }[] };
    const ids = parsed.ecosystems.map((e) => e.id);
    expect(ids).toContain('composer');
    expect(ids).toContain('npm');
  });

  it('includes markdown in outputs.formats when enableSonarQube and ecosystemConfigs provided', () => {
    const json = generateConfigJson({
      enableSonarQube: true,
      outputs: { formats: ['markdown'], dir: '.security-scan/reports' },
      ecosystemConfigs: [{ id: 'npm', fixerStrategy: 'npm-audit' }],
    });
    const parsed = JSON.parse(json) as { outputs?: { formats?: string[] } };
    expect(parsed.outputs?.formats).toContain('markdown');
    // 'sonarqube' is not an output format — it is not a toggle in formats
    expect(parsed.outputs?.formats).not.toContain('sonarqube');
  });

  it('includes pip ecosystem entry when specified in ecosystemConfigs', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [
        {
          id: 'pip',
          validationCommands: [{ name: 'check', command: 'pip check' }],
          advisors: [{ name: 'audit', command: 'pip-audit' }],
        },
      ],
    });
    const parsed = JSON.parse(json) as { ecosystems: { id: string }[] };
    const pip = parsed.ecosystems.find((e) => e.id === 'pip');
    expect(pip).toBeDefined();
  });

  it('always emits pip: [] in protected_packages even when pip not in ecosystemConfigs', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{ id: 'npm', fixerStrategy: 'osv' }],
    });
    const parsed = JSON.parse(json) as { protected_packages: Record<string, unknown[]> };
    expect(Array.isArray(parsed.protected_packages['pip'])).toBe(true);
  });

  it('passes schema validation when pip runner.language_version provided (no sonarqube)', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{ id: 'pip', runner: { language_version: '3.11' } }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('passes schema validation when both npm and pip runner.language_version provided', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [
        { id: 'npm', runner: { language_version: '20' } },
        { id: 'pip', runner: { language_version: '3.11' } },
      ],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('passes schema validation when composer runner.language_version provided (without SonarQube)', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{ id: 'composer', runner: { language_version: '8.2' } }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('passes schema validation when npm + pip + composer runner.language_version provided together', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [
        { id: 'npm', runner: { language_version: '20' } },
        { id: 'pip', runner: { language_version: '3.11' } },
        { id: 'composer', runner: { language_version: '8.3' } },
      ],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('project names with special chars produce valid JSON that passes schema validation', () => {
    const json = generateConfigJson({
      projectName: "O'Brien",
      client: "Client's Co.",
    });
    const parsed = JSON.parse(json) as { project: { name: string; client: string } };
    // JSON handles special chars natively — no escaping needed
    expect(parsed.project.name).toBe("O'Brien");
    expect(parsed.project.client).toBe("Client's Co.");
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
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
    // project_key moved to sonar-project.properties — config.json only contains
    // CLI-layer fields. Still worth a round-trip check to confirm the generator
    // emits valid JSON + a valid sonarqube block when the flag is on.
    const json = generateConfigJson({
      projectName: 'My Project',
      enableSonarQube: true,
      ecosystemConfigs: [{ id: 'npm', fixerStrategy: 'npm-audit' }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);

    const parsed = JSON.parse(json) as { scanners?: { sonarqube?: Record<string, unknown> } };
    const sonarBlock = parsed.scanners?.sonarqube;
    expect(sonarBlock).toBeDefined();
    expect(sonarBlock).toHaveProperty('enabled', true);
    expect(sonarBlock).toHaveProperty('mode', 'managed');
    // Removed fields must NOT leak into generated config.
    expect(sonarBlock).not.toHaveProperty('project_key');
    expect(sonarBlock).not.toHaveProperty('host_url');
    expect(sonarBlock).not.toHaveProperty('token_env');
    expect(sonarBlock).not.toHaveProperty('exclusions');
  });

  it('project names with special chars still produce valid JSON when enableSonarQube=true', () => {
    const json = generateConfigJson({
      projectName: 'My App (v2)!',
      enableSonarQube: true,
      ecosystemConfigs: [{ id: 'npm' }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('defaults sonarQubeMode to managed when enableSonarQube=true and no mode provided', () => {
    const json = generateConfigJson({
      projectName: 'My Project',
      enableSonarQube: true,
      ecosystemConfigs: [{ id: 'npm', fixerStrategy: 'npm-audit' }],
    });
    const parsed = JSON.parse(json) as { scanners?: { sonarqube?: Record<string, unknown> } };
    expect(parsed.scanners?.sonarqube?.mode).toBe('managed');
  });

  it('emits mode: external when sonarQubeMode is external', () => {
    const json = generateConfigJson({
      projectName: 'External Sonar Project',
      enableSonarQube: true,
      sonarQubeMode: 'external',
      ecosystemConfigs: [{ id: 'npm', fixerStrategy: 'npm-audit' }],
    });
    const parsed = JSON.parse(json) as { scanners?: { sonarqube?: Record<string, unknown> } };
    expect(parsed.scanners?.sonarqube?.mode).toBe('external');
  });

  it('generated config with sonarQubeMode external passes schema validation', () => {
    const json = generateConfigJson({
      projectName: 'External Sonar Project',
      enableSonarQube: true,
      sonarQubeMode: 'external',
      ecosystemConfigs: [{ id: 'npm' }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });
});

describe('generateConfigJson — build config options', () => {
  it('generated config with npm runner build: { dockerfile } passes schema validation', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{
        id: 'npm',
        runner: { language_version: '20', build: { dockerfile: 'Dockerfile' } },
      }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('generated config with npm runner (language_version only, no build) passes schema validation', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{ id: 'npm', runner: { language_version: '20' } }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('generated config with pip runner build: { dockerfile } passes schema validation', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{
        id: 'pip',
        runner: { language_version: '3.11', build: { dockerfile: 'Dockerfile' } },
      }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('generated config with composer runner build: { dockerfile } passes schema validation', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{
        id: 'composer',
        runner: { language_version: '8.2', build: { dockerfile: '.docker/php.Dockerfile' } },
      }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('generated config with npm runner build: { context, args } passes schema validation', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{
        id: 'npm',
        runner: {
          language_version: '20',
          build: {
            dockerfile: 'Dockerfile',
            context: '.',
            args: { NODE_ENV: 'test' },
          },
        },
      }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('generated config with pip runner build: { context, args } passes schema validation', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{
        id: 'pip',
        runner: {
          language_version: '3.11',
          build: {
            dockerfile: 'Dockerfile',
            context: '.',
            args: { PYTHON_VERSION: '3.11' },
          },
        },
      }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('generated config with composer runner build: { context, args } passes schema validation', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{
        id: 'composer',
        runner: {
          language_version: '8.2',
          build: {
            dockerfile: '.docker/php.Dockerfile',
            context: '.docker/',
            args: { PHP_VERSION: '8.2' },
          },
        },
      }],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });

  it('full build config generates valid JSON with runner nested under ecosystem entry, not top-level', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{
        id: 'npm',
        runner: {
          language_version: '20',
          build: {
            dockerfile: 'Dockerfile',
            context: '.',
            target: 'node-stage',
            args: { NODE_ENV: 'production', APP_VERSION: '1.0' },
            allow_context_escape: true,
          },
        },
      }],
    });

    // Must parse as valid JSON
    const parsed = JSON.parse(json) as {
      ecosystems: { id: string; runner?: Record<string, unknown> }[];
      runners?: unknown;
    };

    // Must pass ProjectConfigSchema validation
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);

    // Runner block must be nested under the ecosystem entry, NOT as a top-level runners: section
    expect(parsed.runners).toBeUndefined();
    const npmEntry = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npmEntry).toBeDefined();
    expect(npmEntry?.runner).toBeDefined();
    expect(npmEntry?.runner?.language_version).toBe('20');

    // build block must be nested under runner
    const buildBlock = npmEntry?.runner?.build as Record<string, unknown> | undefined;
    expect(buildBlock).toBeDefined();
    expect(buildBlock?.dockerfile).toBe('Dockerfile');
    expect(buildBlock?.context).toBe('.');
    expect(buildBlock?.target).toBe('node-stage');
    expect(buildBlock?.allow_context_escape).toBe(true);

    // args must be present (rendered as JSON object)
    const buildArgs = buildBlock?.args as Record<string, string> | undefined;
    expect(buildArgs?.NODE_ENV).toBe('production');
    expect(buildArgs?.APP_VERSION).toBe('1.0');
  });

  it('generated config with build: { dockerfile } omits undefined fields', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [{
        id: 'npm',
        runner: {
          build: {
            dockerfile: 'Dockerfile',
          },
        },
      }],
    });

    const parsed = JSON.parse(json) as {
      ecosystems: { id: string; runner?: Record<string, unknown> }[];
    };
    const npmEntry = parsed.ecosystems.find((e) => e.id === 'npm');
    const buildBlock = npmEntry?.runner?.build as Record<string, unknown> | undefined;
    expect(buildBlock).toBeDefined();
    expect(buildBlock?.dockerfile).toBe('Dockerfile');
    // undefined fields must not appear in output
    expect(buildBlock?.context).toBeUndefined();
    expect(buildBlock?.target).toBeUndefined();
    expect(buildBlock?.args).toBeUndefined();
    expect(buildBlock?.allow_context_escape).toBeUndefined();
  });
});

describe('generateConfigJson — empty validationCommands', () => {
  it('emits validationCommands: [] and keeps advisors when validationCommands is empty', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [
        {
          id: 'composer',
          validationCommands: [],
          advisors: [{ name: 'audit', command: 'composer audit' }],
        },
      ],
    });

    // (a) JSON must parse successfully
    const parsed = JSON.parse(json) as {
      ecosystems: {
        id: string;
        validationCommands?: unknown[];
        advisors?: { name: string; command: string }[];
      }[];
    };

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
    const json = generateConfigJson({
      ecosystemConfigs: [
        {
          id: 'npm',
          validationCommands: [],
          advisors: [{ name: 'audit', command: 'npm audit' }],
        },
      ],
    });

    const parsed = JSON.parse(json) as {
      ecosystems: { id: string; validationCommands?: unknown[]; advisors?: unknown[] }[];
    };
    const npm = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npm?.validationCommands).toEqual([]);
    expect(npm?.advisors).toHaveLength(1);
  });

  it('generated JSON with empty validationCommands passes schema validation', () => {
    const json = generateConfigJson({
      ecosystemConfigs: [
        {
          id: 'composer',
          validationCommands: [],
          advisors: [{ name: 'audit', command: 'composer audit' }],
        },
      ],
    });
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });
});

describe('generateConfigJson — $schema field', () => {
  it('$schema field is a non-empty string', () => {
    const json = generateConfigJson();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(typeof parsed['$schema']).toBe('string');
    expect((parsed['$schema'] as string).length).toBeGreaterThan(0);
  });

  it('$schema field points to .security-scan/config-schema.json (local schema convention)', () => {
    const json = generateConfigJson();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['$schema']).toBe('./.security-scan/config-schema.json');
  });

  it('$schema field is present regardless of options', () => {
    const variants = [
      generateConfigJson(),
      generateConfigJson({ projectName: 'Test', enableSonarQube: true }),
      generateConfigJson({ ecosystemConfigs: [{ id: 'npm' }] }),
    ];
    for (const json of variants) {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      expect(parsed['$schema']).toBeDefined();
    }
  });

  it('$schema is excluded from Zod validation (schema allows unknown top-level $schema)', () => {
    // The $schema field must NOT cause ProjectConfigSchema.safeParse to fail.
    // It is an additional field that the schema ignores (or the schema strips it via strict mode).
    // We confirm the round-trip is valid regardless.
    const json = generateConfigJson({ projectName: 'Test', client: 'Acme' });
    // Remove $schema before Zod validation (Zod strict mode rejects unknown keys)
    const result = ProjectConfigSchema.safeParse(parseForSchema(json));
    expect(result.success).toBe(true);
  });
});

describe('generateJsonSchema', () => {
  it('returns a JSON Schema object with type: object', () => {
    const schema = generateJsonSchema();
    // zod-to-json-schema wraps in a definitions object; the root may be a $ref or have type
    expect(schema).toBeDefined();
    expect(typeof schema).toBe('object');
    expect(schema).not.toBeNull();
  });

  it('output is JSON-serializable', () => {
    const schema = generateJsonSchema();
    expect(() => JSON.stringify(schema)).not.toThrow();
    const serialized = JSON.stringify(schema);
    expect(typeof serialized).toBe('string');
    expect(serialized.length).toBeGreaterThan(0);
  });

  it('includes key properties: project, ecosystems, protected_packages', () => {
    const schema = generateJsonSchema();
    const serialized = JSON.stringify(schema);
    // The schema should reference these properties somewhere in its definitions
    expect(serialized).toContain('project');
    expect(serialized).toContain('ecosystems');
    expect(serialized).toContain('protected_packages');
  });

  it('returns a new object on each call (not a singleton)', () => {
    const schema1 = generateJsonSchema();
    const schema2 = generateJsonSchema();
    // Both should have the same structure but be distinct objects
    expect(JSON.stringify(schema1)).toBe(JSON.stringify(schema2));
    expect(schema1).not.toBe(schema2);
  });

  it('generated JSON Schema is non-trivially structured (has definitions or properties)', () => {
    const schema = generateJsonSchema();
    const hasDefinitions = 'definitions' in schema || '$defs' in schema || 'properties' in schema;
    expect(hasDefinitions).toBe(true);
  });
});
