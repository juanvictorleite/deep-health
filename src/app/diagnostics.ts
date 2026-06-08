import { ConfigLoadError, GateValidationError, PhaseError } from '@core/errors';
import { __ } from '@core/i18n';
import { CLI_NAME } from '@infra/brand';

/**
 * Structured CLI error result — pure, no side effects.
 */
export interface CliErrorResult {
  /** Human-readable message for stderr */
  message: string;
  /** Process exit code */
  exitCode: number;
  /** Optional actionable hint lines shown after the main message */
  hints?: string[];
}

/**
 * Maps any thrown error to a { message, exitCode, hints? } pair.
 *
 * Exit code semantics (preserved from original runCliAction):
 *   0 — success (not an error; not produced here)
 *   1 — vulnerabilities / update errors (returned by handler, not thrown)
 *   2 — GateValidationError | PhaseError | unexpected error
 *   3 — ConfigLoadError
 *
 * Pure function — does not write to stderr or call process.exit.
 */
export function formatCliError(err: unknown): CliErrorResult {
  if (err instanceof ConfigLoadError) {
    const hints: string[] | undefined = err.message.includes('Cannot read')
      ? [
          __('Get started:  {{cliName}} init', { cliName: CLI_NAME }),
          __('Learn more:   {{cliName}} --help', { cliName: CLI_NAME }),
        ]
      : undefined;

    return {
      message: `Configuration error: ${err.message}`,
      exitCode: 3,
      ...(hints !== undefined && { hints }),
    };
  }

  if (err instanceof GateValidationError) {
    const gateName =
      err.gate === 'A'
        ? __('Scan validation')
        : __('Ecosystem {{gate}} validation', { gate: err.gate });

    const lines = [`${gateName} failed:`, ...err.errors.map((e) => `  - ${e}`)];
    const hints: string[] = [
      __('This usually means the scanner produced unexpected output.'),
      __('Try: {{cliName}} scan --verbose', { cliName: CLI_NAME }),
      __('Or:  {{cliName}} fix --dry-run', { cliName: CLI_NAME }),
    ];

    return {
      message: lines.join('\n'),
      exitCode: 2,
      hints,
    };
  }

  if (err instanceof PhaseError) {
    let hints: string[];

    if (err.message.includes('exit code 137') || err.message.toLowerCase().includes('killed')) {
      hints = [
        __('This may indicate the Docker container ran out of memory.'),
        __('Try increasing Docker memory limits in Docker Desktop settings.'),
      ];
    } else if (err.phase === 'ecosystem-fix') {
      hints = [
        __('Try running only specific phases:'),
        __('  {{cliName}} fix --phases scan', { cliName: CLI_NAME }),
      ];
    } else {
      hints = [__('Run with --verbose for more details: {{cliName}} --verbose', { cliName: CLI_NAME })];
    }

    return {
      message: `Phase "${err.phase}" failed: ${err.message}`,
      exitCode: 2,
      hints,
    };
  }

  return {
    message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    exitCode: 2,
  };
}
