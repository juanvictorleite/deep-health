import type { CommandRunner, CommandRunnerOptions, CommandResult, ExecutionEnv } from '@core/types/common';
import type { EphemeralContainerRunner, ContainerRunResult } from '@infra/provisioner/types';

import type { EcosystemRuntimeSpec } from './types';
import { logger } from '../utils/logger';

// ─── Result mapping ────────────────────────────────────────────────────────────

/** Maps a container run result onto the CommandRunner's CommandResult shape. */
function toCommandResult(result: ContainerRunResult, command: string): CommandResult {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    command,
    dryRun: false,
  };
}

/** Typed presence check for the declared optional `runShell` capability. */
function hasRunShell(
  container: EphemeralContainerRunner<string[]>,
): container is EphemeralContainerRunner<string[]> & Required<Pick<EphemeralContainerRunner<string[]>, 'runShell'>> {
  return typeof container.runShell === 'function';
}

/** Typed presence check for the declared optional `runStreaming` capability. */
function hasRunStreaming(
  container: EphemeralContainerRunner<string[]>,
): container is EphemeralContainerRunner<string[]> & Required<Pick<EphemeralContainerRunner<string[]>, 'runStreaming'>> {
  return typeof container.runStreaming === 'function';
}

/** Dispatch to runStreaming (if supported and stream=true) or plain run. */
async function routeContainerCommand(
  container: EphemeralContainerRunner<string[]>,
  tokens: string[],
  stream: boolean | undefined,
): Promise<ContainerRunResult> {
  if (stream && hasRunStreaming(container)) {
    return container.runStreaming(tokens);
  }
  return container.run(tokens);
}

/**
 * Routes through `container.runShell` when the capability is present and the
 * command is not host-only. Returns undefined when the caller must fall
 * through to the host runner.
 */
async function routeShellCommand(
  container: EphemeralContainerRunner<string[]>,
  invokeCommand: string,
  resultCommand: string,
  cwd: string | undefined,
  isHostOnly: boolean,
): Promise<CommandResult | undefined> {
  if (isHostOnly || !hasRunShell(container)) return undefined;
  logger.tagged('ecosystem-runtime', 'ecosystem-runtime', `routing to container shell: ${invokeCommand}`, 'debug');
  const result = await container.runShell(invokeCommand, { cwd });
  return toCommandResult(result, resultCommand);
}

/**
 * Shared routing decision for `run()`/`runArgs()`: container binary routes to
 * the ephemeral container, otherwise `container.runShell` when available and
 * the command is not host-only, otherwise the host fallback.
 *
 * The container and shell paths each carry their own log/result command
 * strings since `run()` (trimmed) and `runArgs()` (joined) build them
 * slightly differently.
 */
async function routeCommand(
  container: EphemeralContainerRunner<string[]>,
  isContainerBinary: boolean,
  containerTokens: string[],
  stream: boolean | undefined,
  containerLogCommand: string,
  containerResultCommand: string,
  shellInvokeCommand: string,
  shellResultCommand: string,
  cwd: string | undefined,
  isHostOnly: boolean,
  hostFallback: () => Promise<CommandResult>,
): Promise<CommandResult> {
  if (isContainerBinary) {
    logger.tagged('ecosystem-runtime', 'ecosystem-runtime', `routing to container: ${containerLogCommand}`, 'debug');
    const result = await routeContainerCommand(container, containerTokens, stream);
    return toCommandResult(result, containerResultCommand);
  }

  const shellResult = await routeShellCommand(container, shellInvokeCommand, shellResultCommand, cwd, isHostOnly);
  if (shellResult) return shellResult;

  return hostFallback();
}

// ─── Host-only commands ───────────────────────────────────────────────────────

/** Returns true for commands that must always run on the host — never in an ecosystem container. */
function isHostOnlyCommand(bin: string): boolean {
  return bin === 'git' || bin === 'open' || bin === 'gh';
}

// ─── Binary matching ──────────────────────────────────────────────────────────

/**
 * Returns true when `file` is one of the ecosystem's container binaries.
 * Matches bare names (`'npm'`) and absolute paths that end with the binary name
 * (`'/usr/bin/npm'` matches `'npm'`).
 */
function matchesContainerBinary(file: string, binaries: readonly string[]): boolean {
  for (const binary of binaries) {
    if (file === binary || file.endsWith('/' + binary)) return true;
  }
  return false;
}

// ─── EcosystemContainerCommandRunner ─────────────────────────────────────────

/**
 * EcosystemContainerCommandRunner — unified CommandRunner for all ecosystem containers.
 *
 * Parameterized by an `EcosystemRuntimeSpec`, this class replaces (in Batch 3)
 * the three legacy `*ContainerCommandRunner` classes:
 *   - NpmContainerCommandRunner
 *   - PipContainerCommandRunner
 *   - ComposerContainerCommandRunner
 *
 * Routing is driven by `spec.containerBinaries` and `spec.runMode`:
 * - A command whose first token (or `file` argument) matches a container binary
 *   is routed to the container.
 * - Commands that are not host-only may alternatively be routed through
 *   `container.runShell` when available.
 * - All remaining commands (git, open, gh, and anything the container can't handle)
 *   fall through to `hostRunner`.
 *
 * SEC-004 — Container tokenizer trust boundary:
 * The `run(command: string)` path tokenizes via whitespace split and is
 * TRUSTED-STATIC-ONLY: it may only receive compile-time-constant command strings
 * (e.g. "npm audit fix", "pip check"). Variable data (package names, versions,
 * branch names) MUST be passed via `runArgs` so that each token is an independent
 * array element, never reaching a shell or any tokenizer that could be exploited
 * via injection. All callers in this codebase that supply variable data already
 * use `runArgs`.
 */
export class EcosystemContainerCommandRunner implements CommandRunner {
  readonly dryRun: boolean;
  readonly environment: ExecutionEnv = 'docker';

  private readonly container: EphemeralContainerRunner<string[]>;
  private readonly hostRunner: CommandRunner;
  private readonly spec: EcosystemRuntimeSpec;

  constructor(options: {
    container: EphemeralContainerRunner<string[]>;
    hostRunner: CommandRunner;
    spec: EcosystemRuntimeSpec;
    dryRun?: boolean;
  }) {
    this.container = options.container;
    this.hostRunner = options.hostRunner;
    this.spec = options.spec;
    this.dryRun = options.dryRun ?? false;
  }

  async run(command: string, options?: CommandRunnerOptions): Promise<CommandResult> {
    if (this.dryRun) {
      return { stdout: '', stderr: '', exitCode: 0, command, dryRun: true };
    }

    const trimmed = command.trim();
    const tokens = trimmed.match(/\S+/g) ?? [];
    const firstToken = tokens[0] ?? '';
    const isContainerBinary = matchesContainerBinary(firstToken, this.spec.containerBinaries);
    const containerTokens = isContainerBinary ? this._buildContainerTokensFromRun(firstToken, tokens) : [];

    return routeCommand(
      this.container, isContainerBinary, containerTokens, options?.stream,
      trimmed, command, trimmed, command, options?.cwd, isHostOnlyCommand(firstToken),
      () => this.hostRunner.run(command, options),
    );
  }

  async runArgs(file: string, args: string[], options?: CommandRunnerOptions): Promise<CommandResult> {
    const command = `${file} ${args.join(' ')}`;

    if (this.dryRun) {
      return { stdout: '', stderr: '', exitCode: 0, command, dryRun: true };
    }

    const isContainerBinary = matchesContainerBinary(file, this.spec.containerBinaries);
    const containerTokens = isContainerBinary ? this._buildContainerTokensFromRunArgs(file, args) : [];
    const shellCmd = [file, ...args].join(' ');

    return routeCommand(
      this.container, isContainerBinary, containerTokens, options?.stream,
      command, command, shellCmd, shellCmd, options?.cwd, isHostOnlyCommand(file),
      () => this.hostRunner.runArgs(file, args, options),
    );
  }

  /**
   * Build the argv array to pass to `routeContainerCommand` for a `run(command)` call.
   *
   * Argv shape is determined by `spec.runMode.kind`:
   *
   * - `direct-exec`: The underlying DockerRunner prepends the binary itself
   *   (e.g. NpmDockerRunner appends 'npm' before the args internally).
   *   So we strip the binary token from the front and pass only the subcommand args.
   *   Example: run('npm install') → tokens=['npm','install'] → pass ['install']
   *
   * - `shell-wrap`: The underlying DockerRunner passes the joined string to sh -lc
   *   and does NOT prepend any binary. We pass the full token array as-is.
   *   Example: run('pip install requests') → tokens=['pip','install','requests'] → pass ['pip','install','requests']
   */
  private _buildContainerTokensFromRun(firstToken: string, tokens: string[]): string[] {
    if (this.spec.runMode.kind === 'direct-exec') {
      // Strip the leading binary token; the DockerRunner prepends it internally
      return tokens.slice(1);
    }
    // shell-wrap: pass tokens as-is (full command)
    return tokens;
  }

  /**
   * Build the argv array to pass to `routeContainerCommand` for a `runArgs(file, args)` call.
   *
   * Argv shape is determined by `spec.runMode.kind`:
   *
   * - `direct-exec`: The underlying DockerRunner prepends the binary itself.
   *   So we pass only `args` (not `[file, ...args]`).
   *   Example: runArgs('npm', ['install']) → pass ['install']
   *
   * - `shell-wrap`: The underlying DockerRunner sh-wraps the joined string and does
   *   NOT prepend any binary. We pass `[file, ...args]` (full command).
   *   Example: runArgs('pip', ['install', 'requests']) → pass ['pip', 'install', 'requests']
   */
  private _buildContainerTokensFromRunArgs(file: string, args: string[]): string[] {
    if (this.spec.runMode.kind === 'direct-exec') {
      // Strip the binary; the DockerRunner prepends it internally
      return args;
    }
    // shell-wrap: pass [file, ...args] (full command)
    return [file, ...args];
  }
}
