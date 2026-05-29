import { writeOutput, formatScanSummary, formatScanSummaryMarkdown } from '@app/output-writer';
import type { RunContext } from '@app/run-context';
import { runScanner } from '@modules/scanner/index';

export interface ScanCommandOptions {
  config: string;
  cwd: string;
  dryRun: boolean;
  verbose: boolean;
  quiet: boolean;
  json: boolean;
  output?: string;
}

/**
 * Runs the vulnerability scan phase.
 * Returns an exit code:
 *   0 — clean
 *   1 — breaking vulnerabilities found
 *   2 — scanner error
 */
export async function runScanCommand(
  ctx: RunContext,
  opts: ScanCommandOptions,
): Promise<number> {
  const { config, runner } = ctx;

  const scanResult = await runScanner(runner, config, opts.cwd);

  let output: string;
  if (opts.json) {
    output = JSON.stringify(scanResult, null, 2);
  } else if (opts.output) {
    output = formatScanSummaryMarkdown(scanResult);
  } else {
    output = formatScanSummary(scanResult);
  }

  await writeOutput(output, opts.output);

  if (scanResult.status === 'error') return 2;
  if (Object.values(scanResult.ecosystems).some((e) => e.breaking > 0)) return 1;
  return 0;
}
