import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  access: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  mkdir: vi.fn(),
  // plugins call readFile for inferVersion; return ENOENT so inference yields undefined
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

import { writeFile, mkdir, access } from 'node:fs/promises';
import { generateConfigJson } from '@infra/config/generator';
import { generateJsonSchema } from '@infra/config/schema-export';
import { prompt } from '@infra/utils/prompt';
import { confirmPrompt, selectPrompt, checkboxPrompt } from '@infra/utils/inquirer-prompts';
import { discoverProject } from '@infra/utils/detect-ecosystems';
import { detectProjectScripts } from '@infra/utils/detect-scripts';
import { runInitCommand } from '@app/commands/init';
import { ConfigLoadError } from '@core/errors';

const mockPrompt = vi.mocked(prompt);
const mockAccess = vi.mocked(access);
const mockConfirm = vi.mocked(confirmPrompt);
const mockSelect = vi.mocked(selectPrompt);
const mockCheckbox = vi.mocked(checkboxPrompt);
const mockDiscoverProject = vi.mocked(discoverProject);
const mockDetectProjectScripts = vi.mocked(detectProjectScripts);

// ─── Non-interactive mode ─────────────────────────────────────────────────────

describe('runInitCommand — non-interactive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no ecosystems detected → fallback to all (preserves pre-detection behavior)
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });
    // Default: no scripts detected → use plugin defaults
    mockDetectProjectScripts.mockResolvedValue([]);
  });

  it('generates declarative config via ecosystemConfigs in non-interactive mode', async () => {
    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'My Project',
      client: 'My Client',
      output: 'security-scan.config.json',
    });

    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystemConfigs: expect.arrayContaining([
          expect.objectContaining({ id: 'composer' }),
          expect.objectContaining({ id: 'npm' }),
        ]),
        outputs: { formats: ['markdown'], dir: '.security-scan/reports' },
      }),
    );

    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
  });

  it('passes inferred version from plugin.inferVersion in non-interactive mode', async () => {
    const { readFile } = await import('node:fs/promises');
    const mockReadFile = vi.mocked(readFile);

    // npm: .nvmrc and .node-version absent → falls through to package.json
    // composer: .php-version absent → falls through to composer.json (also absent)
    mockReadFile.mockImplementation(async (path: any) => {
      const p = String(path);
      if (p.endsWith('package.json')) {
        return JSON.stringify({ engines: { node: '>=20' } }) as any;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Versioned Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystemConfigs: expect.arrayContaining([
          // npm ecosystem entry should have runner.language_version set
          expect.objectContaining({
            id: 'npm',
            runner: expect.objectContaining({ language_version: '20' }),
          }),
          expect.objectContaining({ id: 'composer' }),
        ]),
      }),
    );
    // Verify version is on the npm ecosystem entry's runner, not as a top-level version field
    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    expect(npmEntry?.runner?.language_version).toBe('20');
    expect((npmEntry as any)?.version).toBeUndefined();
  });

  it('passes inferred composer PHP version as runner.language_version in non-interactive mode', async () => {
    const { readFile } = await import('node:fs/promises');
    const mockReadFile = vi.mocked(readFile);

    mockReadFile.mockImplementation(async (path: any) => {
      const p = String(path);
      if (p.endsWith('package.json')) {
        return JSON.stringify({ engines: { node: '>=20' } }) as any;
      }
      if (p.endsWith('composer.json')) {
        return JSON.stringify({ require: { php: '^8.2' } }) as any;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'PHP Versioned Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystemConfigs: expect.arrayContaining([
          expect.objectContaining({
            id: 'composer',
            runner: expect.objectContaining({ language_version: '8.2' }),
          }),
        ]),
      }),
    );
  });
});

// ─── Interactive mode ─────────────────────────────────────────────────────────

describe('runInitCommand — interactive version prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no ecosystems detected → nothing pre-selected (checkboxPrompt mock controls selection)
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });
    // Default: no scripts detected → fall back to confirm flow
    mockDetectProjectScripts.mockResolvedValue([]);
  });

  it('shows inferred version as default and uses it when user accepts', async () => {
    const { readFile } = await import('node:fs/promises');
    const mockReadFile = vi.mocked(readFile);

    // npm: infer "20" from package.json; composer: nothing
    mockReadFile.mockImplementation(async (p: any) => {
      const path = String(p);
      if (path.endsWith('package.json'))
        return JSON.stringify({ engines: { node: '>=20' } }) as any;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    // checkboxPrompt: select all ecosystems
    mockCheckbox.mockResolvedValue(['npm', 'composer']);
    // selectPrompt: return 'en' for language prompt; first choice for everything else
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    // confirmPrompt: skip validation/advisors; no sonarqube; yes markdown
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return false;
      if (msg.includes('Generate markdown') || msg.includes('markdown')) return true;
      return false; // skip validation commands and advisors
    });

    // prompt: accept defaults for version and free-text
    mockPrompt.mockImplementation(async (_question: string, defaultValue?: string) => {
      return defaultValue ?? '';
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Interactive Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystemConfigs: expect.arrayContaining([
          expect.objectContaining({
            id: 'npm',
            runner: expect.objectContaining({ language_version: '20' }),
          }),
        ]),
      }),
    );
    // Verify version is on runner, not on the npm ecosystem entry directly
    const npmEntryCheck = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEcoEntry = npmEntryCheck.ecosystemConfigs?.find((e) => e.id === 'npm');
    expect(npmEcoEntry?.runner?.language_version).toBe('20');
    expect((npmEcoEntry as any)?.version).toBeUndefined();

    // Verify that the version prompt for npm was called with the inferred value as default
    const npmVersionPromptCall = mockPrompt.mock.calls.find(
      ([q]: [string, ...unknown[]]) =>
        typeof q === 'string' && q.includes('Language version') && q.includes('inferred: 20'),
    );
    expect(npmVersionPromptCall).toBeDefined();
  });

  it('omits version when user responds with blank to the version prompt', async () => {
    const { readFile } = await import('node:fs/promises');
    const mockReadFile = vi.mocked(readFile);

    // npm: infer "20" from package.json
    mockReadFile.mockImplementation(async (p: any) => {
      const path = String(p);
      if (path.endsWith('package.json'))
        return JSON.stringify({ engines: { node: '20' } }) as any;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    mockCheckbox.mockResolvedValue(['npm', 'composer']);
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);

    // User explicitly blanks out the version
    mockPrompt.mockImplementation(async (question: string, _defaultValue?: string) => {
      if (question.includes('Language version')) return '';
      return _defaultValue ?? '';
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Blank Version Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Blank response → runner.language_version should be undefined (no runner or runner without language_version)
    const blankVersionCall = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmBlankEntry = blankVersionCall.ecosystemConfigs?.find((e) => e.id === 'npm');
    // Either no runner attached, or runner without language_version
    expect(npmBlankEntry?.runner?.language_version).toBeUndefined();
    expect((npmBlankEntry as any)?.version).toBeUndefined();
    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystemConfigs: expect.arrayContaining([
          expect.objectContaining({ id: 'npm' }),
        ]),
      }),
    );
  });

  it('does not prompt for version of a non-selected ecosystem', async () => {
    const { readFile } = await import('node:fs/promises');
    const mockReadFile = vi.mocked(readFile);

    mockReadFile.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    const versionPromptQuestions: string[] = [];

    // Only npm selected — composer excluded
    mockCheckbox.mockResolvedValue(['npm']);
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);

    mockPrompt.mockImplementation(async (question: string, defaultValue?: string) => {
      if (question.includes('Language version')) {
        versionPromptQuestions.push(question);
      }
      return defaultValue ?? '';
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Npm Only Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Version prompt should only appear for npm, never for composer
    expect(versionPromptQuestions.some((q) => q.includes('npm'))).toBe(true);
    expect(versionPromptQuestions.some((q) => q.includes('Composer'))).toBe(false);

    // ecosystemConfigs should only contain npm
    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        ecosystemConfigs: expect.arrayContaining([expect.objectContaining({ id: 'npm' })]),
      }),
    );
    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const composerEntry = call.ecosystemConfigs?.find((e) => e.id === 'composer');
    expect(composerEntry).toBeUndefined();
  });
});

describe('runInitCommand — interactive build mode prompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no ecosystems detected → nothing pre-selected (checkboxPrompt mock controls selection)
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });
    // Default: no scripts detected → fall back to confirm flow
    mockDetectProjectScripts.mockResolvedValue([]);
  });

  it('wires build mode -> build.dockerfile/context/target/args for npm/pip/composer', async () => {
    // All ecosystems selected
    mockCheckbox.mockResolvedValue(['npm', 'composer', 'pip']);
    // selectPrompt: return 'en' for language; 'build' for build mode; first choice for fixer
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      if (msg.includes('Image mode') || msg.includes('Modo de imagem')) return 'build';
      return choices[0].value;
    });
    // confirmPrompt: skip validation/advisors/sonarqube; no markdown
    mockConfirm.mockResolvedValue(false);

    mockPrompt.mockImplementation(async (question: string, defaultValue?: string) => {
      // Skip version prompts
      if (question.includes('Language version') || question.includes('PHP language version') || question.includes('Python language version') || question.includes('PHP') || question.includes('Python')) return '';

      // npm build flow
      if (question.includes('[npm] Dockerfile path')) return '.docker/node.Dockerfile';
      if (question.includes('[npm] Build context')) return 'docker/';
      if (question.includes('[npm] Build target stage')) return '';
      if (question.includes('[npm] Build args')) return 'NODE_VERSION=22,APP_ENV=production';

      // composer build flow
      if (question.includes('[Composer] Dockerfile path')) return '.docker/php.Dockerfile';
      if (question.includes('[Composer] Build context')) return '.docker/';
      if (question.includes('[Composer] Build target stage')) return 'php-stage';
      if (question.includes('[Composer] Build args')) return 'PHP_VERSION=8.2,APP_ENV=production';

      // pip build flow
      if (question.includes('[pip] Dockerfile path')) return '.docker/pip.Dockerfile';
      if (question.includes('[pip] Build context')) return 'python/';
      if (question.includes('[pip] Build target stage')) return '';
      if (question.includes('[pip] Build args')) return 'PYTHON_VERSION=3.11,PIP_INDEX_URL=https://pypi.org/simple';

      return defaultValue ?? '';
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Build Mode Init Project',
      client: 'ACME',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEco = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    const pipEco = call.ecosystemConfigs?.find((e) => e.id === 'pip');
    const composerEco = call.ecosystemConfigs?.find((e) => e.id === 'composer');

    expect(npmEco?.runner).toMatchObject({
      build: {
        dockerfile: '.docker/node.Dockerfile',
        context: 'docker/',
        args: {
          NODE_VERSION: '22',
          APP_ENV: 'production',
        },
      },
    });
    // npm: no target provided → target field absent
    expect(npmEco?.runner?.build?.target).toBeUndefined();

    expect(pipEco?.runner).toMatchObject({
      build: {
        dockerfile: '.docker/pip.Dockerfile',
        context: 'python/',
        args: {
          PYTHON_VERSION: '3.11',
          PIP_INDEX_URL: 'https://pypi.org/simple',
        },
      },
    });

    expect(composerEco?.runner).toMatchObject({
      build: {
        dockerfile: '.docker/php.Dockerfile',
        context: '.docker/',
        target: 'php-stage',
        args: {
          PHP_VERSION: '8.2',
          APP_ENV: 'production',
        },
      },
    });
  });

  it('omits build field when user selects pull mode', async () => {
    mockCheckbox.mockResolvedValue(['npm']);
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      if (msg.includes('Image mode') || msg.includes('Modo de imagem')) return 'pull';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_question: string, defaultValue?: string) => defaultValue ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Pull Mode Project',
      client: 'ACME',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEco = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    // pull mode: no build field on runner
    expect(npmEco?.runner?.build).toBeUndefined();
  });
});

// ─── Existing file guard ──────────────────────────────────────────────────────

describe('runInitCommand — existing file guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset access mock entirely (clears all queued once-mocks) then set default to reject
    mockAccess.mockReset();
    // Simulate "file not found" (ENOENT) so the guard proceeds by default
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    // Default: no ecosystems detected → fallback to all
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });
    // Default: no scripts detected → use plugin defaults
    mockDetectProjectScripts.mockResolvedValue([]);
  });

  it('throws ConfigLoadError (exit code 3 semantics) when output file exists and --force is not set', async () => {
    // Simulate file already exists
    mockAccess.mockResolvedValueOnce(undefined);

    await expect(
      runInitCommand({
        cwd: '/repo',
        force: false,
        nonInteractive: true,
        output: 'security-scan.config.json',
      }),
    ).rejects.toThrow(ConfigLoadError);
  });

  it('includes the output path and --force hint in the thrown error message', async () => {
    mockAccess.mockResolvedValueOnce(undefined);

    const err = await runInitCommand({
      cwd: '/repo',
      force: false,
      nonInteractive: true,
      output: 'security-scan.config.json',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ConfigLoadError);
    expect(err.message).toMatch(/File already exists/);
    expect(err.message).toMatch(/--force/);
  });

  it('proceeds normally when --force is set even if file exists', async () => {
    // When --force is true, access is not called at all (guard is skipped)

    await expect(
      runInitCommand({
        cwd: '/repo',
        force: true,
        nonInteractive: true,
        projectName: 'Force Project',
        client: 'Client',
        output: 'security-scan.config.json',
      }),
    ).resolves.toBeUndefined();

    expect(writeFile).toHaveBeenCalled();
  });

  it('proceeds normally when file does not exist and --force is not set', async () => {
    // access rejects (set in beforeEach) → file does not exist → proceed

    await expect(
      runInitCommand({
        cwd: '/repo',
        force: false,
        nonInteractive: true,
        projectName: 'New Project',
        client: 'Client',
        output: 'security-scan.config.json',
      }),
    ).resolves.toBeUndefined();

    expect(writeFile).toHaveBeenCalled();
  });

  it('proceeds when access rejects with an ENOENT error (code check)', async () => {
    // Explicitly set ENOENT with code
    mockAccess.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
    );

    await expect(
      runInitCommand({
        cwd: '/repo',
        force: false,
        nonInteractive: true,
        projectName: 'ENOENT Project',
        client: 'Client',
        output: 'security-scan.config.json',
      }),
    ).resolves.toBeUndefined();

    expect(writeFile).toHaveBeenCalled();
  });

  it('re-throws unexpected fs errors (e.g. EACCES) instead of swallowing them', async () => {
    const permissionError = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    mockAccess.mockRejectedValueOnce(permissionError);

    await expect(
      runInitCommand({
        cwd: '/repo',
        force: false,
        nonInteractive: true,
        projectName: 'Permission Project',
        client: 'Client',
        output: 'security-scan.config.json',
      }),
    ).rejects.toThrow('EACCES: permission denied');

    expect(writeFile).not.toHaveBeenCalled();
  });
});

// ─── Ecosystem detection ──────────────────────────────────────────────────────

describe('runInitCommand — ecosystem detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    // Default: no scripts detected → use plugin defaults / confirm flow
    mockDetectProjectScripts.mockResolvedValue([]);
  });

  it('pre-selects discovered ecosystems in the checkbox prompt (interactive)', async () => {
    // Only npm discovered at root
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [{ pluginId: 'npm', path: '', lockfile: 'package-lock.json', suggestedLabel: undefined }],
      dockerfiles: [],
    });

    // checkboxPrompt: capture choices and return the npm discovery index '0'
    let capturedChoices: Array<{ name: string; value: string; checked: boolean }> = [];
    mockCheckbox.mockImplementation(async (_msg: string, choices: any[]) => {
      capturedChoices = choices;
      return ['0']; // select the first (npm) discovery
    });

    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return false;
      if (msg.includes('Generate markdown') || msg.includes('markdown')) return true;
      return false;
    });
    mockPrompt.mockImplementation(async (_question: string, defaultValue?: string) => defaultValue ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Detection Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // All discovered entries are pre-checked=true; only one choice shown (npm)
    expect(capturedChoices.length).toBe(1);
    expect(capturedChoices[0]!.checked).toBe(true);
    expect(capturedChoices[0]!.name).toMatch(/npm/i);
  });

  it('checkbox message includes keyboard hint text', async () => {
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });

    let capturedMessage = '';
    mockCheckbox.mockImplementation(async (msg: string, choices: any[]) => {
      capturedMessage = msg;
      return choices.map((c: any) => c.value);
    });

    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return false;
      if (msg.includes('Generate markdown') || msg.includes('markdown')) return true;
      return false;
    });
    mockPrompt.mockImplementation(async (_question: string, defaultValue?: string) => defaultValue ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Hint Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(capturedMessage).toMatch(/Space/i);
    expect(capturedMessage).toMatch(/Enter/i);
  });

  it('non-interactive mode uses only discovered ecosystems when discovery finds some', async () => {
    // Only composer discovered at root
    mockDiscoverProject.mockResolvedValue({
      ecosystems: [{ pluginId: 'composer', path: '', lockfile: 'composer.lock', suggestedLabel: undefined }],
      dockerfiles: [],
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Detected Composer',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    expect(call.ecosystemConfigs?.map((e) => e.id)).toEqual(['composer']);
  });

  it('non-interactive mode falls back to all ecosystems when nothing is detected', async () => {
    // Nothing detected → fallback to all
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Fallback Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const ids = call.ecosystemConfigs?.map((e) => e.id) ?? [];
    // All three plugins should be present when nothing detected
    expect(ids).toContain('npm');
    expect(ids).toContain('composer');
    expect(ids).toContain('pip');
  });
});

// ─── SonarQube mode selection ─────────────────────────────────────────────────

describe('runInitCommand — SonarQube mode selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });
    // Default: no scripts detected → use plugin defaults / confirm flow
    mockDetectProjectScripts.mockResolvedValue([]);
  });

  it('prompts for mode when SonarQube is enabled in interactive mode and passes managed to generateConfigJson', async () => {
    mockCheckbox.mockResolvedValue(['npm']);
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return true;
      if (msg.includes('Generate markdown') || msg.includes('markdown')) return true;
      return false;
    });
    // selectPrompt: return 'en' for language; 'managed' for SonarQube mode; first choice for others
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      if (msg.includes('SonarQube mode')) return 'managed';
      return choices[0].value;
    });
    mockPrompt.mockImplementation(async (_question: string, defaultValue?: string) => defaultValue ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Sonar Managed Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(mockSelect).toHaveBeenCalledWith(
      'SonarQube mode',
      expect.arrayContaining([
        expect.objectContaining({ value: 'managed' }),
        expect.objectContaining({ value: 'external' }),
      ]),
      'managed',
    );

    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        enableSonarQube: true,
        sonarQubeMode: 'managed',
      }),
    );
  });

  it('passes external mode to generateConfigJson when user selects external', async () => {
    mockCheckbox.mockResolvedValue(['npm']);
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return true;
      if (msg.includes('Generate markdown') || msg.includes('markdown')) return true;
      return false;
    });
    // selectPrompt: return 'en' for language; 'external' for mode; first choice for everything else
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      if (msg.includes('SonarQube mode')) return 'external';
      return choices[0].value;
    });
    mockPrompt.mockImplementation(async (_question: string, defaultValue?: string) => defaultValue ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Sonar External Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        enableSonarQube: true,
        sonarQubeMode: 'external',
      }),
    );
  });

  it('does not prompt for mode when SonarQube is disabled', async () => {
    mockCheckbox.mockResolvedValue(['npm']);
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return false;
      if (msg.includes('Generate markdown') || msg.includes('markdown')) return false;
      return false;
    });

    const selectCalls: string[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      selectCalls.push(msg);
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockPrompt.mockImplementation(async (_question: string, defaultValue?: string) => defaultValue ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'No Sonar Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(selectCalls.some((m) => m.includes('SonarQube mode'))).toBe(false);
    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        enableSonarQube: false,
        sonarQubeMode: 'managed',
      }),
    );
  });

  it('defaults mode to managed in non-interactive mode even when SonarQube would be enabled', async () => {
    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Non-Interactive Sonar',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        sonarQubeMode: 'managed',
      }),
    );

    // No select prompt should be called in non-interactive mode
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('mode select choices have short names and descriptions mentioning ephemeral container and existing server', async () => {
    mockCheckbox.mockResolvedValue(['npm']);
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return true;
      return false;
    });

    const capturedChoices: any[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      if (msg.includes('SonarQube mode')) {
        capturedChoices.push(...choices);
        return 'managed';
      }
      return choices[0].value;
    });
    mockPrompt.mockImplementation(async (_question: string, defaultValue?: string) => defaultValue ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Choices Verify Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const managedChoice = capturedChoices.find((c: any) => c.value === 'managed');
    const externalChoice = capturedChoices.find((c: any) => c.value === 'external');

    expect(managedChoice).toBeDefined();
    expect(externalChoice).toBeDefined();
    // managed choice description should mention ephemeral container
    expect(managedChoice?.description).toMatch(/ephemeral|container/i);
    // external choice description should mention existing server or better performance
    expect(externalChoice?.description).toMatch(/existing|performance/i);
    // names are now short labels (not full descriptions)
    expect(managedChoice?.name).toMatch(/Managed/i);
    expect(externalChoice?.name).toMatch(/External/i);
  });
});

// ─── i18n: language prompt and locale selection ───────────────────────────────

describe('runInitCommand — i18n', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });
    // Default: no scripts detected → use plugin defaults / confirm flow
    mockDetectProjectScripts.mockResolvedValue([]);
  });

  it('language prompt is the FIRST selectPrompt call (before any ecosystem or project prompts)', async () => {
    mockCheckbox.mockResolvedValue([]);
    const selectCallOrder: string[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      selectCallOrder.push(msg);
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Lang First Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Language / Idioma must be the very first selectPrompt call
    expect(selectCallOrder[0]).toBe('Language / Idioma');
  });

  it('language prompt uses bilingual label "Language / Idioma"', async () => {
    mockCheckbox.mockResolvedValue([]);
    const capturedMessages: string[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      capturedMessages.push(msg);
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Bilingual Label Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(capturedMessages).toContain('Language / Idioma');
  });

  it('language prompt choices are "English (en)" and "Português (pt-br)"', async () => {
    mockCheckbox.mockResolvedValue([]);
    let capturedChoices: Array<{ name: string; value: string }> = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg === 'Language / Idioma') {
        capturedChoices = choices;
        return 'en';
      }
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Choices Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(capturedChoices.some((c) => c.value === 'en' && c.name === 'English (en)')).toBe(true);
    expect(capturedChoices.some((c) => c.value === 'pt-br' && c.name === 'Português (pt-br)')).toBe(true);
  });

  it('uses EN strings when language "en" is selected', async () => {
    mockCheckbox.mockResolvedValue([]);
    const confirmMessages: string[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg === 'Language / Idioma') return 'en';
      return choices[0].value;
    });
    mockConfirm.mockImplementation(async (msg: string) => {
      confirmMessages.push(msg);
      return false;
    });
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'EN Strings Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // EN locale: enableSonarQubePrompt is 'Enable SonarQube scanner?'
    expect(confirmMessages.some((m) => m.includes('Enable SonarQube scanner?'))).toBe(true);
  });

  it('uses PT-BR strings when language "pt-br" is selected', async () => {
    mockCheckbox.mockResolvedValue([]);
    const confirmMessages: string[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg === 'Language / Idioma') return 'pt-br';
      return choices[0].value;
    });
    mockConfirm.mockImplementation(async (msg: string) => {
      confirmMessages.push(msg);
      return false;
    });
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'PT-BR Strings Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // PT-BR locale: enableSonarQubePrompt is 'Habilitar scanner SonarQube?'
    expect(confirmMessages.some((m) => m.includes('Habilitar scanner SonarQube?'))).toBe(true);
  });

  it('non-interactive mode defaults language via resolveDefaultLocale() — no selectPrompt called', async () => {
    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Non-interactive i18n test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // No selectPrompt should be called in non-interactive mode
    expect(mockSelect).not.toHaveBeenCalled();
    // generateConfigJson should have been called with a valid reportLanguage
    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({
        reportLanguage: expect.stringMatching(/^(en|pt-br)$/),
      }),
    );
  });

  it('selected language is passed to generateConfigJson as reportLanguage (backward compat)', async () => {
    mockCheckbox.mockResolvedValue([]);
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg === 'Language / Idioma') return 'pt-br';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Backward Compat Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(generateConfigJson).toHaveBeenCalledWith(
      expect.objectContaining({ reportLanguage: 'pt-br' }),
    );
  });

  it('old "Report language" selectPrompt is no longer called', async () => {
    mockCheckbox.mockResolvedValue([]);
    const selectMessages: string[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      selectMessages.push(msg);
      if (msg === 'Language / Idioma') return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'No Old Prompt Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(selectMessages.some((m) => m === 'Report language')).toBe(false);
  });
});

// ─── Schema file write ────────────────────────────────────────────────────────

describe('runInitCommand — schema file write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });
    // Default: no scripts detected → use plugin defaults
    mockDetectProjectScripts.mockResolvedValue([]);
  });

  it('writes the JSON Schema file to .security-scan/config-schema.json during init', async () => {
    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Schema Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const writeFileMock = vi.mocked(writeFile);
    const schemaCalls = writeFileMock.mock.calls.filter(
      ([filePath]) => String(filePath).endsWith('.security-scan/config-schema.json'),
    );
    expect(schemaCalls.length).toBe(1);
  });

  it('schema file path ends with .security-scan/config-schema.json relative to cwd', async () => {
    await runInitCommand({
      cwd: '/my/project',
      force: true,
      nonInteractive: true,
      projectName: 'Schema Path Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const writeFileMock = vi.mocked(writeFile);
    const schemaCall = writeFileMock.mock.calls.find(
      ([filePath]) => String(filePath).endsWith('.security-scan/config-schema.json'),
    );
    expect(schemaCall).toBeDefined();
    expect(String(schemaCall![0])).toContain('/my/project');
    expect(String(schemaCall![0])).toContain('.security-scan/config-schema.json');
  });

  it('calls generateJsonSchema to produce the schema content', async () => {
    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Schema Generate Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(vi.mocked(generateJsonSchema)).toHaveBeenCalled();
  });

  it('schema file content is valid JSON-serialized schema object', async () => {
    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Schema Content Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const writeFileMock = vi.mocked(writeFile);
    const schemaCall = writeFileMock.mock.calls.find(
      ([filePath]) => String(filePath).endsWith('.security-scan/config-schema.json'),
    );
    expect(schemaCall).toBeDefined();
    const content = String(schemaCall![1]);
    // Content must be valid JSON
    expect(() => JSON.parse(content)).not.toThrow();
    const parsed = JSON.parse(content) as Record<string, unknown>;
    // The mock returns { type: 'object', properties: {} }
    expect(parsed).toHaveProperty('type', 'object');
  });

  it('mkdir is called with .security-scan dir before writing schema (recursive:true)', async () => {
    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Schema Mkdir Test',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const mkdirMock = vi.mocked(mkdir);
    const securityScanMkdirCall = mkdirMock.mock.calls.find(
      ([dirPath]) => String(dirPath).endsWith('.security-scan'),
    );
    expect(securityScanMkdirCall).toBeDefined();
    expect(securityScanMkdirCall![1]).toEqual({ recursive: true });
  });
});

// ─── Script detection flow ────────────────────────────────────────────────────

describe('runInitCommand — script detection flow (interactive)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });
    // Default: no scripts detected (tests override this as needed)
    mockDetectProjectScripts.mockResolvedValue([]);
  });

  it('when scripts are detected, checkboxPrompt is called with detected scripts as choices', async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'test', command: 'npm test', recommended: true },
          { name: 'build', command: 'npm run build', recommended: true },
          { name: 'format', command: 'npm run format', recommended: false },
        ];
      }
      return [];
    });

    let capturedScriptChoices: Array<{ name: string; value: string; checked: boolean }> = [];
    let capturedScriptMessage = '';

    // Ecosystem selection → scripts checkbox: two sequential checkboxPrompt calls
    mockCheckbox
      .mockImplementationOnce(async () => ['npm']) // first call: ecosystem selection
      .mockImplementationOnce(async (msg: string, choices: any[]) => {
        // second call: scripts checkbox
        capturedScriptMessage = msg;
        capturedScriptChoices = choices;
        return choices.filter((c: any) => c.checked).map((c: any) => c.value);
      });
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return false;
      if (msg.includes('markdown')) return true;
      return false;
    });
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Script Detection Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // The script checkbox prompt message should mention the count
    expect(capturedScriptMessage).toMatch(/Found 3 scripts/);
    // Choices should include detected scripts
    const choiceNames = capturedScriptChoices.map((c) => c.name);
    expect(choiceNames.some((n) => n.includes('test'))).toBe(true);
    expect(choiceNames.some((n) => n.includes('build'))).toBe(true);
    expect(choiceNames.some((n) => n.includes('format'))).toBe(true);
  });

  it('recommended scripts are pre-checked except test-matching ones, non-recommended are unchecked', async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'test', command: 'npm test', recommended: true },
          { name: 'build', command: 'npm run build', recommended: true },
          { name: 'format', command: 'npm run format', recommended: false },
        ];
      }
      return [];
    });

    let capturedChoices: Array<{ name: string; value: string; checked: boolean }> = [];
    mockCheckbox
      .mockImplementationOnce(async () => ['npm']) // ecosystem selection
      .mockImplementationOnce(async (_msg: string, choices: any[]) => {
        capturedChoices = choices;
        return choices.filter((c: any) => c.checked).map((c: any) => c.value);
      });
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return false;
      if (msg.includes('markdown')) return true;
      return false;
    });
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Recommended Pre-check Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Skip the first 'None' sentinel choice when finding script choices
    const scriptChoices = capturedChoices.filter((c) => c.value !== '__none__');
    const testChoice = scriptChoices.find((c) => c.name.includes('test'));
    const buildChoice = scriptChoices.find((c) => c.name.includes('build'));
    const formatChoice = scriptChoices.find((c) => c.name.includes('format'));

    // test scripts are NOT pre-checked even though recommended=true
    expect(testChoice?.checked).toBe(false);
    // build is recommended and not test-matching → pre-checked
    expect(buildChoice?.checked).toBe(true);
    // format is not recommended → not pre-checked
    expect(formatChoice?.checked).toBe(false);
  });

  it('when no scripts detected, falls back to existing confirm-each flow', async () => {
    // No scripts for any ecosystem
    mockDetectProjectScripts.mockResolvedValue([]);

    const confirmMessages: string[] = [];
    mockCheckbox.mockImplementationOnce(async () => ['npm']); // ecosystem selection
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockImplementation(async (msg: string) => {
      confirmMessages.push(msg);
      if (msg.includes('SonarQube')) return false;
      if (msg.includes('markdown')) return false;
      return true; // include validation commands
    });
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Fallback Confirm Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // The confirm flow should have been used for validation commands
    expect(confirmMessages.some((m) => m.includes('Include') && m.includes('validation command'))).toBe(true);
  });

  it('selected scripts appear in the ecosystemConfigs validationCommands', async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'test', command: 'npm test', recommended: true },
          { name: 'build', command: 'npm run build', recommended: true },
        ];
      }
      return [];
    });

    // Return only the test script as selected
    const testValue = JSON.stringify({ name: 'test', command: 'npm test' });
    mockCheckbox
      .mockImplementationOnce(async () => ['npm']) // ecosystem selection
      .mockImplementationOnce(async () => [testValue]); // scripts selection
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return false;
      if (msg.includes('markdown')) return false;
      return false;
    });
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Scripts In Config Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    expect(npmEntry?.validationCommands).toEqual([{ name: 'test', command: 'npm test' }]);
  });

  it('uncovered plugin defaults are appended to the checkbox choices when scripts are detected', async () => {
    // npm plugin has { name: 'build', command: 'npm run build' } as defaultValidationCommands
    // Detected scripts include 'test' but not 'build' → 'build' from defaults gets added
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'test', command: 'npm test', recommended: true },
        ];
      }
      return [];
    });

    let capturedChoices: Array<{ name: string; value: string; checked: boolean }> = [];
    mockCheckbox
      .mockImplementationOnce(async () => ['npm']) // ecosystem selection
      .mockImplementationOnce(async (_msg: string, choices: any[]) => {
        capturedChoices = choices;
        return [];
      });
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return false;
      if (msg.includes('markdown')) return false;
      return false;
    });
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Uncovered Defaults Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Should have 'test' from detected + 'build' from plugin defaults (not covered by detected)
    const scriptChoices = capturedChoices.filter((c) => c.value !== '__none__');
    const choiceNames = scriptChoices.map((c) => c.name);
    expect(choiceNames.some((n) => n.includes('test'))).toBe(true);
    expect(choiceNames.some((n) => n.includes('build'))).toBe(true);
    // Plugin default 'build' is already in detected? No — detected only has 'test'
    // So build comes from uncoveredDefaults, pre-checked true
    const buildChoice = scriptChoices.find((c) => c.name.includes('build'));
    expect(buildChoice?.checked).toBe(true);
  });

  it('script choices are sorted alphabetically by name (case-insensitive)', async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'test', command: 'npm test', recommended: true },
          { name: 'build', command: 'npm run build', recommended: true },
          { name: 'lint', command: 'npm run lint', recommended: true },
          { name: 'format', command: 'npm run format', recommended: false },
        ];
      }
      return [];
    });

    let capturedChoices: Array<{ name: string; value: string; checked: boolean }> = [];
    mockCheckbox
      .mockImplementationOnce(async () => ['npm'])
      .mockImplementationOnce(async (_msg: string, choices: any[]) => {
        capturedChoices = choices;
        return [];
      });
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockImplementation(async (msg: string) => {
      if (msg.includes('SonarQube')) return false;
      if (msg.includes('markdown')) return false;
      return false;
    });
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Sorted Scripts Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    // Last choice is the 'None' sentinel, scripts before it are in alphabetical order
    expect(capturedChoices[capturedChoices.length - 1]!.value).toBe('__none__');
    const scriptChoices = capturedChoices.slice(0, -1);
    const scriptNames = scriptChoices.map((c) => {
      // Extract script name from "name (command)" format
      return c.name.split(' (')[0]!;
    });
    const sortedNames = [...scriptNames].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    expect(scriptNames).toEqual(sortedNames);
  });

  it('test-matching scripts are NOT pre-checked (AC4)', async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'test', command: 'npm test', recommended: true },
          { name: 'test:unit', command: 'npm run test:unit', recommended: true },
          { name: 'test:e2e', command: 'npm run test:e2e', recommended: true },
          { name: 'lint', command: 'npm run lint', recommended: true },
          { name: 'build', command: 'npm run build', recommended: true },
        ];
      }
      return [];
    });

    let capturedChoices: Array<{ name: string; value: string; checked: boolean }> = [];
    mockCheckbox
      .mockImplementationOnce(async () => ['npm'])
      .mockImplementationOnce(async (_msg: string, choices: any[]) => {
        capturedChoices = choices;
        return [];
      });
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Test Not Pre-checked Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const scriptChoices = capturedChoices.filter((c) => c.value !== '__none__');
    const testChoice = scriptChoices.find((c) => c.name.startsWith('test '));
    const testUnitChoice = scriptChoices.find((c) => c.name.startsWith('test:unit'));
    const testE2eChoice = scriptChoices.find((c) => c.name.startsWith('test:e2e'));
    const lintChoice = scriptChoices.find((c) => c.name.startsWith('lint'));
    const buildChoice = scriptChoices.find((c) => c.name.startsWith('build'));

    // test-matching scripts are NOT pre-checked
    expect(testChoice?.checked).toBe(false);
    expect(testUnitChoice?.checked).toBe(false);
    expect(testE2eChoice?.checked).toBe(false);
    // non-test recommended scripts remain pre-checked
    expect(lintChoice?.checked).toBe(true);
    expect(buildChoice?.checked).toBe(true);
  });

  it("'None' option is the LAST choice in the scripts checkbox (AC5)", async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'build', command: 'npm run build', recommended: true },
        ];
      }
      return [];
    });

    let capturedChoices: Array<{ name: string; value: string; checked: boolean }> = [];
    mockCheckbox
      .mockImplementationOnce(async () => ['npm'])
      .mockImplementationOnce(async (_msg: string, choices: any[]) => {
        capturedChoices = choices;
        return [];
      });
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'None Last Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const noneChoice = capturedChoices[capturedChoices.length - 1]!;
    expect(noneChoice.value).toBe('__none__');
    expect(noneChoice.name).toMatch(/None|Nenhum/i);
    expect(noneChoice.checked).toBe(false);
  });

  it("selecting only '__none__' yields empty validationCommands (AC5)", async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'build', command: 'npm run build', recommended: true },
        ];
      }
      return [];
    });

    mockCheckbox
      .mockImplementationOnce(async () => ['npm'])
      .mockImplementationOnce(async () => ['__none__']); // user picks only None
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'None Selected Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    expect(npmEntry?.validationCommands).toEqual([]);
  });

  it('selecting nothing (empty array) yields empty validationCommands (AC5)', async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'build', command: 'npm run build', recommended: true },
        ];
      }
      return [];
    });

    mockCheckbox
      .mockImplementationOnce(async () => ['npm'])
      .mockImplementationOnce(async () => []); // user selects nothing
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Empty Selection Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    expect(npmEntry?.validationCommands).toEqual([]);
  });

  it("selecting '__none__' AND a real script uses the script, not discards it (AC4)", async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'build', command: 'npm run build', recommended: true },
        ];
      }
      return [];
    });

    const buildValue = JSON.stringify({ name: 'build', command: 'npm run build' });
    mockCheckbox
      .mockImplementationOnce(async () => ['npm'])
      .mockImplementationOnce(async () => [buildValue, '__none__']); // both sentinel and real script
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Mixed Selection Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');
    // real script should be used, __none__ should be ignored
    expect(npmEntry?.validationCommands).toEqual([{ name: 'build', command: 'npm run build' }]);
  });
});

describe('runInitCommand — description fields on prompt choices (AC1/AC2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });
    mockDetectProjectScripts.mockResolvedValue([]);
  });

  it('build mode select choices have description fields', async () => {
    mockCheckbox.mockResolvedValue(['npm']);
    const capturedBuildChoices: any[] = [];
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      if (msg.includes('Image mode') || msg.includes('Modo de imagem')) {
        capturedBuildChoices.push(...choices);
        return 'build';
      }
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'Build Descriptions Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    expect(capturedBuildChoices.length).toBeGreaterThanOrEqual(2);
    const buildChoice = capturedBuildChoices.find((c: any) => c.value === 'build');
    const pullChoice = capturedBuildChoices.find((c: any) => c.value === 'pull');
    expect(buildChoice?.description).toBeTruthy();
    expect(pullChoice?.description).toBeTruthy();
  });

  it("'None' sentinel choice in script checkbox has a description field", async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [{ name: 'build', command: 'npm run build', recommended: true }];
      }
      return [];
    });

    let capturedChoices: any[] = [];
    mockCheckbox
      .mockImplementationOnce(async () => ['npm'])
      .mockImplementationOnce(async (_msg: string, choices: any[]) => {
        capturedChoices = choices;
        return [];
      });
    mockSelect.mockImplementation(async (msg: string, choices: any[]) => {
      if (msg.includes('Language') || msg.includes('Idioma')) return 'en';
      return choices[0].value;
    });
    mockConfirm.mockResolvedValue(false);
    mockPrompt.mockImplementation(async (_q: string, def?: string) => def ?? '');

    await runInitCommand({
      cwd: '/repo',
      force: true,
      projectName: 'None Desc Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const noneChoice = capturedChoices.find((c: any) => c.value === '__none__');
    expect(noneChoice?.description).toBeTruthy();
  });
});

describe('runInitCommand — script detection flow (non-interactive)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockDiscoverProject.mockResolvedValue({ ecosystems: [], dockerfiles: [] });
  });

  it('non-interactive mode uses detected+recommended scripts when available', async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        return [
          { name: 'test', command: 'npm test', recommended: true },
          { name: 'build', command: 'npm run build', recommended: true },
          { name: 'format', command: 'npm run format', recommended: false },
        ];
      }
      return [];
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Non-interactive Scripts Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');

    // Only recommended scripts should be included
    expect(npmEntry?.validationCommands).toEqual(
      expect.arrayContaining([
        { name: 'test', command: 'npm test' },
        { name: 'build', command: 'npm run build' },
      ]),
    );
    // Non-recommended script 'format' should NOT be included
    expect(npmEntry?.validationCommands?.some((v) => v.name === 'format')).toBe(false);
  });

  it('non-interactive mode falls back to plugin defaults when no scripts detected', async () => {
    // No scripts detected for any ecosystem
    mockDetectProjectScripts.mockResolvedValue([]);

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'Non-interactive Fallback Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');

    // Should fall back to plugin.defaultValidationCommands (npm has 'build')
    expect(npmEntry?.validationCommands).toEqual(
      expect.arrayContaining([{ name: 'build', command: 'npm run build' }]),
    );
  });

  it('non-interactive mode falls back to plugin defaults when detected scripts have no recommended ones', async () => {
    mockDetectProjectScripts.mockImplementation(async (_cwd, ecosystemId) => {
      if (ecosystemId === 'npm') {
        // All scripts are non-recommended
        return [
          { name: 'format', command: 'npm run format', recommended: false },
          { name: 'docs', command: 'npm run docs', recommended: false },
        ];
      }
      return [];
    });

    await runInitCommand({
      cwd: '/repo',
      force: true,
      nonInteractive: true,
      projectName: 'No Recommended Scripts Project',
      client: 'Client',
      output: 'security-scan.config.json',
    });

    const call = vi.mocked(generateConfigJson).mock.calls[0]![0];
    const npmEntry = call.ecosystemConfigs?.find((e) => e.id === 'npm');

    // Falls back to plugin defaults since no recommended scripts found
    expect(npmEntry?.validationCommands).toEqual(
      expect.arrayContaining([{ name: 'build', command: 'npm run build' }]),
    );
  });
});
