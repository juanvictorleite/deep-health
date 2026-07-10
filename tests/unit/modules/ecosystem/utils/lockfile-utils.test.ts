/**
 * Dedicated unit tests for readNpmLockfileVersion — previously only exercised
 * indirectly through npm.test.ts's mocked import.
 */
import { readFile } from 'node:fs/promises';

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

import { readNpmLockfileVersion } from '@modules/ecosystem/utils/lockfile-utils';

describe('readNpmLockfileVersion', () => {
  const mockedReadFile = vi.mocked(readFile);

  beforeEach(() => {
    mockedReadFile.mockReset();
  });

  it('returns the numeric lockfileVersion for a valid package-lock.json', async () => {
    mockedReadFile.mockResolvedValue(JSON.stringify({ name: 'sample', lockfileVersion: 3 }));

    await expect(readNpmLockfileVersion('/project')).resolves.toBe(3);
    expect(mockedReadFile).toHaveBeenCalledWith('/project/package-lock.json', 'utf-8');
  });

  it.each([
    ['the file cannot be read (missing or unreadable)', () => mockedReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))],
    ['the file content is not valid JSON', () => mockedReadFile.mockResolvedValue('NOT JSON {{{')],
    ['the parsed root is an array', () => mockedReadFile.mockResolvedValue(JSON.stringify([1, 2, 3]))],
    ['the parsed root is a non-object primitive', () => mockedReadFile.mockResolvedValue(JSON.stringify('just a string'))],
    ['the parsed root is null', () => mockedReadFile.mockResolvedValue('null')],
    ['lockfileVersion is absent', () => mockedReadFile.mockResolvedValue(JSON.stringify({ name: 'sample' }))],
    ['lockfileVersion is a non-numeric value', () => mockedReadFile.mockResolvedValue(JSON.stringify({ lockfileVersion: '2' }))],
  ])('returns null when %s', async (_label, arrange) => {
    arrange();

    await expect(readNpmLockfileVersion('/project')).resolves.toBeNull();
  });

  it('never throws even when readFile rejects with a non-ENOENT error', async () => {
    mockedReadFile.mockRejectedValue(new Error('EACCES: permission denied'));

    await expect(readNpmLockfileVersion('/project')).resolves.toBeNull();
  });
});
