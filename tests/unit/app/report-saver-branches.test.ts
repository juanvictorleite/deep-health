import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@infra/storage/local', () => ({
  LocalStorageProvider: vi.fn().mockImplementation(function () { return {
    upload: vi.fn().mockResolvedValue({ url: '/local/report.md', id: 'report.md', provider: 'local' }),
  }; }),
}));

vi.mock('@reporting/sonarqube-export', () => ({
  buildSonarQubeExport: vi.fn().mockReturnValue(null),
  sonarQubeExportFilename: vi.fn().mockReturnValue('export.json'),
}));

import { saveReport, saveSonarQubeExport } from '@app/report-saver';
import { LocalStorageProvider } from '@infra/storage/local';

describe('saveReport() — local success', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes to stdout and returns localUrl on success', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const result = await saveReport('report.md', '# content', '/reports');

    expect(result.localUrl).toContain('/local/report.md');
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('/local/report.md'));
    stdoutSpy.mockRestore();
  });
});

describe('saveReport() — local failure is fatal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when local provider upload rejects with Error', async () => {
    vi.mocked(LocalStorageProvider).mockImplementation(function () { return {
      upload: vi.fn().mockRejectedValue(new Error('disk full')),
    }; });

    await expect(saveReport('report.md', '# content', '/reports')).rejects.toThrow('disk full');
  });

  it('throws with string cause when local provider upload rejects with non-Error', async () => {
    vi.mocked(LocalStorageProvider).mockImplementation(function () { return {
      upload: vi.fn().mockRejectedValue('string error'),
    }; });

    await expect(saveReport('report.md', '# content', '/reports')).rejects.toThrow('string error');
  });
});

describe('saveSonarQubeExport() — catch branch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs to stderr when saveReport throws inside saveSonarQubeExport', async () => {
    vi.mocked(LocalStorageProvider).mockImplementation(function () { return {
      upload: vi.fn().mockRejectedValue(new Error('disk full')),
    }; });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const { buildSonarQubeExport } = await import('@reporting/sonarqube-export');
    vi.mocked(buildSonarQubeExport).mockReturnValue({ engineResults: {} } as any);

    await expect(
      saveSonarQubeExport({}, 'proj', '2026-01-01', '/reports'),
    ).resolves.toBeUndefined();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('SonarQube export save failed'));
    stderrSpy.mockRestore();
  });

  it('returns early without saving when buildSonarQubeExport returns null', async () => {
    const { buildSonarQubeExport } = await import('@reporting/sonarqube-export');
    vi.mocked(buildSonarQubeExport).mockReturnValue(null);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await saveSonarQubeExport({}, 'proj', '2026-01-01', '/reports');
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});
