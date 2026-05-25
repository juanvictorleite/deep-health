import { writeFile, access, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { DEFAULT_CONFIG_PATH } from '@infra/config/loader';
import { generateConfigJson, type GenerateConfigOptions, type EcosystemRunnerConfig } from '@infra/config/generator';
import { generateJsonSchema } from '@infra/config/schema-export';
import { writeSonarPropertiesTemplateIfMissing } from './sonar-properties-template';
import { prompt } from '@infra/utils/prompt';
import { confirmPrompt, selectPrompt, checkboxPrompt } from '@infra/utils/inquirer-prompts';
import { detectEcosystems } from '@infra/utils/detect-ecosystems';
import { detectProjectScripts } from '@infra/utils/detect-scripts';
import { defaultRegistry } from '@modules/ecosystem/index';
import { ConfigLoadError } from '@core/errors';
import { resolveDefaultLocale } from '@core/locale-detect';
import { CLI_NAME, DEFAULT_AUDIT_SUBDIR, DEFAULT_REPORTS_SUBDIR } from '@infra/brand';
import { __, setLocale } from '@core/i18n';

export interface InitCommandOptions {
  projectName?: string;
  client?: string;
  cwd: string;
  output?: string;
  force: boolean;
  /** Skip interactive prompts — used in tests and CI. */
  nonInteractive?: boolean;
}

/**
 * Parses a comma-separated KEY=VALUE string into a Record<string, string>.
 * Returns undefined when the input is blank or yields no valid pairs.
 */
function parseBuildArgs(raw: string): Record<string, string> | undefined {
  const pairs = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      result[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

interface CollectRunnerConfigOpts {
  pluginName: string;
  nonInteractive: boolean | undefined;
  inferredVersion: string | undefined;
  versionPromptWithInferred: string;
  versionPromptBlank: string;
}

/**
 * Collects the per-ecosystem runner configuration (language version + image
 * source settings) through interactive prompts or non-interactive defaults.
 * Returns a partial EcosystemRunnerConfig; the caller decides whether to
 * attach it to the ecosystem entry.
 */
async function collectRunnerConfig(opts: CollectRunnerConfigOpts): Promise<EcosystemRunnerConfig> {
  const { pluginName, nonInteractive, inferredVersion, versionPromptWithInferred, versionPromptBlank } = opts;
  const runnerData: EcosystemRunnerConfig = {};

  if (!nonInteractive) {
    const versionDefault = inferredVersion ?? '';
    const versionPromptMsg = inferredVersion ? versionPromptWithInferred : versionPromptBlank;
    const versionAnswer = await prompt(versionPromptMsg, versionDefault);
    const resolvedVersion = versionAnswer.trim() || undefined;
    if (resolvedVersion) runnerData.language_version = resolvedVersion;
  } else {
    if (inferredVersion) runnerData.language_version = inferredVersion;
  }

  if (!nonInteractive) {
    const buildMode = await selectPrompt(
      __('  [{{plugin}}] Image mode', { plugin: pluginName }),
      [
        { name: __('build (recommended)'), value: 'build' as const, description: __('Builds from your project Dockerfile with all tools pre-installed') },
        { name: __('pull'), value: 'pull' as const, description: __('Uses a standard registry image (may lack project-specific tools)') },
      ],
      'build',
    );
    if (buildMode === 'build') {
      const dfPath = await prompt(__('  [{{plugin}}] Dockerfile path', { plugin: pluginName }), 'Dockerfile');
      const ctxAnswer = await prompt(__("  [{{plugin}}] Build context (blank for '.')", { plugin: pluginName }), '');
      const targetAnswer = await prompt(__('  [{{plugin}}] Build target stage (blank to skip)', { plugin: pluginName }), '');
      const buildArgsAnswer = await prompt(__('  [{{plugin}}] Build args (KEY=VALUE comma-separated, blank to skip)', { plugin: pluginName }), '');
      const parsedArgs = parseBuildArgs(buildArgsAnswer);

      const buildConfig: NonNullable<EcosystemRunnerConfig['build']> = {
        dockerfile: dfPath.trim() || 'Dockerfile',
        context: ctxAnswer.trim() || '.',
      };
      const resolvedTarget = targetAnswer.trim();
      if (resolvedTarget) buildConfig.target = resolvedTarget;
      if (parsedArgs) buildConfig.args = parsedArgs;

      runnerData.build = buildConfig;
    }
  }

  return runnerData;
}

/**
 * Registry-driven init: prompts for ecosystems from the plugin registry,
 * per-ecosystem fixer strategy, validation commands, and advisors.
 * Also prompts for OSV/SonarQube scanner config and outputs settings.
 */
export async function runInitCommand(opts: InitCommandOptions): Promise<void> {
  const outputPath = opts.output
    ? resolve(opts.cwd, opts.output)
    : resolve(opts.cwd, DEFAULT_CONFIG_PATH);

  // Check if file already exists — stays in English (fires before language selection)
  if (!opts.force) {
    try {
      await access(outputPath);
      throw new ConfigLoadError(
        `File already exists: ${outputPath}\nUse --force to overwrite.`,
        outputPath,
      );
    } catch (err) {
      // Re-throw our own error
      if (err instanceof ConfigLoadError) throw err;
      // Re-throw unexpected fs errors (e.g. EACCES, EPERM) — only swallow ENOENT
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // File doesn't exist — proceed
    }
  }

  // ─── Language selection (FIRST interactive question) ─────────────────────────

  let reportLanguage: 'pt-br' | 'en' = resolveDefaultLocale();

  if (!opts.nonInteractive) {
    // The label is bilingual because it appears before any locale is resolved
    reportLanguage = await selectPrompt<'pt-br' | 'en'>(
      'Language / Idioma',
      [
        { name: 'English (en)', value: 'en' },
        { name: 'Português (pt-br)', value: 'pt-br' },
      ],
      resolveDefaultLocale(),
    );
  }

  // Set the active locale so all __() calls below return the right language
  setLocale(reportLanguage);

  // ─── Project name and client ──────────────────────────────────────────────────

  const projectName = opts.projectName ?? await prompt(__('Project name'), 'Project');
  const client = opts.client ?? await prompt(__('Client name'), 'Client Name');

  // ─── Ecosystem selection (registry-driven) ───────────────────────────────────

  const allPlugins = defaultRegistry.getAll();
  const detectedIds = await detectEcosystems(opts.cwd, allPlugins);
  let selectedEcosystemIds: string[];

  if (opts.nonInteractive) {
    // Non-interactive: use detected ecosystems when found, otherwise fallback to all (safe for CI/new projects)
    selectedEcosystemIds = detectedIds.size > 0
      ? allPlugins.filter((p) => detectedIds.has(p.id)).map((p) => p.id)
      : allPlugins.map((p) => p.id);
  } else {
    selectedEcosystemIds = await checkboxPrompt(
      __('Select ecosystems to configure (Space to toggle, Enter to confirm)'),
      allPlugins.map((p) => ({ name: `${p.name} (${p.id})`, value: p.id, checked: detectedIds.has(p.id) })),
    );
  }

  // ─── Per-ecosystem config ────────────────────────────────────────────────────

  const ecosystemConfigs: GenerateConfigOptions['ecosystemConfigs'] = [];

  // Fixer strategy descriptions (looked up by fixer ID)
  const fixerDescriptions: Record<string, string> = {
    osv: __('Uses the OSV database to find and apply fixes for known vulnerabilities'),
    'npm-audit': __('Runs npm audit fix to resolve vulnerabilities reported by the npm registry'),
    'osv-then-audit': __('Tries OSV first, then falls back to npm audit fix if needed'),
  };

  for (const id of selectedEcosystemIds) {
    const plugin = defaultRegistry.get(id)!;

    let fixerStrategy: string | undefined;
    if (plugin.supportedFixers.length > 0 && !opts.nonInteractive) {
      fixerStrategy = await selectPrompt(
        __('  [{{plugin}}] Fixer strategy', { plugin: plugin.name }),
        plugin.supportedFixers.map((f) => ({
          name: f,
          value: f,
          description: fixerDescriptions[f],
        })),
      );
    } else if (plugin.supportedFixers.length > 0) {
      fixerStrategy = plugin.supportedFixers[0];
    }

    // Validation commands
    const validationCommands: Array<{ name: string; command: string }> = [];
    const detectedScripts = await detectProjectScripts(opts.cwd, id);

    const NONE_SENTINEL = '__none__';
    if (!opts.nonInteractive) {
      if (detectedScripts.length > 0) {
        // Merge detected scripts with any plugin defaults not already covered
        const detectedNames = new Set(detectedScripts.map((s) => s.name));
        const uncoveredDefaults = plugin.defaultValidationCommands.filter(
          (d) => !detectedNames.has(d.name),
        );

        // Sort all script entries alphabetically (case-insensitive) by name
        const detectedSorted = [...detectedScripts].sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );
        const uncoveredSorted = [...uncoveredDefaults].sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );

        const scriptChoices = [
          ...detectedSorted.map((s) => ({
            name: `${s.name} (${s.command})`,
            value: JSON.stringify({ name: s.name, command: s.command }),
            // Scripts matching 'test' are NOT pre-checked regardless of recommended flag
            checked: s.recommended && !s.name.toLowerCase().includes('test'),
          })),
          ...uncoveredSorted.map((d) => ({
            name: `${d.name} (${d.command})`,
            value: JSON.stringify({ name: d.name, command: d.command }),
            // Uncovered defaults: follow same rule — not pre-checked if name includes 'test'
            checked: !d.name.toLowerCase().includes('test'),
          })),
        ];

        // 'None' sentinel is the FIRST choice, never pre-checked
        const allChoices = [
          {
            name: __('None — skip validation'),
            value: NONE_SENTINEL,
            checked: false,
            description: __('Do not run any validation commands after fixing'),
          },
          ...scriptChoices,
        ];

        const selected = await checkboxPrompt(
          __('  [{{plugin}}] Found {{count}} scripts. Select validation commands (Space to toggle):', { plugin: plugin.name, count: detectedScripts.length }),
          allChoices,
        );

        // If '__none__' selected (or nothing selected), skip validation entirely
        if (!selected.includes(NONE_SENTINEL) && selected.length > 0) {
          for (const raw of selected) {
            const parsed = JSON.parse(raw) as { name: string; command: string };
            validationCommands.push(parsed);
          }
        }
      } else {
        // No scripts detected — fall back to the original confirm-each flow
        for (const defaultCmd of plugin.defaultValidationCommands) {
          const include = await confirmPrompt(
            __('  [{{plugin}}] Include "{{cmdName}}" validation command?', { plugin: plugin.name, cmdName: defaultCmd.name }),
            true,
          );
          if (include) {
            const cmdAnswer = await prompt(
              __('  [{{plugin}}] Validation command "{{cmdName}}"', { plugin: plugin.name, cmdName: defaultCmd.name }),
              defaultCmd.command,
            );
            if (cmdAnswer.trim()) {
              validationCommands.push({ name: defaultCmd.name, command: cmdAnswer.trim() });
            }
          }
        }
      }
    } else {
      // Non-interactive: prefer detected+recommended scripts, else use plugin defaults
      const recommended = detectedScripts.filter((s) => s.recommended);
      if (recommended.length > 0) {
        for (const s of recommended) {
          validationCommands.push({ name: s.name, command: s.command });
        }
      } else {
        validationCommands.push(...plugin.defaultValidationCommands);
      }
    }

    // Advisors
    const advisors: Array<{ name: string; command: string }> = [];
    if (!opts.nonInteractive) {
      for (const defaultAdvisor of plugin.defaultAdvisors) {
        const include = await confirmPrompt(
          __('  [{{plugin}}] Include "{{advisorName}}" advisor?', { plugin: plugin.name, advisorName: defaultAdvisor.name }),
          true,
        );
        if (include) {
          const advisorAnswer = await prompt(
            __('  [{{plugin}}] Advisor "{{advisorName}}" command', { plugin: plugin.name, advisorName: defaultAdvisor.name }),
            defaultAdvisor.command,
          );
          if (advisorAnswer.trim()) {
            advisors.push({ name: defaultAdvisor.name, command: advisorAnswer.trim() });
          }
        }
      }
    } else {
      advisors.push(...plugin.defaultAdvisors);
    }

    // ── Version inference (plugin-native, scoped to selected ecosystems) ──
    const inferredVersion = plugin.inferVersion
      ? await plugin.inferVersion(opts.cwd)
      : undefined;

    // Build per-ecosystem runner object
    const ecosystemVersionPrompts: Record<string, {
      withInferred: string;
      blank: string;
    }> = {
      npm: {
        withInferred: __('  [{{plugin}}] Language version (inferred: {{inferred}}, blank to use detected)', { plugin: plugin.name, inferred: inferredVersion ?? '' }),
        blank: __('  [{{plugin}}] Language version (blank to skip)', { plugin: plugin.name }),
      },
      composer: {
        withInferred: __('  [{{plugin}}] PHP language version (inferred: {{inferred}}, blank to use detected)', { plugin: plugin.name, inferred: inferredVersion ?? '' }),
        blank: __('  [{{plugin}}] PHP language version (blank to skip)', { plugin: plugin.name }),
      },
      pip: {
        withInferred: __('  [{{plugin}}] Python language version (inferred: {{inferred}}, blank to use detected)', { plugin: plugin.name, inferred: inferredVersion ?? '' }),
        blank: __('  [{{plugin}}] Python language version (blank to skip)', { plugin: plugin.name }),
      },
    };

    const versionPrompts = ecosystemVersionPrompts[id];
    const runnerData = versionPrompts
      ? await collectRunnerConfig({
          pluginName: plugin.name,
          nonInteractive: opts.nonInteractive,
          inferredVersion,
          versionPromptWithInferred: versionPrompts.withInferred,
          versionPromptBlank: versionPrompts.blank,
        })
      : {};

    // Only attach runner if there's actual data to include
    const hasRunnerData = Object.keys(runnerData).length > 0;
    ecosystemConfigs.push({
      id,
      fixerStrategy,
      validationCommands,
      advisors,
      ...(hasRunnerData ? { runner: runnerData } : {}),
    });
  }

  // ─── Scanner options ─────────────────────────────────────────────────────────

  let enableSonarQube = false;
  let sonarQubeMode: 'managed' | 'external' = 'managed';
  if (!opts.nonInteractive) {
    enableSonarQube = await confirmPrompt(__('Enable SonarQube scanner?'), false);
    if (enableSonarQube) {
      sonarQubeMode = await selectPrompt<'managed' | 'external'>(
        __('SonarQube mode'),
        [
          {
            name: __('Managed (recommended)'),
            value: 'managed',
            description: __('Provisions an ephemeral SonarQube container via Docker, no server setup needed'),
          },
          {
            name: __('External'),
            value: 'external',
            description: __('Connects to an existing SonarQube server (better performance, no container overhead)'),
          },
        ],
        'managed',
      );
    }
  }

  // ─── Output / report settings ────────────────────────────────────────────────

  let outputsDir: string | undefined;
  let enableMarkdown = true;

  if (!opts.nonInteractive) {
    enableMarkdown = await confirmPrompt(__('Generate markdown reports?'), true);

    if (enableMarkdown) {
      const dirAnswer = await prompt(__('Reports output directory'), DEFAULT_REPORTS_SUBDIR);
      outputsDir = dirAnswer.trim() || DEFAULT_REPORTS_SUBDIR;
    }
  } else {
    outputsDir = DEFAULT_REPORTS_SUBDIR;
  }

  // Determine output formats: markdown when enabled
  const outputFormats: ('markdown')[] = [];
  if (enableMarkdown) outputFormats.push('markdown');

  const json = generateConfigJson({
    projectName,
    client,
    reportLanguage,
    ecosystemConfigs,
    enableSonarQube,
    sonarQubeMode,
    outputs: outputFormats.length > 0 || outputsDir
      ? { formats: outputFormats, dir: outputsDir }
      : undefined,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, json, 'utf-8');
  process.stdout.write(__('Created: {{path}}\n', { path: outputPath }));

  // Write the JSON Schema file so IDEs can provide autocomplete and validation.
  const schemaDir = resolve(opts.cwd, DEFAULT_AUDIT_SUBDIR);
  const schemaOutputPath = resolve(schemaDir, 'config-schema.json');
  await mkdir(schemaDir, { recursive: true });
  const schema = generateJsonSchema();
  await writeFile(schemaOutputPath, JSON.stringify(schema, null, 2), 'utf-8');
  process.stdout.write(__('Created: {{path}}\n', { path: schemaOutputPath }));

  // When SonarQube is enabled, make sure the project has a sonar-project.properties.
  // That file is SonarQube's convention for project-level analysis config (sources,
  // exclusions, project key). We never overwrite an existing one.
  let sonarPropsCreated = false;
  if (enableSonarQube) {
    const status = await writeSonarPropertiesTemplateIfMissing(opts.cwd, {
      projectName,
      ecosystemIds: selectedEcosystemIds,
    });
    if (status === 'created') {
      sonarPropsCreated = true;
      process.stdout.write(__('Created: {{path}}\n', { path: resolve(opts.cwd, 'sonar-project.properties') }));
    } else {
      process.stdout.write(__('Found existing sonar-project.properties (not overwritten)\n'));
    }
  }

  process.stdout.write(__('\nNext steps:\n'));
  process.stdout.write(__('  1. Edit {{path}} to match your project\n', { path: outputPath }));
  process.stdout.write(__('  2. Review protected_packages — add any packages that must not be auto-upgraded\n'));
  if (sonarPropsCreated) {
    process.stdout.write(__('  3. Review sonar-project.properties — adjust sonar.sources and sonar.exclusions for your layout\n'));
    process.stdout.write(__('  4. Run: {{cliName}} scan --cwd <your-project-dir>\n', { cliName: CLI_NAME }));
  } else {
    process.stdout.write(__('  3. Run: {{cliName}} scan --cwd <your-project-dir>\n', { cliName: CLI_NAME }));
  }
  process.stdout.write(__('     (config will be loaded from project-config.yml at project root by default)\n'));
}
