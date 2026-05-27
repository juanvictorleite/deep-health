import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('@modules/ecosystem/plugins/pip-tooling-detector', () => ({
  detectPipTooling: vi.fn(),
}));

vi.mock('@modules/ecosystem/plugins/pip-uv-resolver', () => ({
  resolveWithUv: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { detectPipTooling } from '@modules/ecosystem/plugins/pip-tooling-detector';
import { resolveWithUv } from '@modules/ecosystem/plugins/pip-uv-resolver';
import {
  satisfiesPep440,
  normalizePep503,
  checkPackageReachability,
  buildGraphFromDetection,
  PipReachabilityAdapter,
} from '@modules/ecosystem/plugins/pip-reachability';
import type { PythonDependencyGraph } from '@modules/ecosystem/plugins/pip-dep-graph';

const mockedReadFile = readFile as unknown as ReturnType<typeof vi.fn>;
const mockedDetectPipTooling = detectPipTooling as unknown as ReturnType<typeof vi.fn>;
const mockedResolveWithUv = resolveWithUv as unknown as ReturnType<typeof vi.fn>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeGraph(entries: Array<{
  name: string;
  version: string;
  direct: boolean;
  editable?: boolean;
  requiredBy?: Array<{ name: string; constraint?: string }>;
  dependsOn?: Array<{ name: string; constraint?: string }>;
}>): PythonDependencyGraph {
  const graph: PythonDependencyGraph = new Map();
  for (const e of entries) {
    graph.set(e.name, {
      version: e.version,
      directDependency: e.direct,
      editable: e.editable,
      requiredBy: e.requiredBy ?? [],
      dependsOn: e.dependsOn ?? [],
    });
  }
  return graph;
}

// AC4 tramontina-localizador fixture:
// djangorestframework depends on django with constraint >=4.2
// django safe version is 3.2.15 (does NOT satisfy >=4.2)
const TRAMONTINA_GRAPH = makeGraph([
  {
    name: 'django',
    version: '3.2.15',
    direct: true,
    requiredBy: [{ name: 'djangorestframework', constraint: '>=4.2' }],
    dependsOn: [],
  },
  {
    name: 'djangorestframework',
    version: '3.14.0',
    direct: true,
    requiredBy: [],
    dependsOn: [{ name: 'django', constraint: '>=4.2' }],
  },
]);

// ─── satisfiesPep440 ──────────────────────────────────────────────────────────

describe('satisfiesPep440', () => {
  it('>=3.2 satisfies 3.2.15', () => {
    expect(satisfiesPep440('3.2.15', '>=3.2')).toBe(true);
  });

  it('>=4.2 does NOT satisfy 3.2.15', () => {
    expect(satisfiesPep440('3.2.15', '>=4.2')).toBe(false);
  });

  it('<0.7.0 does NOT satisfy 0.7.0', () => {
    expect(satisfiesPep440('0.7.0', '<0.7.0')).toBe(false);
  });

  it('~=3.2 satisfies 3.2.15 but not 4.0.0', () => {
    expect(satisfiesPep440('3.2.15', '~=3.2')).toBe(true);
    expect(satisfiesPep440('4.0.0', '~=3.2')).toBe(false);
  });

  it('==3.0.8 satisfies 3.0.8 but not 3.0.9', () => {
    expect(satisfiesPep440('3.0.8', '==3.0.8')).toBe(true);
    expect(satisfiesPep440('3.0.9', '==3.0.8')).toBe(false);
  });

  it('!=3.0.8 satisfies 3.0.9 but not 3.0.8', () => {
    expect(satisfiesPep440('3.0.9', '!=3.0.8')).toBe(true);
    expect(satisfiesPep440('3.0.8', '!=3.0.8')).toBe(false);
  });

  it('compound >=3.2,<4.0 satisfies 3.2.15 but not 4.0.1', () => {
    expect(satisfiesPep440('3.2.15', '>=3.2,<4.0')).toBe(true);
    expect(satisfiesPep440('4.0.1', '>=3.2,<4.0')).toBe(false);
  });

  it('empty specifier satisfies anything', () => {
    expect(satisfiesPep440('3.2.15', '')).toBe(true);
    expect(satisfiesPep440('0.0.1', '')).toBe(true);
  });

  it('* specifier satisfies anything', () => {
    expect(satisfiesPep440('3.2.15', '*')).toBe(true);
  });

  it('wildcard == satisfies prefix', () => {
    expect(satisfiesPep440('3.2.15', '==3.2.*')).toBe(true);
    expect(satisfiesPep440('4.0.0', '==3.2.*')).toBe(false);
  });
});

// ─── normalizePep503 ──────────────────────────────────────────────────────────

describe('normalizePep503', () => {
  it('lowercases and replaces separators with hyphens', () => {
    expect(normalizePep503('Django-REST-framework')).toBe('django-rest-framework');
    expect(normalizePep503('Pillow')).toBe('pillow');
    expect(normalizePep503('my_package.name')).toBe('my-package-name');
  });
});

// ─── checkPackageReachability — parent-blocks-child ──────────────────────────

describe('checkPackageReachability — parent-blocks-child', () => {
  it('blocked when parent constraint does not allow the safe version', () => {
    const graph = makeGraph([
      {
        name: 'cookie',
        version: '0.5.0',
        direct: true,
        requiredBy: [{ name: 'cookies-next', constraint: '<0.7.0' }],
      },
    ]);
    const safeVersionByName = new Map([['cookie', '0.7.0']]);
    const result = checkPackageReachability('cookie@0.7.0', graph, safeVersionByName, 1);
    expect(result.reachable).toBe(false);
    expect(result.blockReason).toContain('cookies-next');
    expect(result.blockedBy).toEqual(expect.arrayContaining([expect.stringContaining('<0.7.0')]));
  });

  it('reachable when parent constraint allows the safe version', () => {
    const graph = makeGraph([
      {
        name: 'lodash',
        version: '4.17.20',
        direct: true,
        requiredBy: [{ name: 'some-parent', constraint: '>=4.17.0' }],
      },
    ]);
    const safeVersionByName = new Map([['lodash', '4.17.21']]);
    const result = checkPackageReachability('lodash@4.17.21', graph, safeVersionByName, 1);
    expect(result.reachable).toBe(true);
  });

  it('reachable when no requiredBy entries exist', () => {
    const graph = makeGraph([
      { name: 'requests', version: '2.28.0', direct: true, requiredBy: [] },
    ]);
    const safeVersionByName = new Map([['requests', '2.32.0']]);
    const result = checkPackageReachability('requests@2.32.0', graph, safeVersionByName, 1);
    expect(result.reachable).toBe(true);
  });

  it('blocked with "not found" reason when package is absent from graph', () => {
    const graph = makeGraph([]);
    const safeVersionByName = new Map<string, string>();
    const result = checkPackageReachability('unknown-pkg@1.0.0', graph, safeVersionByName, 1);
    expect(result.reachable).toBe(false);
    expect(result.blockReason).toMatch(/not found/i);
  });
});

// ─── checkPackageReachability — cross-package-conflict (AC3 + AC4) ───────────

describe('checkPackageReachability — cross-package-conflict', () => {
  it('AC4 tramontina: django blocked by parent (DRF >=4.2), DRF blocked by cross-conflict', () => {
    const safeVersionByName = new Map([
      ['django', '3.2.15'],
      ['djangorestframework', '3.15.2'],
    ]);

    const djangoResult = checkPackageReachability(
      'django@3.2.15',
      TRAMONTINA_GRAPH,
      safeVersionByName,
      1,
    );
    expect(djangoResult.reachable).toBe(false);
    expect(djangoResult.blockReason).toContain('djangorestframework');

    const drfResult = checkPackageReachability(
      'djangorestframework@3.15.2',
      TRAMONTINA_GRAPH,
      safeVersionByName,
      1,
    );
    expect(drfResult.reachable).toBe(false);
    expect(drfResult.blockReason).toContain('django');
    expect(drfResult.blockReason?.toLowerCase()).toContain('cross-package');
  });

  it('two auto_safe packages with compatible constraints are both reachable', () => {
    const graph = makeGraph([
      {
        name: 'celery',
        version: '5.3.0',
        direct: true,
        requiredBy: [],
        dependsOn: [{ name: 'kombu', constraint: '>=5.3.0' }],
      },
      {
        name: 'kombu',
        version: '5.3.0',
        direct: true,
        requiredBy: [{ name: 'celery', constraint: '>=5.3.0' }],
        dependsOn: [],
      },
    ]);
    const safeVersionByName = new Map([
      ['celery', '5.4.0'],
      ['kombu', '5.4.0'],
    ]);

    const celeryResult = checkPackageReachability('celery@5.4.0', graph, safeVersionByName, 1);
    const kombuResult = checkPackageReachability('kombu@5.4.0', graph, safeVersionByName, 1);
    expect(celeryResult.reachable).toBe(true);
    expect(kombuResult.reachable).toBe(true);
  });

  it('auto_safe package depending on non-auto_safe package is not a cross-conflict', () => {
    const graph = makeGraph([
      {
        name: 'mylib',
        version: '1.0.0',
        direct: true,
        requiredBy: [],
        dependsOn: [{ name: 'six', constraint: '>=1.9.0' }],
      },
      {
        name: 'six',
        version: '1.16.0',
        direct: false,
        requiredBy: [{ name: 'mylib', constraint: '>=1.9.0' }],
        dependsOn: [],
      },
    ]);
    // six is NOT in safeVersionByName (not auto_safe)
    const safeVersionByName = new Map([['mylib', '1.1.0']]);
    const result = checkPackageReachability('mylib@1.1.0', graph, safeVersionByName, 1);
    expect(result.reachable).toBe(true);
  });
});

// ─── checkPackageReachability — AC5 transitive deps ─────────────────────────

describe('checkPackageReachability — transitive deps (AC5)', () => {
  it('tier 2: package with directDependency=false is blocked with transitive reason', () => {
    const graph = makeGraph([
      { name: 'urllib3', version: '1.26.18', direct: false },
    ]);
    const safeVersionByName = new Map([['urllib3', '2.0.7']]);
    const result = checkPackageReachability('urllib3@2.0.7', graph, safeVersionByName, 2);
    expect(result.reachable).toBe(false);
    expect(result.blockReason).toContain('Transitive dependency');
  });

  it('tier 3: package with directDependency=false is blocked with transitive reason', () => {
    const graph = makeGraph([
      { name: 'certifi', version: '2023.11.17', direct: false },
    ]);
    const safeVersionByName = new Map([['certifi', '2024.2.2']]);
    const result = checkPackageReachability('certifi@2024.2.2', graph, safeVersionByName, 3);
    expect(result.reachable).toBe(false);
    expect(result.blockReason).toContain('Transitive dependency');
  });

  it('tier 1: package with directDependency=false is still reachable (lockfile manages transitives)', () => {
    const graph = makeGraph([
      { name: 'urllib3', version: '1.26.18', direct: false },
    ]);
    const safeVersionByName = new Map([['urllib3', '2.0.7']]);
    const result = checkPackageReachability('urllib3@2.0.7', graph, safeVersionByName, 1);
    expect(result.reachable).toBe(true);
  });
});

// ─── checkPackageReachability — edge cases ───────────────────────────────────

describe('checkPackageReachability — edge cases', () => {
  it('editable package is always reachable', () => {
    const graph = makeGraph([
      {
        name: 'myapp',
        version: '',
        direct: true,
        editable: true,
        requiredBy: [{ name: 'some-parent', constraint: '==1.0.0' }],
      },
    ]);
    const safeVersionByName = new Map([['myapp', '2.0.0']]);
    const result = checkPackageReachability('myapp@2.0.0', graph, safeVersionByName, 1);
    expect(result.reachable).toBe(true);
  });

  it('malformed ref without @ returns reachable', () => {
    const graph = makeGraph([]);
    const safeVersionByName = new Map<string, string>();
    const result = checkPackageReachability('malformed-no-version', graph, safeVersionByName, 1);
    expect(result.reachable).toBe(true);
  });

  it('PEP 503 normalization: Django-REST-framework matches django-rest-framework in graph', () => {
    const graph = makeGraph([
      { name: 'django-rest-framework', version: '3.14.0', direct: true },
    ]);
    const safeVersionByName = new Map([['django-rest-framework', '3.15.2']]);
    const result = checkPackageReachability(
      'Django-REST-framework@3.15.2',
      graph,
      safeVersionByName,
      1,
    );
    expect(result.reachable).toBe(true);
  });
});

// ─── buildGraphFromDetection ──────────────────────────────────────────────────

describe('buildGraphFromDetection', () => {
  beforeEach(() => {
    mockedReadFile.mockReset();
    mockedResolveWithUv.mockReset();
  });

  it('tier 1 poetry: reads lockfile and parses it', async () => {
    // Minimal valid poetry.lock content
    const poetryLock = `
[[package]]
name = "django"
version = "3.2.15"
description = "A high-level Python web framework"
`;
    mockedReadFile.mockResolvedValue(poetryLock);
    const detection = {
      tier: 1 as const,
      tooling: 'poetry' as const,
      lockfile: '/project/poetry.lock',
      manifest: '/project/requirements.txt',
    };
    const graph = await buildGraphFromDetection(detection, '/project');
    expect(graph).toBeDefined();
    expect(graph!.size).toBeGreaterThan(0);
  });

  it('tier 2: reads manifest and calls parseViaAnnotations', async () => {
    const viaContent = `django==3.2.15\n    # via -r requirements.in\n`;
    mockedReadFile.mockResolvedValue(viaContent);
    const detection = {
      tier: 2 as const,
      tooling: 'pip-tools' as const,
      manifest: '/project/requirements.txt',
    };
    const graph = await buildGraphFromDetection(detection, '/project');
    expect(graph).toBeDefined();
  });

  it('tier 3: calls resolveWithUv', async () => {
    const fakeGraph: PythonDependencyGraph = makeGraph([
      { name: 'requests', version: '2.32.0', direct: true },
    ]);
    mockedResolveWithUv.mockResolvedValue(fakeGraph);
    const detection = {
      tier: 3 as const,
      tooling: 'bare-pip' as const,
      manifest: '/project/requirements.txt',
    };
    const graph = await buildGraphFromDetection(detection, '/project');
    expect(graph).toBe(fakeGraph);
    expect(mockedResolveWithUv).toHaveBeenCalledWith('/project');
  });

  it('returns undefined when readFile throws', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));
    const detection = {
      tier: 1 as const,
      tooling: 'poetry' as const,
      lockfile: '/project/poetry.lock',
      manifest: '/project/requirements.txt',
    };
    const graph = await buildGraphFromDetection(detection, '/project');
    expect(graph).toBeUndefined();
  });
});

// ─── PipReachabilityAdapter integration ──────────────────────────────────────

describe('PipReachabilityAdapter.ecosystemId', () => {
  it('is "pip"', () => {
    const adapter = new PipReachabilityAdapter();
    expect(adapter.ecosystemId).toBe('pip');
  });
});

describe('PipReachabilityAdapter.checkReachability', () => {
  beforeEach(() => {
    mockedReadFile.mockReset();
    mockedDetectPipTooling.mockReset();
    mockedResolveWithUv.mockReset();
  });

  it('tier 1 poetry: correctly blocks package with constraint violation', async () => {
    // django has a parent (DRF) requiring >=4.2
    const poetryLock = `
[[package]]
name = "django"
version = "3.2.15"
description = "Django"

[[package]]
name = "djangorestframework"
version = "3.14.0"
description = "DRF"

[package.dependencies]
Django = ">=4.2"
`;
    mockedDetectPipTooling.mockResolvedValue({
      tier: 1,
      tooling: 'poetry',
      lockfile: '/project/poetry.lock',
      manifest: '/project/requirements.txt',
    });
    mockedReadFile.mockResolvedValue(poetryLock);

    const adapter = new PipReachabilityAdapter();
    const results = await adapter.checkReachability(
      ['django@3.2.15', 'djangorestframework@3.15.2'],
      { cwd: '/project' },
    );

    const djangoResult = results.find((r) => r.packageRef === 'django@3.2.15')!;
    expect(djangoResult.reachable).toBe(false);
    expect(djangoResult.blockReason).toContain('djangorestframework');
  });

  it('tier 2: via-annotated requirements.txt used for graph', async () => {
    const viaContent = `
requests==2.32.0
    # via -r requirements.in
`;
    mockedDetectPipTooling.mockResolvedValue({
      tier: 2,
      tooling: 'pip-tools',
      manifest: '/project/requirements.txt',
    });
    mockedReadFile.mockResolvedValue(viaContent);

    const adapter = new PipReachabilityAdapter();
    const results = await adapter.checkReachability(['requests@2.32.0'], { cwd: '/project' });
    const check = results.find((r) => r.packageRef === 'requests@2.32.0')!;
    expect(check.reachable).toBe(true);
  });

  it('tier 3: calls resolveWithUv and uses returned graph', async () => {
    const fakeGraph: PythonDependencyGraph = makeGraph([
      { name: 'flask', version: '3.0.0', direct: true },
    ]);
    mockedDetectPipTooling.mockResolvedValue({
      tier: 3,
      tooling: 'bare-pip',
      manifest: '/project/requirements.txt',
    });
    mockedResolveWithUv.mockResolvedValue(fakeGraph);

    const adapter = new PipReachabilityAdapter();
    const results = await adapter.checkReachability(['flask@3.1.0'], { cwd: '/project' });
    expect(mockedResolveWithUv).toHaveBeenCalledWith('/project');
    const check = results.find((r) => r.packageRef === 'flask@3.1.0')!;
    expect(check.reachable).toBe(true);
  });

  it('detection fails: returns all reachable (conservative fallback)', async () => {
    mockedDetectPipTooling.mockRejectedValue(new Error('No requirements.txt found'));

    const adapter = new PipReachabilityAdapter();
    const results = await adapter.checkReachability(
      ['django@4.2.0', 'requests@2.32.0'],
      { cwd: '/project' },
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.reachable)).toBe(true);
  });

  it('empty graph returns all reachable (conservative fallback)', async () => {
    mockedDetectPipTooling.mockResolvedValue({
      tier: 3,
      tooling: 'bare-pip',
      manifest: '/project/requirements.txt',
    });
    // resolveWithUv returns empty graph
    mockedResolveWithUv.mockResolvedValue(new Map());

    const adapter = new PipReachabilityAdapter();
    const results = await adapter.checkReachability(['django@4.2.0'], { cwd: '/project' });
    expect(results.every((r) => r.reachable)).toBe(true);
  });
});
