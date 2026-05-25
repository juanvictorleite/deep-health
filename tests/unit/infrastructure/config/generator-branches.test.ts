/**
 * Branch coverage top-up for src/infrastructure/config/generator.ts
 * Targets:
 *   lines 176-179: unknown ecosystem id → falls into ECOSYSTEM_EXAMPLES[id] ?? fallback object
 *   (framework_profile removed per ADR-0004 — field no longer exists in generator)
 */
import { describe, it, expect } from 'vitest';
import { generateConfigJson } from '@infra/config/generator';

describe('generateConfigJson() — unknown ecosystem fallback (lines 176-179)', () => {
  it('uses generic fallback examples when ecosystem id is not in ECOSYSTEM_EXAMPLES', () => {
    const json = generateConfigJson({
      projectName: 'Test',
      client: 'Acme',
      ecosystemConfigs: [
        { id: 'ruby', fixerStrategy: 'bundler' }, // 'ruby' is not in ECOSYSTEM_EXAMPLES
      ],
    });
    expect(typeof json).toBe('string');
    // Output is valid JSON
    expect(() => JSON.parse(json)).not.toThrow();
    // The unknown ecosystem appears in the ecosystems array
    const parsed = JSON.parse(json) as { ecosystems: Array<{ id: string }> };
    expect(parsed.ecosystems.some((e) => e.id === 'ruby')).toBe(true);
    // protected_packages should include the ruby key (from the allIds merge)
    const pp = (parsed as { protected_packages: Record<string, unknown> }).protected_packages;
    expect('ruby' in pp).toBe(true);
  });
});

describe('generateConfigJson() — framework_profile removed (ADR-0004)', () => {
  it('never writes framework_profile to generated JSON (field removed in ADR-0004)', () => {
    const json = generateConfigJson({
      projectName: 'Test',
      client: 'Acme',
    });
    expect(typeof json).toBe('string');
    expect(json).not.toContain('framework_profile');
    expect(json).not.toContain('image_strategy');
  });
});
