/**
 * Unit tests for createEcosystemRegistry (ADR 0009) and the default registry
 * bootstrap in src/modules/ecosystem/index.ts.
 */
import { describe, it, expect } from 'vitest';

import type { EcosystemPlugin } from '@modules/ecosystem/types';
import { createEcosystemRegistry } from '@modules/ecosystem/registry';
import { defaultRegistry, npmPlugin, composerPlugin, pipPlugin } from '@modules/ecosystem';

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

describe('createEcosystemRegistry', () => {
  it('returns a registry whose getAll() yields exactly the given plugins', () => {
    const fakePlugin = makeFakePlugin('fake');

    const registry = createEcosystemRegistry([fakePlugin]);

    expect(registry.getAll()).toEqual([fakePlugin]);
  });

  it('registers plugins in array order (insertion order)', () => {
    const first = makeFakePlugin('first');
    const second = makeFakePlugin('second');

    const registry = createEcosystemRegistry([second, first]);

    expect(registry.getAll()).toEqual([second, first]);
  });

  it('returns an empty registry when given an empty plugin list', () => {
    const registry = createEcosystemRegistry([]);

    expect(registry.getAll()).toEqual([]);
  });
});

describe('defaultRegistry', () => {
  it('yields npm, composer, pip in that order', () => {
    expect(defaultRegistry.getAll()).toEqual([npmPlugin, composerPlugin, pipPlugin]);
  });
});
