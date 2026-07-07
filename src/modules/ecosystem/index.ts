// Public API for the ecosystem abstraction layer
export { EcosystemRegistry, createEcosystemRegistry } from './registry';
export type { EcosystemPlugin, EcosystemUpdaterContext } from './types';
export { npmPlugin } from './plugins/npm';
export { composerPlugin } from './plugins/composer';
export { pipPlugin } from './plugins/pip';

import { composerPlugin } from './plugins/composer';
import { npmPlugin } from './plugins/npm';
import { pipPlugin } from './plugins/pip';
import { createEcosystemRegistry } from './registry';

// Registration order is preserved (Map insertion order) — npm phase always
// runs before composer, then pip.
export const defaultRegistry = createEcosystemRegistry([npmPlugin, composerPlugin, pipPlugin]);
