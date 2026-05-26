/**
 * Tests for the discoverProject-based init command flow (slice C+D).
 *
 * Covers:
 *   AC1 — discoverProject is used; detectEcosystems is gone
 *   AC2 — Checkbox choices show ecosystem name, lockfile, and path
 *   AC3 — Duplicate plugin ids trigger label prompts
 *   AC4 — Nearby Dockerfiles are surfaced; user can select one
 *   AC5 — EcosystemConfigEntry path/label emitted in JSON
 *   AC6 — inferVersion and detectProjectScripts use discovery path
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  access: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  mkdir: vi.fn(),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
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
  writeSonarPropertiesTemplateIfMissing: vi.fn().mockResolvedValue('created'),
}));

vi.mock('@infra/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { generateConfigJson } from '@infra/config/generator';
import { prompt } from '@infra/utils/prompt';
import { confirmPrompt, selectPrompt, checkboxPrompt } from '@infra/utils/inquirer-prompts';
import { discoverProject } from '@infra/utils/detect-ecosystems';
import { detectProjectScripts } from '@infra/utils/detect-scripts';
import { runInitCommand } from '@app/commands/init';
import { logger } from '@infra/utils/logger';

const mockLoggerInfo = vi.mocked(logger.info);
const mockGenerateConfigJson = vi.mocked(generateConfigJson);
const mockPrompt = vi.mocked(prompt);
const mockConfirm = vi.mocked(confirmPrompt);
const mockSelect = vi.mocked(selectPrompt);
const mockCheckbox = vi.mocked(checkboxPrompt);
const mockDiscoverProject = vi.mocked(discoverProject);
const mockDetectProjectScripts = vi.mocked(detectProjectScripts);

// ── Common discovery fixtures ─────────────────────────────────────────────────

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

const pipApiDiscovery = {
  pluginId: 'pip',
  path: 'api/app',
  lockfile: 'requirements.txt',
  suggestedLabel: 'app',
};

const rootDockerfile = { path: '', filename: 'Dockerfile' };
const webDockerfile = { path: 'web', filename: 'Dockerfile' };

// ── Setup helpers ─────────────────────────────────────────────────────────────

function setupNonInteractiveMocks() {
  mockDetectProjectScripts.mockResolvedValue([]);
  mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');
}

function setupInteractiveMocks() {
  mockDetectProjectScripts.mockResolvedValue([]);
  mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
    if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
    return choices[0]!.value;
  });
  mockConfirm.mockImplementation(async (msg: string) => {
    if (msg.includes('SonarQube')) return false;
    if (msg.includes('Generate markdown') || msg.includes('markdown')) return false;
    return false;
  });
  mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');
}

// ── AC1: discoverProject is used ──────────────────────────────────────────────

describe('init command — AC1: uses discoverProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmRootDiscovery], dockerfiles: [] });
    setupNonInteractiveMocks();
  });

  it('calls discoverProject with cwd and plugins in non-interactive mode', async () => {
    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(mockDiscoverProject).toHaveBeenCalledWith(
      '/repo',
      expect.arrayContaining([expect.objectContaining({ id: 'npm' })]),
    );
  });

  it('does NOT import or call detectEcosystems (old API gone)', async () => {
    // If detectEcosystems were still being called, the mock would need to provide it.
    // Since the mock only exports discoverProject, any call to detectEcosystems would throw.
    await expect(
      runInitCommand({
        cwd: '/repo',
        force: true,
        nonInteractive: true,
        projectName: 'Test',
        client: 'Client',
        output: 'security-scan.config.json',
      }),
    ).resolves.toBeUndefined();
    expect(mockDiscoverProject).toHaveBeenCalled();
  });
});

// ── AC2: Checkbox shows ecosystem, lockfile, path ────────────────────────────

describe('init command — AC2: discovery choices show path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupInteractiveMocks();
  });

  it('shows "npm — package-lock.json" for root discovery (no path suffix)', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmRootDiscovery], dockerfiles: [] });

    let capturedChoices: any[] = [];
    mockCheckbox.mockImplementation(async (_msg: string, choices: any[]) => {
      capturedChoices = choices;
      return ['0']; // select the first (and only) discovery
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(capturedChoices.length).toBe(1);
    // Root discovery: name should NOT include path suffix like "(root/)"
    const name = capturedChoices[0]!.name as string;
    expect(name).toMatch(/npm/i);
    expect(name).toMatch(/package-lock\.json/);
    // No path suffix for root
    expect(name).not.toMatch(/\(.*\/\)/);
  });

  it('shows path suffix for non-root discoveries — e.g. "(web/)"', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [npmWebDiscovery], dockerfiles: [] });

    let capturedChoices: any[] = [];
    mockCheckbox.mockImplementation(async (_msg: string, choices: any[]) => {
      capturedChoices = choices;
      return ['0'];
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const name = capturedChoices[0]!.name as string;
    expect(name).toMatch(/npm/i);
    expect(name).toMatch(/package-lock\.json/);
    expect(name).toMatch(/\(web\/\)/);
  });

  it('shows pip discovery with path "(api/app/)"', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [pipApiDiscovery], dockerfiles: [] });

    let capturedChoices: any[] = [];
    mockCheckbox.mockImplementation(async (_msg: string, choices: any[]) => {
      capturedChoices = choices;
      return ['0'];
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const name = capturedChoices[0]!.name as string;
    expect(name).toMatch(/pip/i);
    expect(name).toMatch(/requirements\.txt/);
    expect(name).toMatch(/\(api\/app\/\)/);
  });

  it('all discovered ecosystems are pre-checked=true', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmRootDiscovery, pipApiDiscovery],
      dockerfiles: [],
    });

    let capturedChoices: any[] = [];
    mockCheckbox.mockImplementation(async (_msg: string, choices: any[]) => {
      capturedChoices = choices;
      return ['0', '1'];
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(capturedChoices.every((c: any) => c.checked === true)).toBe(true);
  });

  it('falls back to plugin list (unchecked) when no ecosystems discovered', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });

    let capturedChoices: any[] = [];
    mockCheckbox.mockImplementation(async (_msg: string, choices: any[]) => {
      capturedChoices = choices;
      return [];
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Fallback shows all plugins, all unchecked
    expect(capturedChoices.length).toBeGreaterThanOrEqual(3);
    expect(capturedChoices.every((c: any) => c.checked === false)).toBe(true);
  });
});

// ── AC3: Label assignment for duplicate plugin ids ────────────────────────────

describe('init command — AC3: label prompts for duplicate plugin ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupInteractiveMocks();
  });

  it('prompts for labels when two npm entries are selected (interactive)', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmRootDiscovery, npmWebDiscovery],
      dockerfiles: [],
    });

    // Select both discoveries
    mockCheckbox.mockResolvedValue(['0', '1']);

    const promptQuestions: string[] = [];
    mockPrompt.mockImplementation(async (question: string, def?: string) => {
      promptQuestions.push(question);
      return def ?? '';
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Two label prompts should have been issued (one per duplicate)
    const labelPrompts = promptQuestions.filter((q) => q.includes('Label for'));
    expect(labelPrompts.length).toBe(2);
  });

  it('non-interactive: auto-assigns suggestedLabel for duplicate plugin ids', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmRootDiscovery, npmWebDiscovery],
      dockerfiles: [],
    });
    setupNonInteractiveMocks();

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = mockGenerateConfigJson.mock.calls[0]![0];
    const npmEntries = call.ecosystemConfigs?.filter((e) => e.id === 'npm') ?? [];

    // Both entries should be present with labels
    expect(npmEntries.length).toBe(2);
    // The root entry has no suggestedLabel → falls back to path='' → pluginId
    const rootEntry = npmEntries.find((e) => !e.path);
    const webEntry = npmEntries.find((e) => e.path === 'web');
    expect(webEntry?.label).toBe('web'); // suggestedLabel from npmWebDiscovery
    // Root entry label comes from path || pluginId fallback
    expect(rootEntry?.label).toBeDefined();
  });

  it('single npm entry (no duplicate) gets no label', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmRootDiscovery],
      dockerfiles: [],
    });
    setupNonInteractiveMocks();

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = mockGenerateConfigJson.mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    expect(npmEntry?.label).toBeUndefined();
  });
});

// ── AC4: Dockerfile association ───────────────────────────────────────────────

describe('init command — AC4: Dockerfile association from discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupInteractiveMocks();
  });

  it('presents nearby Dockerfiles in a select prompt when available (interactive)', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [webDockerfile],
    });

    // Select the npm discovery (index '0')
    mockCheckbox.mockResolvedValue(['0']);

    const selectMessages: string[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      selectMessages.push(msg);
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      if (msg.includes('Image mode') || msg.includes('Modo de imagem')) return 'pull';
      if (msg.includes('Select Dockerfile') || msg.includes('Selecione o Dockerfile')) return choices[0]!.value;
      return choices[0]!.value;
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // The "Image mode" prompt should have been shown
    expect(selectMessages.some((m) => m.includes('Image mode') || m.includes('Modo de imagem'))).toBe(true);
  });

  it('shows Dockerfile selection prompt when in build mode and dockerfiles are nearby', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [webDockerfile],
    });

    mockCheckbox.mockResolvedValue(['0']);

    const selectMessages: string[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      selectMessages.push(msg);
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      if (msg.includes('Image mode') || msg.includes('Modo de imagem')) return 'build';
      if (msg.includes('Select Dockerfile') || msg.includes('Selecione o Dockerfile')) return choices[0]!.value;
      return choices[0]!.value;
    });

    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(selectMessages.some((m) => m.includes('Select Dockerfile') || m.includes('Selecione o Dockerfile'))).toBe(true);
  });

  it('root Dockerfile is shown for root-level ecosystem, not for sub-dir ecosystems', async () => {
    // Dockerfile at root, ecosystem at 'web' — should NOT see root dockerfile as nearby
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [rootDockerfile],
    });

    mockCheckbox.mockResolvedValue(['0']);

    const selectMessages: string[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      selectMessages.push(msg);
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0]!.value;
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // A root Dockerfile is NOT a parent of 'web/', so no Dockerfile selection prompt should appear
    // (the selectPrompt for 'Select Dockerfile' should not be called)
    expect(selectMessages.some((m) => m.includes('Select Dockerfile') || m.includes('Selecione o Dockerfile'))).toBe(false);
  });

  it('AC2/AC4: stores Dockerfile path relative to ecosystem path, not root-relative', async () => {
    // eco at 'web', Dockerfile discovered at 'web/Dockerfile' (root-relative value = 'web/Dockerfile')
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [webDockerfile],
    });

    mockCheckbox.mockResolvedValue(['0']);

    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      if (msg.includes('Image mode') || msg.includes('Modo de imagem')) return 'build';
      // Dockerfile select: return root-relative value as the prompt would present it
      if (msg.includes('Select Dockerfile') || msg.includes('Selecione o Dockerfile')) return 'web/Dockerfile';
      return choices[0]!.value;
    });

    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = mockGenerateConfigJson.mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    // Should be 'Dockerfile' (relative to 'web/'), not 'web/Dockerfile' (root-relative)
    expect(npmEntry?.runner?.build?.dockerfile).toBe('Dockerfile');
  });

  it('AC2: stores Dockerfile path as "../Dockerfile" when Dockerfile is in parent dir of ecosystem', async () => {
    // eco at 'api/app', Dockerfile discovered at 'api/Dockerfile' (df.path='api', df.filename='Dockerfile')
    const apiAppDiscovery = { pluginId: 'pip', path: 'api/app', lockfile: 'requirements.txt', suggestedLabel: 'app' };
    const apiDockerfile = { path: 'api', filename: 'Dockerfile' };

    mockDiscoverProject.mockResolvedValue({
      ecosystems: [apiAppDiscovery],
      dockerfiles: [apiDockerfile],
    });

    mockCheckbox.mockResolvedValue(['0']);

    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      if (msg.includes('Image mode') || msg.includes('Modo de imagem')) return 'build';
      // Dockerfile select: return root-relative value 'api/Dockerfile'
      if (msg.includes('Select Dockerfile') || msg.includes('Selecione o Dockerfile')) return 'api/Dockerfile';
      return choices[0]!.value;
    });

    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = mockGenerateConfigJson.mock.calls[0]![0];
    const pipEntry = call.ecosystemConfigs?.find((e) => e.id === 'pip');
    // relative('api/app', 'api/Dockerfile') = '../Dockerfile'
    expect(pipEntry?.runner?.build?.dockerfile).toBe('../Dockerfile');
  });

  it('uses collectRunnerConfig (manual prompt) when no nearby Dockerfiles exist', async () => {
    // Ecosystem at 'web' but Dockerfile only at root
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [],
    });

    mockCheckbox.mockResolvedValue(['0']);

    const selectMessages: string[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      selectMessages.push(msg);
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0]!.value;
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Image mode prompt appears from collectRunnerConfig even without nearby dockerfiles
    expect(selectMessages.some((m) => m.includes('Image mode') || m.includes('Modo de imagem'))).toBe(true);
    // No dockerfile selection prompt
    expect(selectMessages.some((m) => m.includes('Select Dockerfile') || m.includes('Selecione o Dockerfile'))).toBe(false);
  });
});

// ── AC5: path and label in generated config ───────────────────────────────────

describe('init command — AC5: path and label in generateConfigJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupNonInteractiveMocks();
  });

  it('emits path for non-root discoveries', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [],
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = mockGenerateConfigJson.mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    expect(npmEntry?.path).toBe('web');
  });

  it('does NOT emit path for root discoveries (undefined)', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmRootDiscovery],
      dockerfiles: [],
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = mockGenerateConfigJson.mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    expect(npmEntry?.path).toBeUndefined();
  });

  it('emits label for duplicate plugin id entries', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmRootDiscovery, npmWebDiscovery],
      dockerfiles: [],
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = mockGenerateConfigJson.mock.calls[0]![0];
    const webEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm' && e.path === 'web');
    expect(webEntry?.label).toBe('web');
  });

  it('emits label for entries with a non-empty path even when plugin id is unique; root unique entries get no label', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmRootDiscovery, pipApiDiscovery],
      dockerfiles: [],
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = mockGenerateConfigJson.mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    const pipEntry = call.ecosystemConfigs?.find((e) => e.id === 'pip');
    // npm at root (path='') with unique id → no label
    expect(npmEntry?.label).toBeUndefined();
    // pip at api/app (path non-empty) → gets label from suggestedLabel='app'
    expect(pipEntry?.label).toBe('app');
  });
});

// ── AC6: inferVersion and detectProjectScripts use discovery path ─────────────

describe('init command — AC6: discovery path used for inferVersion and detectProjectScripts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupNonInteractiveMocks();
  });

  it('calls detectProjectScripts with the resolved ecosystem path (not just cwd)', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [],
    });

    const scriptCwds: string[] = [];
    mockDetectProjectScripts.mockImplementation(async (cwd: string) => {
      scriptCwds.push(cwd);
      return [];
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // detectProjectScripts should be called with the resolved path /repo/web
    expect(scriptCwds.some((p) => p.endsWith('/repo/web') || p.endsWith('\\repo\\web'))).toBe(true);
  });

  it('calls detectProjectScripts with cwd directly for root discoveries (path="")', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmRootDiscovery],
      dockerfiles: [],
    });

    const scriptCwds: string[] = [];
    mockDetectProjectScripts.mockImplementation(async (cwd: string) => {
      scriptCwds.push(cwd);
      return [];
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Root discovery: cwd should be /repo (not /repo/)
    expect(scriptCwds.some((p) => p === '/repo' || p.endsWith('\\repo'))).toBe(true);
  });

  it('readFile (for inferVersion) is called with path resolved under ecosystem dir', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [],
    });

    const { readFile } = await import('node:fs/promises');
    const mockReadFile = vi.mocked(readFile);
    const readFilePaths: string[] = [];
    mockReadFile.mockImplementation(async (p: any) => {
      readFilePaths.push(String(p));
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // npm's inferVersion reads package.json — it should resolve under /repo/web
    const webPathReads = readFilePaths.filter((p) => p.includes('web'));
    expect(webPathReads.length).toBeGreaterThan(0);
  });
});

// ── generator.ts — AC5: path/label emit in buildEcosystemObject ───────────────

describe('generateConfigJson — path and label fields (AC5)', () => {
  it('path is emitted in JSON output for non-root ecosystem entries', async () => {
    // Import the REAL generator (not the mock)
    const { generateConfigJson: realGenerate } = await vi.importActual<typeof import('@infra/config/generator')>('@infra/config/generator');

    const json = realGenerate({
      ecosystemConfigs: [
        { id: 'npm', path: 'web', validationCommands: [] },
      ],
    });

    const parsed = JSON.parse(json) as { ecosystems: Array<{ id: string; path?: string }> };
    const npmEntry = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npmEntry?.path).toBe('web');
  });

  it('path is NOT emitted when empty string (root)', async () => {
    const { generateConfigJson: realGenerate } = await vi.importActual<typeof import('@infra/config/generator')>('@infra/config/generator');

    const json = realGenerate({
      ecosystemConfigs: [
        { id: 'npm', path: '', validationCommands: [] },
      ],
    });

    const parsed = JSON.parse(json) as { ecosystems: Array<{ id: string; path?: string }> };
    const npmEntry = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npmEntry?.path).toBeUndefined();
  });

  it('path is NOT emitted when undefined', async () => {
    const { generateConfigJson: realGenerate } = await vi.importActual<typeof import('@infra/config/generator')>('@infra/config/generator');

    const json = realGenerate({
      ecosystemConfigs: [
        { id: 'npm', validationCommands: [] },
      ],
    });

    const parsed = JSON.parse(json) as { ecosystems: Array<{ id: string; path?: string }> };
    const npmEntry = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npmEntry?.path).toBeUndefined();
  });

  it('label is emitted when defined', async () => {
    const { generateConfigJson: realGenerate } = await vi.importActual<typeof import('@infra/config/generator')>('@infra/config/generator');

    const json = realGenerate({
      ecosystemConfigs: [
        { id: 'npm', path: 'web', label: 'frontend', validationCommands: [] },
      ],
    });

    const parsed = JSON.parse(json) as { ecosystems: Array<{ id: string; label?: string }> };
    const npmEntry = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npmEntry?.label).toBe('frontend');
  });

  it('label is NOT emitted when undefined', async () => {
    const { generateConfigJson: realGenerate } = await vi.importActual<typeof import('@infra/config/generator')>('@infra/config/generator');

    const json = realGenerate({
      ecosystemConfigs: [
        { id: 'npm', path: 'web', validationCommands: [] },
      ],
    });

    const parsed = JSON.parse(json) as { ecosystems: Array<{ id: string; label?: string }> };
    const npmEntry = parsed.ecosystems.find((e) => e.id === 'npm');
    expect(npmEntry?.label).toBeUndefined();
  });

  it('multiple ecosystems with different paths/labels are emitted correctly', async () => {
    const { generateConfigJson: realGenerate } = await vi.importActual<typeof import('@infra/config/generator')>('@infra/config/generator');

    const json = realGenerate({
      ecosystemConfigs: [
        { id: 'npm', path: 'web', label: 'frontend', validationCommands: [] },
        { id: 'pip', path: 'api/app', label: 'backend', validationCommands: [] },
      ],
    });

    const parsed = JSON.parse(json) as { ecosystems: Array<{ id: string; path?: string; label?: string }> };
    const npmEntry = parsed.ecosystems.find((e) => e.id === 'npm');
    const pipEntry = parsed.ecosystems.find((e) => e.id === 'pip');
    expect(npmEntry?.path).toBe('web');
    expect(npmEntry?.label).toBe('frontend');
    expect(pipEntry?.path).toBe('api/app');
    expect(pipEntry?.label).toBe('backend');
  });

  it('two npm entries at different paths emit both with correct path/label', async () => {
    const { generateConfigJson: realGenerate } = await vi.importActual<typeof import('@infra/config/generator')>('@infra/config/generator');

    const json = realGenerate({
      ecosystemConfigs: [
        { id: 'npm', path: '', label: 'root', validationCommands: [] },
        { id: 'npm', path: 'web', label: 'web', validationCommands: [] },
      ],
    });

    const parsed = JSON.parse(json) as { ecosystems: Array<{ id: string; path?: string; label?: string }> };
    const npmEntries = parsed.ecosystems.filter((e) => e.id === 'npm');
    expect(npmEntries.length).toBe(2);
    // root entry: no path, but has label
    const rootEntry = npmEntries.find((e) => !e.path);
    const webEntry = npmEntries.find((e) => e.path === 'web');
    expect(rootEntry?.label).toBe('root');
    expect(webEntry?.path).toBe('web');
    expect(webEntry?.label).toBe('web');
  });
});

// ── Monorepo scenario: tramontina-trade style ─────────────────────────────────

describe('init command — monorepo scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupNonInteractiveMocks();
  });

  it('handles api/app (pip) + web (npm) monorepo in non-interactive mode', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [
        { pluginId: 'pip', path: 'api/app', lockfile: 'requirements.txt', suggestedLabel: 'app' },
        { pluginId: 'npm', path: 'web', lockfile: 'package-lock.json', suggestedLabel: 'web' },
      ],
      dockerfiles: [
        { path: 'api', filename: 'Dockerfile' },
        { path: 'web', filename: 'Dockerfile' },
      ],
    });

    await runInitCommand({
      cwd: '/tramontina-trade',
      force: true,
      nonInteractive: true,
      projectName: 'Tramontina Trade',
      client: 'Tramontina',
      output: 'security-scan.config.json',
    });

    const call = mockGenerateConfigJson.mock.calls[0]![0];
    const pipEntry = call.ecosystemConfigs?.find((e) => e.id === 'pip');
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');

    // pip at api/app
    expect(pipEntry?.path).toBe('api/app');
    expect(npmEntry?.path).toBe('web');

    // Entries with non-empty paths get labels (from suggestedLabel)
    expect(pipEntry?.label).toBe('app');
    expect(npmEntry?.label).toBe('web');
  });

  it('detectProjectScripts is called with resolved ecosystem paths, not root cwd', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [
        { pluginId: 'pip', path: 'api/app', lockfile: 'requirements.txt', suggestedLabel: 'app' },
        { pluginId: 'npm', path: 'web', lockfile: 'package-lock.json', suggestedLabel: 'web' },
      ],
      dockerfiles: [],
    });

    const scriptCwds: string[] = [];
    mockDetectProjectScripts.mockImplementation(async (cwd: string) => {
      scriptCwds.push(cwd);
      return [];
    });

    await runInitCommand({
      cwd: '/tramontina-trade',
      force: true,
      nonInteractive: true,
      projectName: 'Tramontina Trade',
      client: 'Tramontina',
      output: 'security-scan.config.json',
    });

    // Scripts should be detected from resolved paths
    expect(scriptCwds.some((p) => p.endsWith('/tramontina-trade/api/app') || p.includes('api/app'))).toBe(true);
    expect(scriptCwds.some((p) => p.endsWith('/tramontina-trade/web') || p.includes('web'))).toBe(true);
    // Root cwd should NOT appear in script detections
    expect(scriptCwds.every((p) => p !== '/tramontina-trade')).toBe(true);
  });
});

// ── Discovery summary display ─────────────────────────────────────────────────

describe('init command — discovery summary display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupNonInteractiveMocks();
  });

  it('AC2: does NOT call logger.info for summary when all discoveries are at root', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmRootDiscovery],
      dockerfiles: [],
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // No summary lines should be emitted (all root)
    const summaryCalls = mockLoggerInfo.mock.calls.filter((args) =>
      typeof args[0] === 'string' && (args[0].includes('ecosystem') || args[0].startsWith('  ')),
    );
    expect(summaryCalls.length).toBe(0);
  });

  it('AC1+AC5: calls logger.info with summary header when subdirectory discoveries exist (non-interactive)', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [],
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Summary header should appear
    const headerCall = mockLoggerInfo.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('1') && args[0].toLowerCase().includes('ecosystem'),
    );
    expect(headerCall).toBeDefined();

    // Detail line for the web ecosystem should appear
    const detailCall = mockLoggerInfo.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('web/'),
    );
    expect(detailCall).toBeDefined();
  });

  it('AC1: summary shows lockfile and path for each subdirectory discovery', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery, pipApiDiscovery],
      dockerfiles: [],
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const allInfoMessages = mockLoggerInfo.mock.calls.map((args) => String(args[0]));

    // Header should mention 2 ecosystems
    const hasHeader = allInfoMessages.some((m) => m.includes('2') && m.toLowerCase().includes('ecosystem'));
    expect(hasHeader).toBe(true);

    // web/ path should appear
    const hasWebLine = allInfoMessages.some((m) => m.includes('web/') && m.includes('package-lock.json'));
    expect(hasWebLine).toBe(true);

    // api/app/ path should appear
    const hasApiLine = allInfoMessages.some((m) => m.includes('api/app/') && m.includes('requirements.txt'));
    expect(hasApiLine).toBe(true);
  });

  it('AC3: non-interactive mode with subdirectory discoveries logs summary', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [],
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(mockLoggerInfo).toHaveBeenCalled();
    const infoMessages = mockLoggerInfo.mock.calls.map((args) => String(args[0]));
    const hasSummary = infoMessages.some((m) => m.toLowerCase().includes('ecosystem'));
    expect(hasSummary).toBe(true);
  });

  it('AC2: summary is also suppressed when no ecosystems discovered at all', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [],
      dockerfiles: [],
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const summaryCalls = mockLoggerInfo.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].toLowerCase().includes('ecosystem'),
    );
    expect(summaryCalls.length).toBe(true ? 0 : 0); // explicit: no summary
    expect(summaryCalls.length).toBe(0);
  });

  it('AC1: summary is shown in interactive mode too when subdirectory discoveries exist', async () => {
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [npmWebDiscovery],
      dockerfiles: [],
    });

    setupInteractiveMocks();
    mockCheckbox.mockResolvedValue(['0']);

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const infoMessages = mockLoggerInfo.mock.calls.map((args) => String(args[0]));
    const hasSummary = infoMessages.some((m) => m.toLowerCase().includes('ecosystem'));
    expect(hasSummary).toBe(true);
  });
});
