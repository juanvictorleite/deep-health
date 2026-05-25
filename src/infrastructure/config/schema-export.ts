import { zodToJsonSchema } from 'zod-to-json-schema';
import { ProjectConfigSchema } from '@infra/config/schema';

/**
 * Generates a JSON Schema object from the Zod ProjectConfigSchema.
 *
 * The returned schema can be written alongside the config file to enable
 * IDE autocomplete, validation, and hover documentation.
 *
 * Note: ProjectConfigSchema uses .strict() so the generated schema will
 * include `additionalProperties: false` — this is correct behavior for
 * IDE validation.
 */
export function generateJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(ProjectConfigSchema, {
    name: 'ProjectConfig',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;
}
