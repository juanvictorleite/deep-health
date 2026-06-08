import type { CommandRunner, CommandRunnerOptions, CommandResult } from '@core/types/common';

/**
 * Wraps a CommandRunner and strips `stream: true` from all CommandRunnerOptions.
 *
 * In default (non-verbose) mode, raw subprocess output should not appear on the
 * terminal — listr2 task spinners own the display. Stripping `stream: true`
 * forces captured-only stdio so subprocess output stays silent.
 *
 * `onLine` callbacks are preserved (they route output to task.output, not to
 * the terminal directly). All other options pass through unchanged.
 */
export function createQuietRunner(inner: CommandRunner): CommandRunner {
  function stripStream(options: CommandRunnerOptions | undefined): CommandRunnerOptions | undefined {
    if (!options || options.stream !== true) return options;
    const { stream: _stream, ...rest } = options;
    return rest;
  }

  return {
    get dryRun() {
      return inner.dryRun;
    },
    get environment() {
      return inner.environment;
    },
    run(command: string, options?: CommandRunnerOptions): Promise<CommandResult> {
      return inner.run(command, stripStream(options));
    },
    runArgs(file: string, args: string[], options?: CommandRunnerOptions): Promise<CommandResult> {
      return inner.runArgs(file, args, stripStream(options));
    },
  };
}
