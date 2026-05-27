import { describe, it, expect } from 'vitest';
import {
  parsePoetryLock,
  parseUvLock,
  parsePipfileLock,
  parsePdmLock,
} from '@modules/ecosystem/plugins/pip-lockfile-parsers';

// ---------------------------------------------------------------------------
// parsePoetryLock
// ---------------------------------------------------------------------------

const POETRY_FIXTURE = `
[metadata]
python-versions = "^3.8"
content-hash = "abc123"

[[package]]
name = "Django"
version = "3.0.8"
description = "A high-level Python Web framework"
optional = false
python-versions = ">=3.6"

[package.dependencies]
asgiref = ">=3.2,<3.3"
pytz = "*"
sqlparse = ">=0.2.2"

[[package]]
name = "asgiref"
version = "3.2.10"
description = "ASGI specs"
optional = false
python-versions = ">=3.5"

[[package]]
name = "pytz"
version = "2021.1"
description = "World timezone definitions"
optional = false
python-versions = "*"

[[package]]
name = "sqlparse"
version = "0.4.1"
description = "SQL parser"
optional = false
python-versions = ">=2.7"
`;

const POETRY_OPTIONAL_DEP_FIXTURE = `
[[package]]
name = "celery"
version = "5.3.0"
description = "Celery"
optional = false
python-versions = ">=3.8"

[package.dependencies]
billiard = {version = ">=3.6.4.0,<4.2", optional = true}
kombu = ">=5.3.2,<6.0"

[[package]]
name = "billiard"
version = "3.6.4.0"
description = "Billiard"
optional = false
python-versions = "*"

[[package]]
name = "kombu"
version = "5.3.2"
description = "Kombu"
optional = false
python-versions = ">=3.8"
`;

describe('parsePoetryLock — AC1: basic parsing', () => {
  it('returns a Map with correct package count', () => {
    const graph = parsePoetryLock(POETRY_FIXTURE);
    expect(graph).toBeInstanceOf(Map);
    expect(graph.size).toBe(4);
  });

  it('extracts correct versions', () => {
    const graph = parsePoetryLock(POETRY_FIXTURE);
    expect(graph.get('django')?.version).toBe('3.0.8');
    expect(graph.get('asgiref')?.version).toBe('3.2.10');
    expect(graph.get('pytz')?.version).toBe('2021.1');
    expect(graph.get('sqlparse')?.version).toBe('0.4.1');
  });

  it('normalizes package names to lowercase', () => {
    const graph = parsePoetryLock(POETRY_FIXTURE);
    expect(graph.has('Django')).toBe(false);
    expect(graph.has('django')).toBe(true);
  });

  it('builds dependsOn edges from [package.dependencies]', () => {
    const graph = parsePoetryLock(POETRY_FIXTURE);
    const django = graph.get('django')!;
    expect(django.dependsOn.length).toBe(3);
    expect(django.dependsOn.some((d) => d.name === 'asgiref' && d.constraint === '>=3.2,<3.3')).toBe(true);
    expect(django.dependsOn.some((d) => d.name === 'pytz' && d.constraint === '*')).toBe(true);
    expect(django.dependsOn.some((d) => d.name === 'sqlparse' && d.constraint === '>=0.2.2')).toBe(true);
  });

  it('builds reverse requiredBy edges', () => {
    const graph = parsePoetryLock(POETRY_FIXTURE);
    const asgiref = graph.get('asgiref')!;
    expect(asgiref.requiredBy.some((r) => r.name === 'django')).toBe(true);
  });

  it('packages with no dependencies have empty dependsOn', () => {
    const graph = parsePoetryLock(POETRY_FIXTURE);
    expect(graph.get('asgiref')!.dependsOn).toHaveLength(0);
    expect(graph.get('pytz')!.dependsOn).toHaveLength(0);
  });
});

describe('parsePoetryLock — AC1: optional dependencies (object-style constraints)', () => {
  it('extracts version from {version = "...", optional = true} objects', () => {
    const graph = parsePoetryLock(POETRY_OPTIONAL_DEP_FIXTURE);
    const celery = graph.get('celery')!;
    expect(celery.dependsOn.some((d) => d.name === 'billiard' && d.constraint === '>=3.6.4.0,<4.2')).toBe(true);
  });

  it('includes both optional and non-optional deps in dependsOn', () => {
    const graph = parsePoetryLock(POETRY_OPTIONAL_DEP_FIXTURE);
    const celery = graph.get('celery')!;
    expect(celery.dependsOn.length).toBe(2);
  });
});

describe('parsePoetryLock — AC6: error handling', () => {
  it('returns empty graph for empty string', () => {
    expect(parsePoetryLock('')).toEqual(new Map());
  });

  it('returns empty graph for whitespace-only content', () => {
    expect(parsePoetryLock('   \n  ')).toEqual(new Map());
  });

  it('returns empty graph for invalid TOML', () => {
    expect(parsePoetryLock('[[package]\nname = unclosed')).toEqual(new Map());
  });
});

// ---------------------------------------------------------------------------
// parseUvLock
// ---------------------------------------------------------------------------

const UV_FIXTURE = `
version = 1

[[package]]
name = "django"
version = "4.2.0"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "asgiref", specifier = ">=3.4.1,<4" },
    { name = "sqlparse", specifier = ">=0.3.1" },
]

[[package]]
name = "asgiref"
version = "3.7.2"
source = { registry = "https://pypi.org/simple" }
dependencies = []

[[package]]
name = "sqlparse"
version = "0.5.0"
source = { registry = "https://pypi.org/simple" }
dependencies = []

[[package]]
name = "pytest"
version = "7.4.0"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "asgiref" },
]
`;

describe('parseUvLock — AC2: basic parsing', () => {
  it('returns a Map with correct package count', () => {
    const graph = parseUvLock(UV_FIXTURE);
    expect(graph).toBeInstanceOf(Map);
    expect(graph.size).toBe(4);
  });

  it('extracts correct versions', () => {
    const graph = parseUvLock(UV_FIXTURE);
    expect(graph.get('django')?.version).toBe('4.2.0');
    expect(graph.get('asgiref')?.version).toBe('3.7.2');
    expect(graph.get('sqlparse')?.version).toBe('0.5.0');
  });

  it('builds dependsOn edges from dependencies array', () => {
    const graph = parseUvLock(UV_FIXTURE);
    const django = graph.get('django')!;
    expect(django.dependsOn.length).toBe(2);
    expect(django.dependsOn.some((d) => d.name === 'asgiref' && d.constraint === '>=3.4.1,<4')).toBe(true);
    expect(django.dependsOn.some((d) => d.name === 'sqlparse' && d.constraint === '>=0.3.1')).toBe(true);
  });

  it('uses * as constraint when specifier is absent', () => {
    const graph = parseUvLock(UV_FIXTURE);
    const pytest = graph.get('pytest')!;
    expect(pytest.dependsOn.some((d) => d.name === 'asgiref' && d.constraint === '*')).toBe(true);
  });

  it('builds bidirectional requiredBy edges', () => {
    const graph = parseUvLock(UV_FIXTURE);
    const asgiref = graph.get('asgiref')!;
    expect(asgiref.requiredBy.some((r) => r.name === 'django')).toBe(true);
    expect(asgiref.requiredBy.some((r) => r.name === 'pytest')).toBe(true);
  });

  it('packages with empty dependencies array have empty dependsOn', () => {
    const graph = parseUvLock(UV_FIXTURE);
    expect(graph.get('asgiref')!.dependsOn).toHaveLength(0);
    expect(graph.get('sqlparse')!.dependsOn).toHaveLength(0);
  });
});

describe('parseUvLock — AC6: error handling', () => {
  it('returns empty graph for empty string', () => {
    expect(parseUvLock('')).toEqual(new Map());
  });

  it('returns empty graph for invalid TOML', () => {
    expect(parseUvLock('[[package]\nbroken')).toEqual(new Map());
  });

  it('returns empty graph for TOML with no package array', () => {
    expect(parseUvLock('version = 1\nfoo = "bar"')).toEqual(new Map());
  });
});

// ---------------------------------------------------------------------------
// parsePipfileLock
// ---------------------------------------------------------------------------

const PIPFILE_LOCK_FIXTURE = JSON.stringify({
  _meta: {
    requires: { python_version: '3.9' },
    sources: [{ url: 'https://pypi.org/simple', verify_ssl: true }],
  },
  default: {
    django: {
      version: '==3.2.18',
      hashes: ['sha256:abc'],
      requires: {
        asgiref: '>=3.3.2,<4',
        pytz: '*',
        sqlparse: '>=0.2.2',
      },
    },
    asgiref: {
      version: '==3.5.0',
      hashes: ['sha256:def'],
    },
    pytz: {
      version: '==2023.3',
      hashes: ['sha256:ghi'],
    },
    sqlparse: {
      version: '==0.4.4',
      hashes: ['sha256:jkl'],
    },
  },
  develop: {
    pytest: {
      version: '==7.4.0',
      hashes: ['sha256:mno'],
    },
  },
});

describe('parsePipfileLock — AC3: basic parsing', () => {
  it('returns a Map with packages from both default and develop sections', () => {
    const graph = parsePipfileLock(PIPFILE_LOCK_FIXTURE);
    expect(graph).toBeInstanceOf(Map);
    expect(graph.size).toBe(5);
  });

  it('strips the == prefix from versions', () => {
    const graph = parsePipfileLock(PIPFILE_LOCK_FIXTURE);
    expect(graph.get('django')?.version).toBe('3.2.18');
    expect(graph.get('asgiref')?.version).toBe('3.5.0');
    expect(graph.get('pytest')?.version).toBe('7.4.0');
  });

  it('includes packages from the develop section', () => {
    const graph = parsePipfileLock(PIPFILE_LOCK_FIXTURE);
    expect(graph.has('pytest')).toBe(true);
  });

  it('builds dependsOn edges from requires object', () => {
    const graph = parsePipfileLock(PIPFILE_LOCK_FIXTURE);
    const django = graph.get('django')!;
    expect(django.dependsOn.length).toBe(3);
    expect(django.dependsOn.some((d) => d.name === 'asgiref' && d.constraint === '>=3.3.2,<4')).toBe(true);
    expect(django.dependsOn.some((d) => d.name === 'pytz' && d.constraint === '*')).toBe(true);
    expect(django.dependsOn.some((d) => d.name === 'sqlparse' && d.constraint === '>=0.2.2')).toBe(true);
  });

  it('builds bidirectional requiredBy edges', () => {
    const graph = parsePipfileLock(PIPFILE_LOCK_FIXTURE);
    const asgiref = graph.get('asgiref')!;
    expect(asgiref.requiredBy.some((r) => r.name === 'django')).toBe(true);
  });

  it('packages without requires have empty dependsOn', () => {
    const graph = parsePipfileLock(PIPFILE_LOCK_FIXTURE);
    expect(graph.get('pytest')!.dependsOn).toHaveLength(0);
    expect(graph.get('asgiref')!.dependsOn).toHaveLength(0);
  });
});

describe('parsePipfileLock — AC6: error handling', () => {
  it('returns empty graph for empty string', () => {
    expect(parsePipfileLock('')).toEqual(new Map());
  });

  it('returns empty graph for invalid JSON', () => {
    expect(parsePipfileLock('{not valid json')).toEqual(new Map());
  });

  it('returns empty graph when no default or develop sections', () => {
    expect(parsePipfileLock(JSON.stringify({ _meta: {} }))).toEqual(new Map());
  });
});

// ---------------------------------------------------------------------------
// parsePdmLock
// ---------------------------------------------------------------------------

const PDM_FIXTURE = `
[[package]]
name = "django"
version = "4.2.0"
requires_python = ">=3.8"
summary = "A high-level Python Web framework"
dependencies = [
    "asgiref>=3.4.1,<4",
    "sqlparse>=0.3.1",
    "pytz",
]

[[package]]
name = "asgiref"
version = "3.7.2"
requires_python = ">=3.7"
summary = "ASGI specs"

[[package]]
name = "sqlparse"
version = "0.5.0"
requires_python = ">=3.5"
summary = "SQL parser"

[[package]]
name = "pytz"
version = "2023.3"
summary = "World timezone definitions"
`;

const PDM_COMPLEX_CONSTRAINTS = `
[[package]]
name = "celery"
version = "5.3.0"
dependencies = [
    "billiard>=3.6.4.0,<4.2",
    "kombu>=5.3.2,<6.0",
    "vine~=5.1.0",
    "click!=8.0.0,>=8.0.1",
    "setuptools>60",
]

[[package]]
name = "billiard"
version = "3.6.4.0"

[[package]]
name = "kombu"
version = "5.3.2"

[[package]]
name = "vine"
version = "5.1.0"

[[package]]
name = "click"
version = "8.1.0"

[[package]]
name = "setuptools"
version = "68.0.0"
`;

describe('parsePdmLock — AC4: basic parsing', () => {
  it('returns a Map with correct package count', () => {
    const graph = parsePdmLock(PDM_FIXTURE);
    expect(graph).toBeInstanceOf(Map);
    expect(graph.size).toBe(4);
  });

  it('extracts correct versions', () => {
    const graph = parsePdmLock(PDM_FIXTURE);
    expect(graph.get('django')?.version).toBe('4.2.0');
    expect(graph.get('asgiref')?.version).toBe('3.7.2');
    expect(graph.get('sqlparse')?.version).toBe('0.5.0');
    expect(graph.get('pytz')?.version).toBe('2023.3');
  });

  it('parses constraints from dependency strings', () => {
    const graph = parsePdmLock(PDM_FIXTURE);
    const django = graph.get('django')!;
    expect(django.dependsOn.length).toBe(3);
    expect(django.dependsOn.some((d) => d.name === 'asgiref' && d.constraint === '>=3.4.1,<4')).toBe(true);
    expect(django.dependsOn.some((d) => d.name === 'sqlparse' && d.constraint === '>=0.3.1')).toBe(true);
  });

  it('handles bare package names (no constraint) as dependsOn without constraint', () => {
    const graph = parsePdmLock(PDM_FIXTURE);
    const django = graph.get('django')!;
    const pytzDep = django.dependsOn.find((d) => d.name === 'pytz');
    expect(pytzDep).toBeDefined();
    expect(pytzDep!.constraint).toBeUndefined();
  });

  it('builds bidirectional requiredBy edges', () => {
    const graph = parsePdmLock(PDM_FIXTURE);
    const asgiref = graph.get('asgiref')!;
    expect(asgiref.requiredBy.some((r) => r.name === 'django')).toBe(true);
  });

  it('packages with no dependencies have empty dependsOn', () => {
    const graph = parsePdmLock(PDM_FIXTURE);
    expect(graph.get('asgiref')!.dependsOn).toHaveLength(0);
    expect(graph.get('pytz')!.dependsOn).toHaveLength(0);
  });
});

describe('parsePdmLock — AC4: complex constraint operators', () => {
  it('handles >= operator', () => {
    const graph = parsePdmLock(PDM_COMPLEX_CONSTRAINTS);
    const celery = graph.get('celery')!;
    expect(celery.dependsOn.some((d) => d.name === 'billiard' && d.constraint === '>=3.6.4.0,<4.2')).toBe(true);
  });

  it('handles ~= operator', () => {
    const graph = parsePdmLock(PDM_COMPLEX_CONSTRAINTS);
    const celery = graph.get('celery')!;
    expect(celery.dependsOn.some((d) => d.name === 'vine' && d.constraint === '~=5.1.0')).toBe(true);
  });

  it('handles > operator', () => {
    const graph = parsePdmLock(PDM_COMPLEX_CONSTRAINTS);
    const celery = graph.get('celery')!;
    expect(celery.dependsOn.some((d) => d.name === 'setuptools' && d.constraint === '>60')).toBe(true);
  });
});

describe('parsePdmLock — AC6: error handling', () => {
  it('returns empty graph for empty string', () => {
    expect(parsePdmLock('')).toEqual(new Map());
  });

  it('returns empty graph for invalid TOML', () => {
    expect(parsePdmLock('[[package]\nbroken syntax here')).toEqual(new Map());
  });

  it('returns empty graph for TOML with no package array', () => {
    expect(parsePdmLock('[metadata]\nlock_version = "4.1"')).toEqual(new Map());
  });
});
