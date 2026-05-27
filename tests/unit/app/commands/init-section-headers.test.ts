/**
 * Tests for visual UX improvements to the init command:
 * - Section headers emitted via process.stdout.write in interactive mode
 * - Sub-group dim labels (Validation, Advisors, Docker)
 * - Scanners / Output section headers
 * - Section headers suppressed in nonInteractive mode
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  access: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  mkdir: vi.fn(),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

// Treat all tests in this suite as interactive so the TTY guard never fires.
vi.mock('@infra/utils/tty', () => ({
  isCI: vi.fn(() => false),
  isInteractive: vi.fn(() => true),
  assertInteractive: vi.fn(),
}));

vi.mock('@infra/config/generator', () => ({
  generateConfigJson: vi.fn(() => '{"project":{"name":"demo"}}'),
  normalizeSonarProjectKey: vi.fn((name: string) => name.replace(/\s+/g, '-')),
}));

vi.mock('@infra/config/schema-export', () => ({
  generateJsonSchema: vi.fn(() => ({ type: 'object', properties: {} })),
}));

vi.mock('@infra/utils/prompt', () => ({
  prompt: vi.fn(),
}));

vi.mock('@infra/utils/inquirer-prompts', () => ({
  confirmPrompt: vi.fn(),
  selectPrompt: vi.fn(),
  checkboxPrompt: vi.fn(),
}));

vi.mock('@infra/utils/detect-ecosystems', () => ({
  discoverProject: vi.fn(),
}));

vi.mock('@infra/utils/detect-scripts', () => ({
  detectProjectScripts: vi.fn(),
}));

vi.mock('@app/commands/sonar-properties-template', () => ({
  writeSonarPropertiesTemplateIfMissing: vi.fn().mockResolvedValue('skipped'),
}));

vi.mock('@infra/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { prompt } from '@infra/utils/prompt';
import { confirmPrompt, selectPrompt, checkboxPrompt } from '@infra/utils/inquirer-prompts';
import { discoverProject } from '@infra/utils/detect-ecosystems';
import { detectProjectScripts } from '@infra/utils/detect-scripts';
import { runInitCommand } from '@app/commands/init';
import { dim } from '@infra/utils/ui';

const mockPrompt = vi.mocked(prompt);
const mockConfirm = vi.mocked(confirmPrompt);
const mockSelect = vi.mocked(selectPrompt);
const mockCheckbox = vi.mocked(checkboxPrompt);
const mockDiscoverProject = vi.mocked(discoverProject);
const mockDetectProjectScripts = vi.mocked(detectProjectScripts);

const npmRootDiscovery = {
  pluginId: 'npm',
  path: '',
  lockfile: 'package-lock.json',
  suggestedLabel: undefined,
};

const npmWebDiscovery = {
  pluginId: 'npm',
  path: 'web',
  lockfile: 'package-lock.json',
  suggestedLabel: 'web',
};

function setupInteractiveMocks() {
  mockDetectProjectScripts.mockResolvedValue([]);
  mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
    if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
    if (msg.includes('Image mode')) return 'pull';
    return choices[0]!.value;
  });
  mockConfirm.mockImplementation(async () => false);
  mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');
  mockCheckbox.mockImplementation(async (_msg: string, _choices: any[]) => []);
}

// ── Section headers in interactive mode ───────────────────────────────────────

describe('init command — section headers in interactive mode', () => {
  let stdoutWrites: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrites = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    setupInteractiveMocks();
  });

  it('emits a section header with plugin name before ecosystem prompts', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmRootDiscovery], dockerfiles: [] });
    mockCheckbox.mockResolvedValue(['0']);

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const combined = stdoutWrites.join('');
    // Should contain a header line with npm plugin name using box-drawing characters
    expect(combined).toMatch(/──.*npm.*──/);
  });

  it('includes the label in the section header when the ecosystem has a label', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmRootDiscovery, npmWebDiscovery],
      dockerfiles: [],
    });
    // Select both
    mockCheckbox.mockResolvedValueOnce(['0', '1']).mockResolvedValue([]);
    // Label prompts for duplicates
    mockPrompt.mockImplementation(async (q: string, def?: string) => {
      if (q.includes('Label')) return def ?? '';
      return def ?? '';
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const combined = stdoutWrites.join('');
    // One ecosystem has path 'web', so the header should include 'web'
    expect(combined).toMatch(/──.*npm.*\(web\).*──/);
  });

  it('emits dim Validation sub-group header in interactive mode', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmRootDiscovery], dockerfiles: [] });
    mockCheckbox.mockResolvedValue(['0']);

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const combined = stdoutWrites.join('');
    expect(combined).toContain(dim('  Validation'));
  });

  it('emits dim Advisors sub-group header in interactive mode', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmRootDiscovery], dockerfiles: [] });
    mockCheckbox.mockResolvedValue(['0']);

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const combined = stdoutWrites.join('');
    expect(combined).toContain(dim('  Advisors'));
  });

  it('emits a Scanners section header before the SonarQube prompt', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmRootDiscovery], dockerfiles: [] });
    mockCheckbox.mockResolvedValue(['0']);

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const combined = stdoutWrites.join('');
    expect(combined).toMatch(/──.*Scanners.*──/);
  });

  it('emits an Output section header before the markdown report prompt', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmRootDiscovery], dockerfiles: [] });
    mockCheckbox.mockResolvedValue(['0']);

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const combined = stdoutWrites.join('');
    expect(combined).toMatch(/──.*Output.*──/);
  });
});

// ── Section headers suppressed in non-interactive mode ────────────────────────

describe('init command — section headers suppressed in non-interactive mode', () => {
  let stdoutWrites: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrites = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    mockDetectProjectScripts.mockResolvedValue([]);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');
  });

  it('does NOT emit section headers or dim ANSI codes in nonInteractive mode', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmRootDiscovery], dockerfiles: [] });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const combined = stdoutWrites.join('');
    // Box-drawing section headers should NOT appear
    expect(combined).not.toMatch(/──.*npm.*──/);
    // Dim sub-group labels should NOT appear
    expect(combined).not.toContain(dim('  Validation'));
    expect(combined).not.toContain(dim('  Advisors'));
    // Scanners / Output headers should NOT appear
    expect(combined).not.toMatch(/──.*Scanners.*──/);
    expect(combined).not.toMatch(/──.*Output.*──/);
  });
});

// ── printSectionHeader format ─────────────────────────────────────────────────

describe('init command — printSectionHeader format', () => {
  let stdoutWrites: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrites = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    setupInteractiveMocks();
  });

  it('section header starts with a newline and uses box-drawing ─ characters', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmRootDiscovery], dockerfiles: [] });
    mockCheckbox.mockResolvedValue(['0']);

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const combined = stdoutWrites.join('');
    // Format: \n── <title> ─────\n\n
    expect(combined).toMatch(/\n──[^\n]+─+\n\n/);
  });

  it('section header line is approximately 54 characters wide', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmRootDiscovery], dockerfiles: [] });
    mockCheckbox.mockResolvedValue(['0']);

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const combined = stdoutWrites.join('');
    // Extract the npm section header line
    const match = combined.match(/\n(──[^\n]+)\n\n/);
    expect(match).toBeTruthy();
    const headerLine = match![1]!;
    // Should be close to 54 chars (allow for title length variation)
    expect(headerLine.length).toBeGreaterThanOrEqual(50);
    expect(headerLine.length).toBeLessThanOrEqual(60);
  });
});
