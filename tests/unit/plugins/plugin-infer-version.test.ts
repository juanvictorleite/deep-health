/**
 * Tests for EcosystemPlugin.versionSources implementations (npm + composer)
 * and EcosystemPlugin.versionSources (pip).
 *
 * All plugins use the declarative versionSources array with the
 * inferVersionFromSources engine. We mock `node:fs/promises` so no real
 * filesystem access occurs.
 *
 * npm precedence:      .nvmrc → .node-version → package.json#engines.node
 * composer precedence: .php-version → composer.json#require.php
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── fs/promises mock ─────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { npmPlugin } from '@modules/ecosystem/plugins/npm';
import { composerPlugin } from '@modules/ecosystem/plugins/composer';
import { pipPlugin } from '@modules/ecosystem/plugins/pip';
import { inferVersionFromSources } from '@infra/utils/infer-version';

const mockReadFile = vi.mocked(readFile);

/** Reject with ENOENT for any path that doesn't match a known stub. */
const ENOENT = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

// ─── npm plugin ───────────────────────────────────────────────────────────────

describe('npmPlugin.versionSources — .nvmrc precedence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns version from .nvmrc (strips leading v)', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.nvmrc')) return 'v20.11.1';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('20.11.1');
  });

  it('returns version from .nvmrc without leading v', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.nvmrc')) return '20';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('20');
  });

  it('skips .nvmrc alias lts/* and falls through to .node-version', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.nvmrc')) return 'lts/*';
      if (String(p).endsWith('.node-version')) return '18.20.2';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('18.20.2');
  });

  it('skips .nvmrc alias "node" and falls through to package.json', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.nvmrc')) return 'node';
      if (String(p).endsWith('.node-version')) throw ENOENT;
      if (String(p).endsWith('package.json')) return JSON.stringify({ engines: { node: '^22' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('22');
  });
});

describe('npmPlugin.versionSources — .node-version precedence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns version from .node-version when .nvmrc is missing', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.nvmrc')) throw ENOENT;
      if (String(p).endsWith('.node-version')) return 'v18.20';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('18.20');
  });

  it('.nvmrc wins over .node-version when both are concrete', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.nvmrc')) return '20.11';
      if (String(p).endsWith('.node-version')) return '18';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('20.11');
  });
});

describe('npmPlugin.versionSources — package.json#engines.node fallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns major version from >=20.0.0 engines.node range', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json'))
        return JSON.stringify({ engines: { node: '>=20.0.0' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('20.0.0');
  });

  it('returns "20" from ">=20" engines.node range', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json'))
        return JSON.stringify({ engines: { node: '>=20' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('20');
  });

  it('returns "18" from "^18" engines.node range', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json'))
        return JSON.stringify({ engines: { node: '^18' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('18');
  });

  it('returns "20.11" from "~20.11" engines.node range', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json'))
        return JSON.stringify({ engines: { node: '~20.11' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('20.11');
  });

  it('returns "20" from "20.x" engines.node range', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json'))
        return JSON.stringify({ engines: { node: '20.x' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('20');
  });

  it('returns "20" from exact "20" engines.node', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json'))
        return JSON.stringify({ engines: { node: '20' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('20');
  });

  it('returns "18" from range ">=18 <21" (lower bound)', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json'))
        return JSON.stringify({ engines: { node: '>=18 <21' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('18');
  });

  it('returns undefined for wildcard "*" engines.node', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json'))
        return JSON.stringify({ engines: { node: '*' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBeUndefined();
  });

  it('returns undefined when engines.node is absent', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json')) return JSON.stringify({ name: 'my-app' });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBeUndefined();
  });

  it('returns undefined when engines field is absent', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json')) return JSON.stringify({});
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBeUndefined();
  });

  it('returns undefined when engines.node is empty string', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json'))
        return JSON.stringify({ engines: { node: '' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBeUndefined();
  });
});

describe('npmPlugin.versionSources — error handling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined when all files are missing (ENOENT)', async () => {
    mockReadFile.mockRejectedValue(ENOENT);
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBeUndefined();
  });

  it('returns undefined when package.json is malformed JSON', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json')) return 'NOT JSON';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBeUndefined();
  });
});

// ─── composer plugin ──────────────────────────────────────────────────────────

describe('composerPlugin.versionSources — .php-version precedence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns version from .php-version (strips leading v)', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.php-version')) return 'v8.3.0';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBe('8.3.0');
  });

  it('returns version from .php-version without leading v', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.php-version')) return '8.2';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBe('8.2');
  });

  it('.php-version wins over composer.json when both present', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.php-version')) return '8.3';
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: '^8.1' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBe('8.3');
  });

  it('falls through to composer.json when .php-version is missing', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.php-version')) throw ENOENT;
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: '^8.2' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBe('8.2');
  });
});

describe('composerPlugin.versionSources — composer.json#require.php fallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns "8.2" from "^8.2" require.php constraint', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: '^8.2' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBe('8.2');
  });

  it('returns "8.1" from ">=8.1" require.php constraint', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: '>=8.1' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBe('8.1');
  });

  it('returns "8.2" from "8.2.*" require.php constraint', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: '8.2.*' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBe('8.2');
  });

  it('returns "8.2.0" from "~8.2.0" require.php constraint', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: '~8.2.0' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBe('8.2.0');
  });

  it('returns "8.2" from exact "8.2" require.php constraint', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: '8.2' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBe('8.2');
  });

  it('returns undefined for wildcard "*" require.php', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: '*' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBeUndefined();
  });

  it('returns undefined when require.php is absent', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { 'some/package': '^1.0' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBeUndefined();
  });

  it('returns undefined when require field is absent', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json')) return JSON.stringify({ name: 'my/app' });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBeUndefined();
  });

  it('returns first bound from compound constraint ">=8.1 <9.0"', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: '>=8.1 <9.0' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBe('8.1');
  });
});

describe('composerPlugin.versionSources — error handling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined when all files are missing (ENOENT)', async () => {
    mockReadFile.mockRejectedValue(ENOENT);
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBeUndefined();
  });

  it('returns undefined when composer.json is malformed JSON', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json')) return 'NOT JSON';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBeUndefined();
  });
});

// ─── composer plugin — parseComposerPhpConstraint branch gaps ─────────────────

describe('composerPlugin.versionSources — parseComposerPhpConstraint branch gaps', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined when constraint splits to empty first part (e.g. pipe-only "|8.1")', async () => {
    // Split on pipe produces ['', '8.1']; firstPart = '' → falsy → return undefined (line 38)
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: '|8.1' } });
      throw ENOENT;
    });
    // '|8.1' splits to ['', '8.1'], firstPart = '' → undefined
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBeUndefined();
  });

  it('returns undefined when constraint has no numeric part (e.g. "dev-main")', async () => {
    // No match on numeric regex → line 48-51 branch
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('composer.json'))
        return JSON.stringify({ require: { php: 'dev-main' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', composerPlugin.versionSources!)).toBeUndefined();
  });
});



// ─── pip plugin ───────────────────────────────────────────────────────────────

describe('pipPlugin.versionSources — .python-version precedence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns version from .python-version (strips leading v)', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) return 'v3.11.2';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.11');
  });

  it('returns version from .python-version without leading v', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) return '3.9';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.9');
  });

  it('.python-version wins over all other sources', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) return '3.12';
      if (String(p).endsWith('Dockerfile')) return 'FROM python:3.7\n';
      if (String(p).endsWith('Pipfile')) return "python_version = '3.8'\n";
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.12');
  });
});

describe('pipPlugin.versionSources — .tool-versions fallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns version from .tool-versions python line', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) throw ENOENT;
      if (String(p).endsWith('.tool-versions')) return 'nodejs 20.11.0\npython 3.11.2\n';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.11');
  });

  it('skips .tool-versions when no python line present', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) throw ENOENT;
      if (String(p).endsWith('.tool-versions')) return 'nodejs 20.11.0\nruby 3.2.0\n';
      if (String(p).endsWith('pyproject.toml')) return '[build-system]\nrequires-python = ">=3.10"\n';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.10');
  });
});

describe('pipPlugin.versionSources — pyproject.toml requires-python', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns version from pyproject.toml requires-python', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) throw ENOENT;
      if (String(p).endsWith('.tool-versions')) throw ENOENT;
      if (String(p).endsWith('pyproject.toml')) return '[project]\nrequires-python = ">=3.10"\n';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.10');
  });

  it('returns version from pyproject.toml requires-python with ~= constraint', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) throw ENOENT;
      if (String(p).endsWith('.tool-versions')) throw ENOENT;
      if (String(p).endsWith('pyproject.toml')) return 'requires-python = "~=3.9.2"\n';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.9');
  });
});

describe('pipPlugin.versionSources — setup.cfg python_requires', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns version from setup.cfg python_requires', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) throw ENOENT;
      if (String(p).endsWith('.tool-versions')) throw ENOENT;
      if (String(p).endsWith('pyproject.toml')) throw ENOENT;
      if (String(p).endsWith('setup.cfg')) return '[options]\npython_requires = >=3.8\n';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.8');
  });
});

describe('pipPlugin.versionSources — runtime.txt (Heroku)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns version from runtime.txt Heroku format', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) throw ENOENT;
      if (String(p).endsWith('.tool-versions')) throw ENOENT;
      if (String(p).endsWith('pyproject.toml')) throw ENOENT;
      if (String(p).endsWith('setup.cfg')) throw ENOENT;
      if (String(p).endsWith('runtime.txt')) return 'python-3.11.4';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.11');
  });
});

describe('pipPlugin.versionSources — Dockerfile FROM python:X.Y', () => {
  beforeEach(() => vi.clearAllMocks());

  const allMissingUntilDockerfile = async (p: any, dockerfileContent: string) => {
    const s = String(p);
    if (s.endsWith('.python-version')) throw ENOENT;
    if (s.endsWith('.tool-versions')) throw ENOENT;
    if (s.endsWith('pyproject.toml')) throw ENOENT;
    if (s.endsWith('setup.cfg')) throw ENOENT;
    if (s.endsWith('runtime.txt')) throw ENOENT;
    if (s.endsWith('Dockerfile')) return dockerfileContent;
    throw ENOENT;
  };

  it('returns version from FROM python:3.7', async () => {
    mockReadFile.mockImplementation(async (p: any) =>
      allMissingUntilDockerfile(p, 'FROM python:3.7\nRUN pip install -r requirements.txt\n'),
    );
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.7');
  });

  it('returns version from FROM python:3.7-slim (strips -slim suffix)', async () => {
    mockReadFile.mockImplementation(async (p: any) =>
      allMissingUntilDockerfile(p, 'FROM python:3.7-slim\n'),
    );
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.7');
  });

  it('returns version from FROM python:3.7.12-alpine3.18 (extracts 3.7.12 → 3.7)', async () => {
    mockReadFile.mockImplementation(async (p: any) =>
      allMissingUntilDockerfile(p, 'FROM python:3.7.12-alpine3.18\n'),
    );
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.7');
  });

  it('returns version from multi-stage FROM python:3.9 AS builder', async () => {
    mockReadFile.mockImplementation(async (p: any) =>
      allMissingUntilDockerfile(p, 'FROM python:3.9 AS builder\nFROM python:3.9-slim\n'),
    );
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.9');
  });
});

describe('pipPlugin.versionSources — Pipfile python_version', () => {
  beforeEach(() => vi.clearAllMocks());

  const allMissingUntilPipfile = async (p: any, pipfileContent: string) => {
    const s = String(p);
    if (s.endsWith('.python-version')) throw ENOENT;
    if (s.endsWith('.tool-versions')) throw ENOENT;
    if (s.endsWith('pyproject.toml')) throw ENOENT;
    if (s.endsWith('setup.cfg')) throw ENOENT;
    if (s.endsWith('runtime.txt')) throw ENOENT;
    if (s.endsWith('Dockerfile')) throw ENOENT;
    if (s.endsWith('Pipfile')) return pipfileContent;
    throw ENOENT;
  };

  it("returns version from Pipfile python_version = '3.7'", async () => {
    mockReadFile.mockImplementation(async (p: any) =>
      allMissingUntilPipfile(p, "[requires]\npython_version = '3.7'\n"),
    );
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.7');
  });

  it('returns version from Pipfile with double-quoted python_version', async () => {
    mockReadFile.mockImplementation(async (p: any) =>
      allMissingUntilPipfile(p, '[requires]\npython_version = "3.9"\n'),
    );
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.9');
  });
});

describe('pipPlugin.versionSources — precedence ordering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('.python-version wins over Dockerfile', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) return '3.12';
      if (String(p).endsWith('Dockerfile')) return 'FROM python:3.7\n';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.12');
  });

  it('Dockerfile (position 6) wins over Pipfile (position 7)', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      const s = String(p);
      if (s.endsWith('.python-version')) throw ENOENT;
      if (s.endsWith('.tool-versions')) throw ENOENT;
      if (s.endsWith('pyproject.toml')) throw ENOENT;
      if (s.endsWith('setup.cfg')) throw ENOENT;
      if (s.endsWith('runtime.txt')) throw ENOENT;
      if (s.endsWith('Dockerfile')) return 'FROM python:3.8\n';
      if (s.endsWith('Pipfile')) return "python_version = '3.7'\n";
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBe('3.8');
  });
});

describe('pipPlugin.versionSources — error handling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns undefined when all 7 files are missing (ENOENT)', async () => {
    mockReadFile.mockRejectedValue(ENOENT);
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBeUndefined();
  });

  it('returns undefined when files are present but unparseable', async () => {
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.python-version')) return 'not-a-version';
      if (String(p).endsWith('.tool-versions')) return 'nodejs 20\n';
      if (String(p).endsWith('pyproject.toml')) return '[build-system]\n';
      if (String(p).endsWith('setup.cfg')) return '[metadata]\nname = myapp\n';
      if (String(p).endsWith('runtime.txt')) return 'not-python-format';
      if (String(p).endsWith('Dockerfile')) return 'FROM ubuntu:22.04\n';
      if (String(p).endsWith('Pipfile')) return '[packages]\nrequests = "*"\n';
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', pipPlugin.versionSources!)).toBeUndefined();
  });
});

// ─── npm plugin — uncovered branch gaps ──────────────────────────────────────

describe('npmPlugin.versionSources — inferNodeVersion/parseEnginesNodeRange branch gaps', () => {
  beforeEach(() => vi.clearAllMocks());

  it('line 42: .nvmrc with non-numeric stripped value (e.g. "lts/iron") → undefined, falls through', async () => {
    // "lts/iron" strips "v"→ same; /^\d[\d.]*$/ fails → return undefined
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('.nvmrc')) return 'lts/iron';
      if (String(p).endsWith('.node-version')) throw ENOENT;
      if (String(p).endsWith('package.json')) return JSON.stringify({ engines: { node: '>=20' } });
      throw ENOENT;
    });
    // falls through to package.json engines
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBe('20');
  });

  it('line 77: parseEnginesNodeRange returns undefined when no digit in range (e.g. "latest")', async () => {
    // 'latest' has no digit → match is null → return undefined
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json')) return JSON.stringify({ engines: { node: 'latest' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBeUndefined();
  });

  it('line 84: parseEnginesNodeRange returns undefined when normalized version has non-numeric chars', async () => {
    // '>=20x' → match[1]='20x', no .x suffix to strip, fails /^\d[\d.]*$/ → undefined
    mockReadFile.mockImplementation(async (p: any) => {
      if (String(p).endsWith('package.json')) return JSON.stringify({ engines: { node: '>=20x' } });
      throw ENOENT;
    });
    expect(await inferVersionFromSources('/project', npmPlugin.versionSources!)).toBeUndefined();
  });
});
