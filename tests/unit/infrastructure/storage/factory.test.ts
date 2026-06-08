import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStorageProvider } from '@infra/storage/factory';
import { LocalStorageProvider } from '@infra/storage/local';

describe('createStorageProvider()', () => {
  it('returns a LocalStorageProvider instance', () => {
    const provider = createStorageProvider('/tmp/reports');
    expect(provider).toBeInstanceOf(LocalStorageProvider);
  });

  it('returned provider writes uploads under outputDir', async () => {
    const outputDir = join(tmpdir(), `factory-test-${Date.now()}`);
    const provider = createStorageProvider(outputDir);
    const result = await provider.upload('report.md', '# content');
    expect(result.url).toContain(outputDir);
    expect(result.provider).toBe('local');
  });

  it('returned provider satisfies the StorageProvider interface (upload returns url, id, provider)', async () => {
    const outputDir = join(tmpdir(), `factory-test-iface-${Date.now()}`);
    const provider = createStorageProvider(outputDir);
    const result = await provider.upload('test.md', 'hello');
    expect(typeof result.url).toBe('string');
    expect(typeof result.id).toBe('string');
    expect(typeof result.provider).toBe('string');
  });

  it('upload writes the file with the given filename', async () => {
    const outputDir = join(tmpdir(), `factory-test-file-${Date.now()}`);
    const provider = createStorageProvider(outputDir);
    const result = await provider.upload('my-report.md', 'body');
    expect(result.id).toBe('my-report.md');
    expect(result.url).toContain('my-report.md');
  });

  it('upload works with Buffer content', async () => {
    const outputDir = join(tmpdir(), `factory-test-buf-${Date.now()}`);
    const provider = createStorageProvider(outputDir);
    const result = await provider.upload('binary.bin', Buffer.from('data'));
    expect(result.url).toContain('binary.bin');
  });
});
