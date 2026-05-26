import { CLI_NAME } from '@infra/brand';
import { __ } from '@core/i18n';
import { z } from "zod";

const ProtectedPackageSchema = z
  .object({
    package: z.string(),
    constraint: z.string(),
    reason: z.string(),
  })
  .strict();

/**
 * Fixer strategy identifier.
 * - 'osv' (default for npm): OSV in-place fix coordinated by the orchestrator.
 * - 'npm-audit': `npm audit fix` approach (OSV fix is skipped).
 */
const FixerStrategyIdSchema = z.enum(["osv", "npm-audit", "osv-then-audit"]);

/** Advisor command config */
const AdvisorConfigSchema = z
  .object({
    name: z.string().max(200),
    command: z.string().max(1000),
    format: z.enum(["json", "text"]).optional(),
  })
  .strict();

/**
 * Validation command config.
 * ⚠ SECURITY: commands execute as shell commands (shell: true) on the operator's host,
 * inheriting the full process environment. Treat this as an executable trust boundary —
 * operators configure these, and external/untrusted data must never be interpolated
 * into command strings. See also: src/modules/ecosystem/utils/validation-runner.ts.
 */
const ValidationCommandConfigSchema = z
  .object({
    name: z.string().max(200),
    command: z.string().max(1000),
    timeout_seconds: z.number().int().positive().optional().default(300),
  })
  .strict();

const DockerImageRefSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9./_:@-]*$/,
    'Docker image reference must be lowercase and contain only alphanumeric characters, dots, slashes, colons, at-signs, and hyphens',
  );

/** OSV scanner engine config */
const OsvScannerConfigSchema = z
  .object({
    args: z.array(z.string()).optional(),
    /**
     * Runner selection (default: 'docker'):
     * - 'docker' (default): always use an ephemeral Docker container.
     * - 'local': require a locally installed osv-scanner binary. ⚠ Emits a warning.
     */
    runner: z.enum(["local", "docker"]).default("docker"),
    /**
     * Docker image for the OSV container (used when runner is 'docker').
     * Defaults to 'ghcr.io/google/osv-scanner:latest'.
     */
    image: DockerImageRefSchema.optional(),
  })
  .strict();

/**
 * Validates a single Debian/apt package name.
 * Debian policy: starts with alphanumeric, followed by alphanumeric, hyphens,
 * dots, or plus signs. Rejects shell metacharacters that would break preamble injection.
 */
const DebianPackageNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9+.\-]*$/,
    'Invalid package name — must follow Debian naming conventions (lowercase alphanumeric, hyphens, dots, plus signs only)',
  );

const NativeDepsSchema = z.array(DebianPackageNameSchema).optional();

const BuildArgsSchema = z.record(
  z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'Build arg key must be uppercase letters, digits, and underscores'),
  z.string().regex(/^[^\n\r]*$/, 'Build arg value must not contain newlines'),
);

/**
 * Validates a dockerfile_path value:
 * - Must not start with './' (use 'Dockerfile' or 'docker/Dockerfile', not './Dockerfile')
 * - Must not start with '../'
 * - Must not contain '..' segments (path traversal prevention)
 *
 * Paths like '.docker/node.Dockerfile' are valid — they start with '.' but NOT './'.
 */
const DockerfilePathSchema = z.string().superRefine((val, ctx) => {
  if (val.startsWith('./')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'dockerfile_path must not start with ./ — use a relative path without the dot-slash prefix (e.g. Dockerfile)',
    });
  }
  if (val.startsWith('../')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'dockerfile_path must not start with ../ — parent directory traversal is not allowed (e.g. use docker/Dockerfile instead)',
    });
  }
  if (val.split('/').some((seg) => seg === '..')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'dockerfile_path must not contain .. segments',
    });
  }
});

/**
 * Docker Compose-like build configuration for runner images.
 * `dockerfile` is required; all other fields are optional.
 */
const BuildConfigSchema = z
  .object({
    dockerfile: DockerfilePathSchema,
    context: z.string().optional(),
    target: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'build.target must only contain alphanumeric characters, underscores, and hyphens').optional(),
    args: BuildArgsSchema.optional(),
    allow_context_escape: z.boolean().optional(),
  })
  .strict();

/** npm runner config */
const NpmRunnerConfigSchema = z
  .object({
    /**
     * Docker image to use for the npm container.
     * Defaults to a version-resolved image (e.g. 'node:20'), falling back to 'node:lts'.
     * Takes precedence over language_version.
     * When `build` is also set, this becomes the tag for the built image.
     */
    image: DockerImageRefSchema.optional(),
    /**
     * Node.js language version hint used to resolve the Docker image when `image` is not set.
     * Example: '20', '20.11', '20.11.1'.
     * Overrides the version inferred from project files.
     * Set by `security-scan init` when a Node version can be inferred automatically.
     */
    language_version: z.string().optional(),
    /**
     * Docker Compose-like build configuration.
     * When present, the image is built from the specified Dockerfile.
     * When both `image` and `build` are set, the image is built and tagged
     * with the custom image name.
     */
    build: BuildConfigSchema.optional(),
    /**
     * OS-level packages to install via apt-get before running npm commands.
     * Useful for native addons that require system libraries (e.g. sharp → libvips-dev).
     * Example: [libvips-dev, build-essential, python3]
     */
    native_deps: NativeDepsSchema,
  })
  .strict();

/** Output format — markdown or docx for reports */
const OutputFormatSchema = z.enum(["markdown", "docx"]);

/** Outputs config block */
const OutputsConfigSchema = z
  .object({
    formats: z.array(OutputFormatSchema).optional(),
    dir: z.string().optional(),
    /**
     * When true, engine-specific reports are written to sub-folders:
     *   - SonarQube artifacts → {dir}/sonarqube/
     * Consolidated and executive reports remain at the root level.
     * Defaults to false.
     */
    sub_folders: z.boolean().optional(),
    /**
     * When true, generates one report per ecosystem entry instead of a consolidated report.
     * Equivalent to --split-reports CLI flag. CLI flag takes precedence.
     * Defaults to false.
     */
    split_reports: z.boolean().optional(),
  })
  .strict();

/**
 * SonarQube config — CLI-side concerns only.
 *
 * Project-level configuration (project_key, sources, exclusions, host_url,
 * credentials) lives in the project's `sonar-project.properties` file, which
 * is the SonarQube-community convention. The CLI reads that file at scan time.
 *
 * What stays here: orchestration policy (on_failure), runtime dispatch (mode),
 * infra choices (scanner_image), and CLI feature flags (send_branch_name,
 * ce_task_timeout_seconds).
 *
 * In managed mode, the CLI overrides `sonar.host.url` and `sonar.token` with
 * values generated at runtime; `sonar.login`/`sonar.password` are always
 * stripped from the properties file (sonar-scanner 5+ errors when they exist).
 */
const SonarQubeConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    /**
     * 'external' (default): sonar-scanner connects to a pre-existing SonarQube
     *   instance — host URL and project key come from sonar-project.properties;
     *   token comes from the SONAR_TOKEN env var.
     * 'managed': the CLI provisions an ephemeral SonarQube CE container via
     *   Docker, generates a token via the admin API, overrides host.url+token
     *   at the CLI layer, runs the scan, tears the container down.
     */
    mode: z.enum(["external", "managed"]).default("external"),
    on_failure: z.enum(["warn", "fail"]).default("warn"),
    /**
     * Docker image tag for the sonar-scanner-cli container (managed mode fallback
     * when local sonar-scanner is not installed). Defaults to
     * 'sonarsource/sonar-scanner-cli:latest'.
     */
    scanner_image: DockerImageRefSchema.optional(),
    /**
     * Docker image for the SonarQube Community Edition server container.
     * Only used in managed mode — ignored in external mode.
     * Distinct from scanner_image (sonar-scanner-cli); this controls the server
     * that sonar-scanner connects to.
     * Default: 'sonarqube:lts-community'.
     */
    server_image: DockerImageRefSchema.optional(),
    /**
     * When true, forwards the detected git branch as -Dsonar.branch.name to sonar-scanner.
     * Requires SonarQube Developer Edition or higher — Community Edition does NOT support
     * branch analysis and will fail if this property is forwarded.
     * Defaults to false (CE-safe).
     */
    send_branch_name: z.boolean().default(false),
    /**
     * Maximum seconds to wait for the SonarQube Compute Engine (CE) task to complete
     * before fetching the quality gate status.  Defaults to 120.  Set to 0 to disable.
     */
    ce_task_timeout_seconds: z.number().int().nonnegative().default(120),
    /**
     * Maximum seconds the sonar-scanner subprocess may run before being killed.
     * Applies to both local and container sonar-scanner execution.
     * Defaults to 300 (5 minutes).
     */
    scanner_timeout_seconds: z.number().int().positive().optional(),
    /**
     * When true (default), auto-scales timeouts based on ncloc from previous analysis.
     */
    dynamic_timeout: z.boolean().default(true),
    /**
     * Per-kloc multipliers for dynamic timeout scaling.
     */
    timeout_scale: z.object({
      scanner_seconds_per_kloc: z.number().positive().default(3),
      ce_seconds_per_kloc: z.number().positive().default(1.5),
    }).default({}),
    /**
     * JVM options passed to sonar-scanner via the SONAR_SCANNER_OPTS environment variable.
     * Use this to increase heap for large codebases.
     * Example: "-Xmx2048m" for 2GB heap.
     */
    scanner_jvm_opts: z.string().optional(),
  })
  .strict();

/** pip runner config */
const PipRunnerConfigSchema = z
  .object({
    /**
     * Docker image to use for the pip container.
     * Defaults to a version-resolved image (e.g. 'python:3.11-slim'), falling back to 'python:3-slim'.
     * Takes precedence over language_version.
     * When `build` is also set, this becomes the tag for the built image.
     */
    image: DockerImageRefSchema.optional(),
    /**
     * Python language version hint used to resolve the Docker image when `image` is not set.
     * Example: '3.11', '3.11.2'.
     * Overrides the version inferred from project files.
     */
    language_version: z.string().optional(),
    /**
     * Docker Compose-like build configuration.
     * When present, the image is built from the specified Dockerfile.
     * When both `image` and `build` are set, the image is built and tagged
     * with the custom image name.
     */
    build: BuildConfigSchema.optional(),
    /**
     * OS-level packages to install via apt-get before running pip commands.
     * Useful for packages with C extensions that require system libraries.
     */
    native_deps: NativeDepsSchema,
  })
  .strict();

/** composer runner config */
const ComposerRunnerConfigSchema = z
  .object({
    /**
     * Docker image to use for the composer container.
     * Defaults to a version-resolved image (e.g. 'php:8.2-cli'), falling back to 'composer:2'.
     * Takes precedence over language_version.
     * When `build` is also set, this becomes the tag for the built image.
     */
    image: DockerImageRefSchema.optional(),
    /**
     * PHP language version hint used to resolve the Docker image when `image` is not set.
     * Example: '8.2', '8.2.1'.
     * Overrides the version inferred from project files (.php-version / composer.json#require.php).
     * Set by `security-scan init` when a PHP version can be inferred automatically.
     */
    language_version: z.string().optional(),
    /**
     * Docker Compose-like build configuration.
     * When present, the image is built from the specified Dockerfile.
     * When both `image` and `build` are set, the image is built and tagged
     * with the custom image name.
     */
    build: BuildConfigSchema.optional(),
    /**
     * OS-level packages to install via apt-get before running composer commands.
     * Useful for PHP extensions that require system libraries.
     */
    native_deps: NativeDepsSchema,
  })
  .strict();

/**
 * Union of all per-ecosystem runner configs.
 * Used by EcosystemConfigSchema to type the optional inline runner field.
 */
const EcosystemRunnerConfigSchema = z.union([
  NpmRunnerConfigSchema,
  PipRunnerConfigSchema,
  ComposerRunnerConfigSchema,
]);

/**
 * Declarative ecosystem config entry.
 * Each entry declares an ecosystem id plus optional inline runner, fixer,
 * validation commands, and advisor commands.
 */
const EcosystemConfigSchema = z
  .object({
    id: z.string(),
    fixer: FixerStrategyIdSchema.optional(),
    validationCommands: z.array(ValidationCommandConfigSchema).optional(),
    advisors: z.array(AdvisorConfigSchema).optional(),
    runner: EcosystemRunnerConfigSchema.optional(),
    /**
     * Subdirectory path where this ecosystem's lockfile lives (monorepo support).
     * Must be a relative path: no leading `./`, no leading `/`, no `..` segments,
     * no glob characters. When absent, the ecosystem is treated as root.
     */
    path: z
      .string()
      .superRefine((val, ctx) => {
        if (val.startsWith('/')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: __('ecosystem path must be relative (no leading /)'),
          });
        }
        if (val.startsWith('./')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: __('ecosystem path must not start with ./'),
          });
        }
        if (val.split('/').some((seg) => seg === '..')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: __('ecosystem path must not contain .. segments'),
          });
        }
        if (/[*?]/.test(val)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: __('ecosystem path must not contain glob characters (* or ?)'),
          });
        }
        if (/\s/.test(val)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: __('ecosystem path must not contain whitespace'),
          });
        }
      })
      .optional(),
    /**
     * Human-readable label to distinguish multiple instances of the same
     * ecosystem in a monorepo (e.g. "frontend", "backend").
     * Required when two or more entries share the same `id`.
     * Must match ^[a-z0-9-]+$ (lowercase alphanumeric and hyphens only).
     */
    label: z
      .string()
      .regex(
        /^[a-z0-9-]+$/,
        __('label must contain only lowercase letters, digits, and hyphens'),
      )
      .optional(),
  })
  .strict();

const ScannersConfigSchema = z
  .object({
    sonarqube: SonarQubeConfigSchema.optional(),
    osv: OsvScannerConfigSchema.optional(),
    primary: z.string().optional(),
  })
  .strict();

/**
 * Scan path configuration — controls which paths osv-scanner inspects.
 *
 * Entries in `paths` are validated at schema level and again at runtime:
 * - No leading `/` (must be relative to /project inside the container)
 * - No `..` segments (path traversal prevention)
 * - No glob patterns (`*`, `?`) — use directory paths ending with `/` instead
 */
const ScanPathsConfigSchema = z.object({
  auto_discover: z.boolean().default(true),
  paths: z.array(
    z.string().superRefine((val, ctx) => {
      if (val.startsWith('/')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'scan.paths entries must be relative (no leading /)',
        });
      }
      if (val.split('/').some((seg) => seg === '..')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'scan.paths entries must not contain .. segments',
        });
      }
      if (/[*?]/.test(val)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'scan.paths does not support glob patterns — use a directory path ending with / instead (e.g. "app/")',
        });
      }
    }),
  ).optional(),
  exclude: z.array(z.string()).optional(),
}).strict();

const WorkflowConfigSchema = z
  .object({
    /**
     * Create a git branch before applying fixes, commit on success, and roll
     * back (delete branch + restore original) on failure.
     * Default: false.
     */
    create_branch: z.boolean().optional(),
    /**
     * Push the fix branch and open a GitHub PR via the `gh` CLI after a
     * successful run.  Implies create_branch.  Requires `gh` installed and
     * authenticated.
     * Default: false.
     */
    open_pr: z.boolean().optional(),
    /**
     * Prefix for the generated branch name.
     * Full name: <branch_prefix><ISO-timestamp>.
     * Default: 'fix/security-scan-'.
     */
    branch_prefix: z.string().regex(/^[a-zA-Z0-9]/, 'branch_prefix must not start with a dash or special character').optional(),
    /** Pull request title override. Auto-generated when absent. */
    pr_title: z.string().optional(),
  })
  .strict();

const CloudStorageConfigSchema = z
  .object({
    provider: z.enum(["google_drive"]),
    folder_id: z.string().regex(/^[A-Za-z0-9_-]{10,}$/, 'folder_id must be at least 10 alphanumeric, dash, or underscore characters'),
    /**
     * When true, fix/executive-report commands will fail if cloud upload fails.
     * Default: false (cloud upload failure is non-fatal — warns to stderr).
     */
    require_upload: z.boolean().default(false),
  })
  .strict();

const SafeUpdatePolicySchema = z
  .object({
    allow_patch_and_minor_within_constraints: z.boolean(),
    require_authorization_for_constraint_change: z.boolean(),
  })
  .strict();

export const ProjectConfigSchema = z
  .object({
    /**
     * Schema version for forward-compatibility detection.
     * - Absent: treated as version "1" (backward compatible with pre-versioning configs).
     * - "1": current supported version.
     * - Any other value: rejected with a user-friendly message suggesting `security-scan init --force`.
     */
    config_version: z.string().optional(),
    project: z
      .object({
        name: z.string().regex(/^[^\n\r]+$/, 'project.name must not contain newlines'),
        client: z.string().regex(/^[^\n\r]+$/, 'project.client must not contain newlines'),
      })
      .strict(),
    /**
     * At least one ecosystem must be declared.
     * Each entry must have a unique id (validated at runtime by the plugin registry).
     */
    ecosystems: z.array(EcosystemConfigSchema).min(1, {
      message: "At least one ecosystem must be configured in ecosystems[]",
    }),
    /** Per-ecosystem protected packages. Keys are ecosystem ids ('npm', 'composer', …). */
    protected_packages: z.record(z.array(ProtectedPackageSchema)),
    safe_update_policy: SafeUpdatePolicySchema,
    conflict_resolution: z.string(),
    report_language: z.enum(["pt-br", "en"]).optional(),
    cloud_storage: CloudStorageConfigSchema.optional(),
    scan: ScanPathsConfigSchema.optional(),
    scanners: ScannersConfigSchema.optional(),
    outputs: OutputsConfigSchema.optional(),
    workflow: WorkflowConfigSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.config_version !== undefined && data.config_version !== "1") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `Unsupported config_version "${data.config_version}". ` +
          `This version of ${CLI_NAME} supports config_version "1". ` +
          `Run "${CLI_NAME} init --force" to regenerate a compatible config.`,
      });
    }

    // Build a map of id -> entries for duplicate-id validation.
    const idGroups = new Map<string, typeof data.ecosystems>();
    for (const entry of data.ecosystems) {
      const group = idGroups.get(entry.id);
      if (group) {
        group.push(entry);
      } else {
        idGroups.set(entry.id, [entry]);
      }
    }

    for (const [id, entries] of idGroups) {
      if (entries.length < 2) continue;

      // When multiple entries share the same id, every entry must have a label.
      const missingLabel = entries.some((e) => e.label === undefined);
      if (missingLabel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: __(
            'Each ecosystem entry with id "{{id}}" must have a distinct label when multiple entries share the same id',
            { id },
          ),
        });
        continue;
      }

      // Labels must be distinct within the same id group.
      const labels = entries.map((e) => e.label as string);
      const seen = new Set<string>();
      for (const lbl of labels) {
        if (seen.has(lbl)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: __(
              'Duplicate ecosystem entry: id "{{id}}" with label "{{label}}" appears more than once',
              { id, label: lbl },
            ),
          });
        }
        seen.add(lbl);
      }
    }
  });

export type ProjectConfigInput = z.input<typeof ProjectConfigSchema>;
