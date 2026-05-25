import type { SupportedLocale } from '@core/types/locale';
import type { OutputFormat } from '@core/types/config';

/**
 * Config / init scaffolding generates a declarative security-scan.config.json.
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

/**
 * Build the runner object for a single ecosystem entry.
 *
 * Returns undefined when no meaningful runner configuration is present so the
 * object can skip the runner field entirely.
 */
function buildRunnerObject(
  runner: EcosystemRunnerConfig,
): Record<string, unknown> | undefined {
  const isDockerfile = runner.image_source === 'dockerfile';
  const hasRunner = !!(
    runner.language_version ||
    isDockerfile ||
    runner.build_context ||
    runner.build_args
  );

  if (!hasRunner) return undefined;

  const result: Record<string, unknown> = {};

  if (runner.language_version !== undefined) {
    result['language_version'] = runner.language_version;
  }

  // Only emit image_source when it is 'dockerfile'
  if (isDockerfile) {
    result['image_source'] = 'dockerfile';
    if (runner.dockerfile_path !== undefined) {
      result['dockerfile_path'] = runner.dockerfile_path;
    }
    if (runner.build_context !== undefined) {
      result['build_context'] = runner.build_context;
    }
    if (runner.build_args && Object.keys(runner.build_args).length > 0) {
      result['build_args'] = runner.build_args;
    }
    if (runner.allow_build_context_escape !== undefined) {
      result['allow_build_context_escape'] = runner.allow_build_context_escape;
    }
  }

  return result;
}

/**
 * Build the ecosystem object for a single ecosystem config entry.
 */
function buildEcosystemObject(entry: EcosystemConfigEntry): Record<string, unknown> {
  const obj: Record<string, unknown> = { id: entry.id };

  if (entry.fixerStrategy !== undefined) {
    obj['fixer'] = entry.fixerStrategy;
  }

  obj['validationCommands'] = entry.validationCommands ?? [];

  if (entry.advisors && entry.advisors.length > 0) {
    obj['advisors'] = entry.advisors;
  }

  if (entry.runner) {
    const runnerObj = buildRunnerObject(entry.runner);
    if (runnerObj !== undefined) {
      obj['runner'] = runnerObj;
    }
  }

  return obj;
}

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

export function generateConfigJson(opts: GenerateConfigOptions = {}): string {
  // Resolve ecosystem entries — default to composer+npm+pip when not provided
  const configEntries =
    opts.ecosystemConfigs && opts.ecosystemConfigs.length > 0
      ? opts.ecosystemConfigs
      : DEFAULT_ECOSYSTEM_CONFIGS;

  const ecosystems = configEntries.map(buildEcosystemObject);

  // Resolve selected ecosystem ids for protected_packages
  const selectedIds = configEntries.map((e) => e.id);

  // Always emit all known ecosystem keys in protected_packages for schema compatibility.
  const allKnownIds = ['composer', 'npm', 'pip'];
  const allIds = [...new Set([...allKnownIds, ...selectedIds])];

  const protectedPackages: Record<string, unknown[]> = {};
  for (const id of allIds) {
    protectedPackages[id] = [];
  }

  // Build optional scanners block
  const scanners: Record<string, unknown> = {};
  if (opts.enableSonarQube) {
    scanners['sonarqube'] = {
      enabled: true,
      mode: opts.sonarQubeMode ?? 'managed',
      on_failure: 'warn',
    };
  }

  // Build optional outputs block
  let outputsObj: Record<string, unknown> | undefined;
  if (opts.outputs) {
    outputsObj = {};
    if (opts.outputs.formats && opts.outputs.formats.length > 0) {
      outputsObj['formats'] = opts.outputs.formats;
    }
    if (opts.outputs.dir !== undefined) {
      outputsObj['dir'] = opts.outputs.dir;
    }
  }

  // Assemble the full config object — $schema field goes first for IDE autocomplete
  const config: Record<string, unknown> = {
    $schema: './node_modules/@anthropic/osv-security-cli/config-schema.json',
    config_version: '1',
    project: {
      name: opts.projectName ?? 'My Project',
      client: opts.client ?? 'Client Name',
    },
    ecosystems,
    protected_packages: protectedPackages,
    safe_update_policy: {
      allow_patch_and_minor_within_constraints: true,
      require_authorization_for_constraint_change: true,
    },
    conflict_resolution: 'stop_and_ask',
    report_language: opts.reportLanguage ?? 'pt-br',
  };

  if (outputsObj !== undefined) {
    config['outputs'] = outputsObj;
  }

  if (Object.keys(scanners).length > 0) {
    config['scanners'] = scanners;
  }

  return JSON.stringify(config, null, 2);
}

// Re-export under legacy name for any callers that haven't been updated yet
// (removed when all call sites are migrated)
export { generateConfigJson as generateConfigYaml };
