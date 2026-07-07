import { execa } from 'execa';

import { EnvironmentError } from '@core/errors';
import type { CommandRunner, CommandRunnerOptions, CommandResult } from '@core/types/common';

type StdioSetting = readonly ['pipe', 'inherit'] | 'pipe';

interface StreamablePipes {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
}

interface ExecaResultLike {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
}

/**
 * Attach a line-by-line listener to a readable stream, calling `cb` for each
 * non-empty line as data arrives. Used to forward subprocess output in real time
 * to an onLine callback (e.g. logger.info → Listr2 task.output).
 */
function forwardLines(stream: NodeJS.ReadableStream | null, cb: (line: string) => void): void {
  if (!stream) return;
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) cb(line);
    }
  });
  stream.on('end', () => {
    if (buffer.trim()) cb(buffer);
  });
}

/**
 * Resolves the stdout/stderr stdio setting shared by `run()` and `runArgs()`:
 * inherit the terminal when streaming without a line callback, otherwise pipe.
 */
function resolveStdio(options: CommandRunnerOptions): StdioSetting {
  const useInherit = options.stream && !options.onLine;
  return useInherit ? (['pipe', 'inherit'] as const) : ('pipe' as const);
}

/** Wires `options.onLine` (when present) to both subprocess output streams. */
function attachLineForwarding(subprocess: StreamablePipes, options: CommandRunnerOptions): void {
  if (!options.onLine) return;
  const cb = options.onLine;
  forwardLines(subprocess.stdout, cb);
  forwardLines(subprocess.stderr, cb);
}

/** Maps a resolved execa result onto a successful CommandResult. */
function toSuccessResult(result: ExecaResultLike, command: string, startMs: number): CommandResult {
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.exitCode ?? 1,
    command,
    dryRun: false,
    timedOut: result.timedOut ?? false,
    durationMs: Date.now() - startMs,
  };
}

/**
 * Handles a rejected execa call: throws EnvironmentError for ENOENT
 * (binary not found, either on the error directly or on `err.cause`),
 * otherwise returns a failed CommandResult.
 */
function toFailureOutcome(err: unknown, command: string, notFoundLabel: string): CommandResult {
  const isEnoent =
    (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') ||
    (err instanceof Error && (err.cause instanceof Error || (err.cause !== null && typeof err.cause === 'object')) &&
      (err.cause as NodeJS.ErrnoException).code === 'ENOENT');
  if (isEnoent) {
    throw new EnvironmentError(`Command not found: ${notFoundLabel}. Install the tool and try again.`);
  }
  return {
    stdout: '',
    stderr: err instanceof Error ? err.message : String(err),
    exitCode: 1,
    command,
    dryRun: false,
  };
}

export class LocalExecutor implements CommandRunner {
  readonly dryRun: boolean;
  readonly environment = 'local' as const;

  constructor(options: { dryRun?: boolean } = {}) {
    this.dryRun = options.dryRun ?? false;
  }

  async run(command: string, options: CommandRunnerOptions = {}): Promise<CommandResult> {
    if (this.dryRun) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        command,
        dryRun: true,
      };
    }

    try {
      const stdio = resolveStdio(options);
      const startMs = Date.now();
      const subprocess = execa(command, {
        shell: true,
        cwd: options.cwd,
        timeout: options.timeout,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        reject: false,
        stdout: stdio,
        stderr: stdio,
      });
      attachLineForwarding(subprocess, options);
      const result = await subprocess;

      return toSuccessResult(result, command, startMs);
    } catch (err) {
      return toFailureOutcome(err, command, command.split(' ')[0]);
    }
  }

  /**
   * Shell-safe variant: invokes `file` with `args` via execa without a shell,
   * preventing any shell-injection of untrusted values (tokens, branch names, etc.).
   */
  async runArgs(file: string, args: string[], options: CommandRunnerOptions = {}): Promise<CommandResult> {
    const command = `${file} ${args.join(' ')}`;

    if (this.dryRun) {
      return { stdout: '', stderr: '', exitCode: 0, command, dryRun: true };
    }

    try {
      const stdio = resolveStdio(options);
      const startMs = Date.now();
      const subprocess = execa(file, args, {
        shell: false,
        cwd: options.cwd,
        timeout: options.timeout,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        reject: false,
        stdout: stdio,
        stderr: stdio,
      });
      attachLineForwarding(subprocess, options);
      const result = await subprocess;

      return toSuccessResult(result, command, startMs);
    } catch (err) {
      return toFailureOutcome(err, command, file);
    }
  }
}
