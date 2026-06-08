import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@infra/storage/local', () => ({
  LocalStorageProvider: vi.fn().mockImplementation(function () { return {
    upload: vi.fn().mockResolvedValue({ url: '/local/report.md', id: 'report.md', provider: 'local' }),
  }; }),
}));

import { saveReport } from '@app/report-saver';
import { LocalStorageProvider } from '@infra/storage/local';

describe('saveReport — SaveReportOutcome semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(LocalStorageProvider).mockImplementation(function () { return {
      upload: vi.fn().mockResolvedValue({ url: '/local/report.md', id: 'report.md', provider: 'local' }),
    }; });
  });

  it('returns localUrl pointing to the written file on success', async () => {
    const outcome = await saveReport('report.md', '# report', '/tmp/reports');
    expect(outcome.localUrl).toBe('/local/report.md');
  });

  it('returns localUrl for buffer content', async () => {
    const outcome = await saveReport('report.md', Buffer.from('data'), '/tmp/reports');
    expect(outcome.localUrl).toBe('/local/report.md');
  });

  it('throws when local write fails', async () => {
    vi.mocked(LocalStorageProvider).mockImplementation(function () { return {
      upload: vi.fn().mockRejectedValue(new Error('disk full')),
    }; });

    await expect(saveReport('report.md', '# report', '/tmp/reports')).rejects.toThrow(
      /Failed to save report locally/,
    );
  });

  it('wraps non-Error throws with message', async () => {
    vi.mocked(LocalStorageProvider).mockImplementation(function () { return {
      upload: vi.fn().mockRejectedValue('raw string error'),
    }; });

    await expect(saveReport('report.md', '# report', '/tmp/reports')).rejects.toThrow(
      /raw string error/,
    );
  });
});
