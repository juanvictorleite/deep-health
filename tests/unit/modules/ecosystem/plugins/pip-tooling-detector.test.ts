import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

vi.mock('@infra/utils/infer-version', () => ({
  readTextFile: vi.fn(),
}));

vi.mock('@modules/ecosystem/plugins/pip-dep-graph', () => ({
  hasViaAnnotations: vi.fn(),
}));

import { access } from 'node:fs/promises';
import { readTextFile } from '@infra/utils/infer-version';
import { hasViaAnnotations } from '@modules/ecosystem/plugins/pip-dep-graph';
import { detectPipTooling } from '@modules/ecosystem/plugins/pip-tooling-detector';

const mockedAccess = access as unknown as ReturnType<typeof vi.fn>;
const mockedReadTextFile = readTextFile as unknown as ReturnType<typeof vi.fn>;
const mockedHasViaAnnotations = hasViaAnnotations as unknown as ReturnType<typeof vi.fn>;

const CWD = '/project/python-app';

function makeAccessMock(existingFiles: string[]) {
  return (path: string) => {
    if (existingFiles.some((f) => path.endsWith(f) || path === f)) {
      return Promise.resolve();
    }
    return Promise.reject(new Error('ENOENT'));
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedHasViaAnnotations.mockReturnValue(false);
  mockedReadTextFile.mockResolvedValue(undefined);
});

describe('detectPipTooling — AC1 + AC5: Tier 1 lockfile detection', () => {
  it('detects uv (uv.lock) as Tier 1', async () => {
    mockedAccess.mockImplementation(makeAccessMock(['uv.lock', 'requirements.txt']));
    const result = await detectPipTooling(CWD);
    expect(result.tier).toBe(1);
    expect(result.tooling).toBe('uv');
    expect(result.lockfile).toContain('uv.lock');
    expect(result.manifest).toContain('requirements.txt');
  });

  it('detects poetry (poetry.lock) as Tier 1', async () => {
    mockedAccess.mockImplementation(makeAccessMock(['poetry.lock', 'requirements.txt']));
    const result = await detectPipTooling(CWD);
    expect(result.tier).toBe(1);
    expect(result.tooling).toBe('poetry');
    expect(result.lockfile).toContain('poetry.lock');
  });

  it('detects pipenv (Pipfile.lock) as Tier 1', async () => {
    mockedAccess.mockImplementation(makeAccessMock(['Pipfile.lock', 'requirements.txt']));
    const result = await detectPipTooling(CWD);
    expect(result.tier).toBe(1);
    expect(result.tooling).toBe('pipenv');
    expect(result.lockfile).toContain('Pipfile.lock');
  });

  it('detects pdm (pdm.lock) as Tier 1', async () => {
    mockedAccess.mockImplementation(makeAccessMock(['pdm.lock', 'requirements.txt']));
    const result = await detectPipTooling(CWD);
    expect(result.tier).toBe(1);
    expect(result.tooling).toBe('pdm');
    expect(result.lockfile).toContain('pdm.lock');
  });

  it('uv.lock takes precedence over poetry.lock when both present', async () => {
    mockedAccess.mockImplementation(makeAccessMock(['uv.lock', 'poetry.lock', 'requirements.txt']));
    const result = await detectPipTooling(CWD);
    expect(result.tooling).toBe('uv');
  });
});

describe('detectPipTooling — AC1 + AC5: Tier 2 pip-tools detection', () => {
  it('detects pip-tools when requirements.in exists and requirements.txt has via annotations', async () => {
    mockedAccess.mockImplementation(makeAccessMock(['requirements.in', 'requirements.txt']));
    mockedReadTextFile.mockResolvedValue('django==3.0.8\n    # via -r requirements.in\n');
    mockedHasViaAnnotations.mockReturnValue(true);
    const result = await detectPipTooling(CWD);
    expect(result.tier).toBe(2);
    expect(result.tooling).toBe('pip-tools');
    expect(result.lockfile).toBeUndefined();
    expect(result.manifest).toContain('requirements.txt');
  });

  it('falls through to Tier 3 when requirements.in exists but no via annotations', async () => {
    mockedAccess.mockImplementation(makeAccessMock(['requirements.in', 'requirements.txt']));
    mockedReadTextFile.mockResolvedValue('django==3.0.8\n');
    mockedHasViaAnnotations.mockReturnValue(false);
    const result = await detectPipTooling(CWD);
    expect(result.tier).toBe(3);
    expect(result.tooling).toBe('bare-pip');
  });

  it('falls through to Tier 3 when requirements.in does not exist', async () => {
    mockedAccess.mockImplementation(makeAccessMock(['requirements.txt']));
    const result = await detectPipTooling(CWD);
    expect(result.tier).toBe(3);
    expect(result.tooling).toBe('bare-pip');
  });
});

describe('detectPipTooling — AC1 + AC5: Tier 3 bare-pip detection', () => {
  it('detects bare-pip when only requirements.txt exists', async () => {
    mockedAccess.mockImplementation(makeAccessMock(['requirements.txt']));
    const result = await detectPipTooling(CWD);
    expect(result.tier).toBe(3);
    expect(result.tooling).toBe('bare-pip');
    expect(result.lockfile).toBeUndefined();
    expect(result.manifest).toContain('requirements.txt');
  });
});

describe('detectPipTooling — AC5: error when no requirements.txt', () => {
  it('throws when requirements.txt does not exist', async () => {
    mockedAccess.mockRejectedValue(new Error('ENOENT'));
    await expect(detectPipTooling(CWD)).rejects.toThrow(/requirements\.txt/);
  });
});
