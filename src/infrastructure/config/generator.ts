import Handlebars from 'handlebars';
import type { SupportedLocale } from '@core/types/locale';
import type { OutputFormat } from '@core/types/config';
import configTemplate from './templates/project-config.hbs';

/**
 * Config / init scaffolding generates a declarative project-config.yml.
 *
 * The generated file uses the ecosystems[] format — each ecosystem entry
 * declares its id, fixer strategy, validation commands, and advisors.
 *
 * By contrast, the *runtime* architecture (scan → update → report) is fully
 * registry-extensible: any plugin that implements EcosystemPlugin and registers
 * with `defaultRegistry` is picked up automatically at runtime without changes
 * to this file, the CLI flags, or the orchestrator.
 *
 * TL;DR: add new ecosystems to the plugin registry for runtime support;
 * update this generator only when you want first-class `init` scaffolding.
 */

export interface EcosystemRunnerConfig {
  language_version?: string;
  image_source?: 'pull' | 'dockerfile';
  dockerfile_path?: string;
  build_context?: string;
  build_args?: Record<string, string>;
  allow_build_context_escape?: boolean;
}

export interface EcosystemConfigEntry {
  id: string;
  fixerStrategy?: string;
  validationCommands?: Array<{ name: string; command: string }>;
  advisors?: Array<{ name: string; command: string }>;
  runner?: EcosystemRunnerConfig;
}

export interface GenerateConfigOptions {
  projectName?: string;
  client?: string;
  reportLanguage?: SupportedLocale;
  /**
   * Rich ecosystem config entries (registry-driven from init command).
   * Defaults to both composer and npm when omitted.
   */
  ecosystemConfigs?: EcosystemConfigEntry[];
  /** Whether to add SonarQube scanner block */
  enableSonarQube?: boolean;
  /**
   * SonarQube integration mode.
   * - 'managed' (default): the CLI provisions an ephemeral SonarQube container via Docker.
   * - 'external': connects to an existing SonarQube server (better performance, no container spin-up per scan).
   */
  sonarQubeMode?: 'managed' | 'external';
  /** Outputs config for report generation */
  outputs?: { formats?: OutputFormat[]; dir?: string };
}

const compiled = Handlebars.compile(configTemplate, { noEscape: true });

/**
 * Normalize a project name into a valid SonarQube project_key.
 *
 * SonarQube project keys may only contain letters, digits, hyphens (-),
 * underscores (_), periods (.), and colons (:). Spaces and other special
 * characters are not allowed.
 *
 * Transformation rules (applied in order):
 *  1. Trim leading/trailing whitespace.
 *  2. Replace whitespace runs with a single hyphen.
 *  3. Replace any remaining invalid characters with hyphens.
 *  4. Collapse consecutive hyphens into one.
 *  5. Strip leading/trailing hyphens (underscores/periods/colons are fine at edges per SQ docs).
 *  6. Fall back to 'my-project' if the result is empty.
 *
 * Already-valid keys are returned unchanged (idempotent).
 *
 * @example
 * normalizeSonarProjectKey('My App')          // → 'My-App'
 * normalizeSonarProjectKey('My App!')         // → 'My-App'
 * normalizeSonarProjectKey('org:my-project')  // → 'org:my-project'
 * normalizeSonarProjectKey('   ')             // → 'my-project'
 */
export function normalizeSonarProjectKey(name: string): string {
  let key = name.trim();
  // Replace whitespace runs with hyphens
  key = key.replace(/\s+/g, '-');
  // Replace any character not in [a-zA-Z0-9\-_.:] with a hyphen
  key = key.replace(/[^a-zA-Z0-9\-_.:]/g, '-');
  // Collapse consecutive hyphens
  key = key.replace(/-{2,}/g, '-');
  // Strip leading/trailing hyphens
  key = key.replace(/^-+|-+$/g, '');
  return key || 'my-project';
}

/** Known protected_packages ecosystem entries (id → example values) */
const ECOSYSTEM_EXAMPLES: Record<
  string,
  { examplePackage: string; exampleConstraint: string; exampleReason: string }
> = {
  composer: {
    examplePackage: 'vendor/package',
    exampleConstraint: '^2.0',
    exampleReason: 'Major upgrade requires project-wide migration',
  },
  npm: {
    examplePackage: 'some-package',
    exampleConstraint: '^3.0.0',
    exampleReason: 'v4 has breaking API changes',
  },
  pip: {
    examplePackage: 'requests',
    exampleConstraint: '>=2.31',
    exampleReason: 'Major upgrade requires API migration',
  },
};

/** Default ecosystem entries used when ecosystemConfigs is not provided */
const DEFAULT_ECOSYSTEM_CONFIGS: EcosystemConfigEntry[] = [
  {
    id: 'composer',
    validationCommands: [
      { name: 'tests', command: 'php artisan test --compact' },
    ],
    advisors: [{ name: 'audit', command: 'composer audit' }],
  },
  {
    id: 'npm',
    fixerStrategy: 'osv',
    validationCommands: [{ name: 'build', command: 'npm run build' }],
    advisors: [{ name: 'audit', command: 'npm audit' }],
  },
  {
    id: 'pip',
    validationCommands: [{ name: 'check', command: 'pip check' }],
    advisors: [{ name: 'audit', command: 'pip-audit' }],
  },
];

export function generateConfigYaml(opts: GenerateConfigOptions = {}): string {
  // Resolve ecosystem entries — default to composer+npm when not provided
  const configEntries =
    opts.ecosystemConfigs && opts.ecosystemConfigs.length > 0
      ? opts.ecosystemConfigs
      : DEFAULT_ECOSYSTEM_CONFIGS;

  const ecosystems = configEntries.map((entry) => {
    const runner = entry.runner;
    const hasRunner = !!(
      runner &&
      (runner.language_version ||
        runner.image_source === 'dockerfile' ||
        runner.build_context ||
        runner.build_args)
    );

    // Build template-friendly runner context
    const runnerContext = hasRunner && runner
      ? {
          language_version: runner.language_version,
          // Only emit image_source when it's 'dockerfile'
          image_source: runner.image_source === 'dockerfile' ? 'dockerfile' : undefined,
          dockerfile_path:
            runner.image_source === 'dockerfile' ? runner.dockerfile_path : undefined,
          build_context:
            runner.image_source === 'dockerfile' ? runner.build_context : undefined,
          build_args:
            runner.image_source === 'dockerfile' &&
            runner.build_args &&
            Object.keys(runner.build_args).length > 0
              ? Object.entries(runner.build_args).map(([k, v]) => ({ key: k, value: v }))
              : undefined,
          allow_build_context_escape:
            runner.image_source === 'dockerfile'
              ? runner.allow_build_context_escape
              : undefined,
        }
      : undefined;

    return {
      id: entry.id,
      hasFixer: !!entry.fixerStrategy,
      fixer: entry.fixerStrategy,
      hasValidationCommands: (entry.validationCommands?.length ?? 0) > 0,
      validationCommands: entry.validationCommands ?? [],
      hasAdvisors: (entry.advisors?.length ?? 0) > 0,
      advisors: entry.advisors ?? [],
      hasRunner,
      runner: runnerContext,
    };
  });

  // Resolve selected ecosystem ids for protected_packages
  const selectedIds = ecosystems.map((e) => e.id);

  // Always emit all known ecosystem keys in protected_packages for schema compatibility.
  const allKnownIds = ['composer', 'npm', 'pip'];
  const allIds = [...new Set([...allKnownIds, ...selectedIds])];
  const protectedPackageEcosystems = allIds.map((id) => ({
    id,
    active: selectedIds.includes(id),
    ...(ECOSYSTEM_EXAMPLES[id] ?? {
      examplePackage: 'example/package',
      exampleConstraint: '^1.0',
      exampleReason: 'Version constraint reason',
    }),
  }));

  const outputsConfig = opts.outputs;
  const hasOutputs = !!outputsConfig;
  const outputFormats = outputsConfig?.formats ?? [];
  const outputsDir = outputsConfig?.dir;

  const rawProjectName = opts.projectName ?? 'My Project';

  // Escape single quotes for YAML single-quoted string safety ('' is the only valid escape).
  // Prevents injection via values like O'Brien → O''Brien in the generated YAML.
  const safeProjectName = rawProjectName.replace(/'/g, "''");
  const safeClient = (opts.client ?? 'Client Name').replace(/'/g, "''");

  return compiled({
    projectName: safeProjectName,
    client: safeClient,
    ecosystems,
    reportLanguage: opts.reportLanguage ?? 'pt-br',
    protectedPackageEcosystems,
    enableSonarQube: opts.enableSonarQube ?? false,
    sonarQubeMode: opts.sonarQubeMode ?? 'managed',
    hasOutputs,
    outputFormats,
    outputsDir,
  });
}
