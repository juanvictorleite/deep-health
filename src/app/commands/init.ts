import { writeFile, access, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { DEFAULT_CONFIG_PATH } from '@infra/config/loader';
import { generateConfigJson, type GenerateConfigOptions, type EcosystemRunnerConfig } from '@infra/config/generator';
import { generateJsonSchema } from '@infra/config/schema-export';
import { writeSonarPropertiesTemplateIfMissing } from './sonar-properties-template';
import { prompt } from '@infra/utils/prompt';
import { confirmPrompt, selectPrompt, checkboxPrompt } from '@infra/utils/inquirer-prompts';
import { discoverProject, type DiscoveredEcosystem, type DiscoveredDockerfile } from '@infra/utils/detect-ecosystems';
import { detectProjectScripts } from '@infra/utils/detect-scripts';
import { defaultRegistry } from '@modules/ecosystem/index';
import { ConfigLoadError } from '@core/errors';
import { resolveDefaultLocale } from '@core/locale-detect';
import { CLI_NAME, DEFAULT_AUDIT_SUBDIR, DEFAULT_REPORTS_SUBDIR } from '@infra/brand';
import { __, setLocale } from '@core/i18n';
import { logger } from '@infra/utils/logger';

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
 * Prints a formatted summary of discovered ecosystems when any discovery
 * is in a subdirectory (path !== ''). Root-only discoveries are silent.
 */
function printDiscoverySummary(discoveries: DiscoveredEcosystem[]): void {
  const hasSubdirDiscovery = discoveries.some((eco) => eco.path !== '');
  if (!hasSubdirDiscovery) return;

  logger.info(__('Found {{count}} ecosystem(s):', { count: String(discoveries.length) }));
  for (const eco of discoveries) {
    const plugin = defaultRegistry.get(eco.pluginId);
    const pluginName = plugin ? plugin.name : eco.pluginId;
    const pathLabel = eco.path ? eco.path + '/' : '(root)';
    logger.info(`  ${pluginName.padEnd(12)}${eco.lockfile.padEnd(24)}${pathLabel}`);
  }
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

  // ─── Ecosystem discovery (deep monorepo scanning) ───────────────────────────

  const allPlugins = defaultRegistry.getAll();
  const discovery = await discoverProject(opts.cwd, allPlugins);

  // Show ecosystem discovery summary when subdirectory discoveries exist
  printDiscoverySummary(discovery.ecosystems);

  /**
   * Build a human-readable label for a checkbox choice.
   * Format: "npm — package-lock.json (web/)" or "npm — package-lock.json" for root.
   */
  function formatDiscoveryChoice(eco: DiscoveredEcosystem): string {
    const plugin = defaultRegistry.get(eco.pluginId)!;
    const pathSuffix = eco.path ? ` (${eco.path}/)` : '';
    return `${plugin.name} — ${eco.lockfile}${pathSuffix}`;
  }

  let selectedDiscoveries: DiscoveredEcosystem[];

  if (opts.nonInteractive) {
    // Non-interactive: auto-select all discovered ecosystems; fallback to all plugins at root if none found
    if (discovery.ecosystems.length > 0) {
      selectedDiscoveries = discovery.ecosystems;
    } else {
      // Fallback: create a synthetic discovery entry per plugin at root
      selectedDiscoveries = allPlugins.map((p) => ({
        pluginId: p.id,
        path: '',
        lockfile: p.lockfiles?.[0] ?? '',
        suggestedLabel: undefined,
      }));
    }
  } else {
    const choices = discovery.ecosystems.map((eco, idx) => ({
      name: formatDiscoveryChoice(eco),
      value: String(idx),
      checked: true,
    }));

    // If no ecosystems discovered, fall back to showing all plugins (root-only, unchecked)
    const checkboxChoices = choices.length > 0
      ? choices
      : allPlugins.map((p) => ({
          name: `${p.name} (${p.id})`,
          value: p.id,
          checked: false,
        }));

    const selectedValues = await checkboxPrompt(
      __('Select ecosystems to configure (Space to toggle, Enter to confirm)'),
      checkboxChoices,
    );

    if (choices.length > 0) {
      // Map selected indices back to discovery entries
      selectedDiscoveries = selectedValues
        .map((v) => {
          const idx = parseInt(v, 10);
          return isNaN(idx) ? undefined : discovery.ecosystems[idx];
        })
        .filter((e): e is DiscoveredEcosystem => e !== undefined);
    } else {
      // Fallback: map plugin IDs directly to synthetic root-level discoveries
      const pluginMap = new Map(allPlugins.map((p) => [p.id, p]));
      selectedDiscoveries = selectedValues
        .map((v): DiscoveredEcosystem | undefined => {
          const p = pluginMap.get(v);
          if (!p) return undefined;
          return { pluginId: p.id, path: '', lockfile: p.lockfiles?.[0] ?? '', suggestedLabel: undefined };
        })
        .filter((e): e is DiscoveredEcosystem => e !== undefined);
    }
  }

  // ─── Label assignment for duplicate plugin ids ───────────────────────────────

  // Count occurrences of each pluginId among selected discoveries
  const pluginIdCounts = new Map<string, number>();
  for (const eco of selectedDiscoveries) {
    pluginIdCounts.set(eco.pluginId, (pluginIdCounts.get(eco.pluginId) ?? 0) + 1);
  }

  // Assign labels: entries with duplicate ids get a label; non-duplicates don't
  const discoveryLabels = new Map<DiscoveredEcosystem, string | undefined>();
  for (const eco of selectedDiscoveries) {
    const isDuplicate = (pluginIdCounts.get(eco.pluginId) ?? 0) > 1;
    if (isDuplicate) {
      const suggestedLabel = eco.suggestedLabel ?? eco.path ?? eco.pluginId;
      if (opts.nonInteractive) {
        discoveryLabels.set(eco, suggestedLabel);
      } else {
        const confirmedLabel = await prompt(
          __('  [{{plugin}}] Label for "{{path}}" entry', { plugin: eco.pluginId, path: eco.path || 'root' }),
          suggestedLabel,
        );
        discoveryLabels.set(eco, confirmedLabel.trim() || suggestedLabel);
      }
    } else {
      discoveryLabels.set(eco, undefined);
    }
  }

  // ─── Per-ecosystem config ────────────────────────────────────────────────────

  const ecosystemConfigs: GenerateConfigOptions['ecosystemConfigs'] = [];

  // Fixer strategy descriptions (looked up by fixer ID)
  const fixerDescriptions: Record<string, string> = {
    osv: __('Uses the OSV database to find and apply fixes for known vulnerabilities'),
    'npm-audit': __('Runs npm audit fix to resolve vulnerabilities reported by the npm registry'),
    'osv-then-audit': __('Tries OSV first, then falls back to npm audit fix if needed'),
  };

  for (const discovery_eco of selectedDiscoveries) {
    const id = discovery_eco.pluginId;
    const ecoPath = discovery_eco.path;
    // Resolved absolute path for this ecosystem (used for inferVersion and detectProjectScripts)
    const ecoAbsPath = ecoPath ? resolve(opts.cwd, ecoPath) : opts.cwd;
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

    // Validation commands — use ecosystem's discovered path
    const validationCommands: Array<{ name: string; command: string }> = [];
    const detectedScripts = await detectProjectScripts(ecoAbsPath, id);

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

    // ── Version inference (plugin-native, scoped to ecosystem's discovered path) ──
    const inferredVersion = plugin.inferVersion
      ? await plugin.inferVersion(ecoAbsPath)
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

    // ── Dockerfile association ──
    // Find Dockerfiles whose path is the same as or a parent of this ecosystem's path
    const nearbyDockerfiles: DiscoveredDockerfile[] = discovery.dockerfiles.filter((df) => {
      if (ecoPath === '') {
        // Root ecosystem: only show Dockerfiles at root
        return df.path === '';
      }
      // Non-root: Dockerfile is in same dir as ecosystem or in a parent dir
      const ecoPathNorm = ecoPath.replace(/\\/g, '/');
      const dfPathNorm = df.path.replace(/\\/g, '/');
      return ecoPathNorm === dfPathNorm || ecoPathNorm.startsWith(dfPathNorm + '/');
    });

    let runnerData: EcosystemRunnerConfig;

    const versionPrompts = ecosystemVersionPrompts[id];
    if (versionPrompts) {
      if (!opts.nonInteractive && nearbyDockerfiles.length > 0) {
        // Override the Dockerfile prompt in collectRunnerConfig with our discovered ones
        const dfChoices: Array<{ name: string; value: string; description?: string }> = [
          ...nearbyDockerfiles.map((df) => ({
            name: df.path ? `${df.path}/${df.filename}` : df.filename,
            value: df.path ? `${df.path}/${df.filename}` : df.filename,
          })),
          { name: __('Enter path manually'), value: '__manual__' },
        ];

        const buildMode = await selectPrompt(
          __('  [{{plugin}}] Image mode', { plugin: plugin.name }),
          [
            { name: __('build (recommended)'), value: 'build' as const, description: __('Builds from your project Dockerfile with all tools pre-installed') },
            { name: __('pull'), value: 'pull' as const, description: __('Uses a standard registry image (may lack project-specific tools)') },
          ],
          'build',
        );

        const versionDefault = inferredVersion ?? '';
        const versionPromptMsg = inferredVersion ? versionPrompts.withInferred : versionPrompts.blank;
        const versionAnswer = await prompt(versionPromptMsg, versionDefault);
        const resolvedVersion = versionAnswer.trim() || undefined;

        runnerData = {};
        if (resolvedVersion) runnerData.language_version = resolvedVersion;

        if (buildMode === 'build') {
          let dfPath: string;
          const selectedDf = await selectPrompt(
            __('  [{{plugin}}] Select Dockerfile', { plugin: plugin.name }),
            dfChoices,
            dfChoices[0]!.value,
          );
          if (selectedDf === '__manual__') {
            dfPath = await prompt(__('  [{{plugin}}] Dockerfile path', { plugin: plugin.name }), 'Dockerfile');
            dfPath = dfPath.trim() || 'Dockerfile';
          } else {
            dfPath = selectedDf;
          }
          const ctxAnswer = await prompt(__("  [{{plugin}}] Build context (blank for '.')", { plugin: plugin.name }), '');
          const targetAnswer = await prompt(__('  [{{plugin}}] Build target stage (blank to skip)', { plugin: plugin.name }), '');
          const buildArgsAnswer = await prompt(__('  [{{plugin}}] Build args (KEY=VALUE comma-separated, blank to skip)', { plugin: plugin.name }), '');
          const parsedArgs = parseBuildArgs(buildArgsAnswer);

          const buildConfig: NonNullable<EcosystemRunnerConfig['build']> = {
            dockerfile: dfPath,
            context: ctxAnswer.trim() || '.',
          };
          const resolvedTarget = targetAnswer.trim();
          if (resolvedTarget) buildConfig.target = resolvedTarget;
          if (parsedArgs) buildConfig.args = parsedArgs;

          runnerData.build = buildConfig;
        }
      } else {
        runnerData = await collectRunnerConfig({
          pluginName: plugin.name,
          nonInteractive: opts.nonInteractive,
          inferredVersion,
          versionPromptWithInferred: versionPrompts.withInferred,
          versionPromptBlank: versionPrompts.blank,
        });
      }
    } else {
      runnerData = {};
    }

    // Only attach runner if there's actual data to include
    const hasRunnerData = Object.keys(runnerData).length > 0;
    const entryLabel = discoveryLabels.get(discovery_eco);
    ecosystemConfigs.push({
      id,
      fixerStrategy,
      validationCommands,
      advisors,
      ...(hasRunnerData ? { runner: runnerData } : {}),
      ...(ecoPath ? { path: ecoPath } : {}),
      ...(entryLabel !== undefined ? { label: entryLabel } : {}),
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
      ecosystemIds: [...new Set(selectedDiscoveries.map((e) => e.pluginId))],
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
