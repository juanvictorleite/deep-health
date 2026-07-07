import { writeAuditTrail, resolveCliVersion } from "@app/audit-trail";
import type { BreakingWarningEntry } from "@app/fix-summary";
import { formatFixSummary, formatBreakingWarning } from "@app/fix-summary";
import { writeOutput } from "@app/output-writer";
import { selectRenderer } from "@app/progress-reporter";
import { generateAndSaveReportArtifacts } from "@app/report-artifacts";
import {
  resolveReportsDir,
} from "@app/report-saver";
import type { RunContext } from "@app/run-context";
import { __ } from "@core/i18n";
import type { CommandRunner } from "@core/types/common";
import { ecosystemEntryKey } from "@core/types/config";
import type { ProjectConfig } from "@core/types/config";
import type { ScanResultJson } from "@core/types/scan";
import { CLI_NAME, DEFAULT_BRANCH_PREFIX } from "@infra/brand";
import { detectGitBranch } from "@infra/utils/git-branch";
import { createBranchAndCommit, buildBranchName } from "@infra/utils/git-commit";
import { defaultRegistry } from "@modules/ecosystem/index";
import type { OrchestratorOptions, OrchestratorResult } from "@orchestration/orchestrator";
import { runOrchestrator } from "@orchestration/orchestrator";

export interface FixCommandOptions {
  config: string;
  cwd: string;
  dryRun: boolean;
  verbose: boolean;
  quiet: boolean;
  json: boolean;
  output?: string;
  phases?: string;
  noReport?: boolean;
  /**
   * Generic: ecosystem ids to authorize breaking changes for.
   * Populated by --authorize-breaking <id...>
   */
  authorizeBreaking?: string[];
  /** Create a git branch before applying fixes and commit changes on success */
  createBranch?: boolean;
  /** Branch name prefix (default: 'fix/security-scan-') */
  branchPrefix?: string;
  /** Create a GitHub pull request after fix (implies createBranch; requires gh CLI) */
  openPr?: boolean;
  /** Pull request title (default: auto-generated) */
  prTitle?: string;
  /**
   * When true, generates one report per ecosystem entry instead of a consolidated report.
   * Overrides outputs.split_reports from config when provided.
   */
  splitReports?: boolean;
}

type FixPhase = "scan" | "npm" | "composer" | "report";

function parsePhases(phases: string | undefined): FixPhase[] | undefined {
  return phases ? (phases.split(",") as FixPhase[]) : undefined;
}

/**
 * Builds the per-plugin authorization record for the orchestrator. A second pass folds in
 * raw --authorize-breaking values verbatim (including entryKey-format ids like 'npm:frontend')
 * so the orchestrator can match authorization by entryKey even for ids outside the registry.
 */
function buildAuthorizeBreakingRecord(authorizedIds: Set<string>): Record<string, boolean> {
  const record: Record<string, boolean> = {};
  for (const plugin of defaultRegistry.getAll()) {
    record[plugin.id] = authorizedIds.has(plugin.id);
  }
  for (const id of authorizedIds) {
    record[id] = true;
  }
  return record;
}

/**
 * Reads the breaking-vuln count and package list for one ecosystem entry, defaulting
 * missing/undefined fields the same way the original inline lookup did (`?? 0` / `?? []`).
 */
function resolveEntryBreakingStats(
  scan: ScanResultJson,
  entryKey: string,
): { breaking: number; packages: string[] } {
  const entryScan = scan.ecosystems[entryKey];
  return {
    breaking: entryScan?.breaking ?? 0,
    packages: entryScan?.breaking_packages ?? [],
  };
}

/** Returns a warning entry for `ecoEntry` when it has unauthorized breaking vulns, else null. */
function resolveBreakingEntry(
  ecoEntry: ProjectConfig['ecosystems'][number],
  scan: ScanResultJson,
  authorizedIds: Set<string>,
): BreakingWarningEntry | null {
  const plugin = defaultRegistry.get(ecoEntry.id);
  if (!plugin) return null;

  const entryKey = ecosystemEntryKey(ecoEntry);
  const { breaking, packages } = resolveEntryBreakingStats(scan, entryKey);
  const isAuthorized = authorizedIds.has(ecoEntry.id) || authorizedIds.has(entryKey);
  if (breaking <= 0 || isAuthorized) return null;

  return { pluginName: plugin.name, entryKey, count: breaking, packages };
}

/**
 * Emits a non-blocking stderr warning for ecosystems with breaking vulns left unauthorized.
 * Uses `scan` from the orchestrator's Gate A result (the canonical before-fix snapshot) —
 * NOT a standalone re-scan — and iterates config.ecosystems so the lookup key matches the
 * per-entry scan result.
 */
function warnOnUnauthorizedBreakingChanges(
  config: ProjectConfig,
  scan: ScanResultJson,
  authorizedIds: Set<string>,
): void {
  const breakingEntries = config.ecosystems
    .map((ecoEntry) => resolveBreakingEntry(ecoEntry, scan, authorizedIds))
    .filter((entry): entry is BreakingWarningEntry => entry !== null);

  if (breakingEntries.length > 0) {
    process.stderr.write(formatBreakingWarning(breakingEntries));
  }
}

interface ReportArtifactsOutcome {
  reportGenerated: boolean;
  earlyExitCode: number | null;
}

/** Markdown output is opt-in: report artifacts are only generated when outputs.formats includes 'markdown'. */
async function maybeGenerateReportArtifacts(
  ctx: RunContext,
  opts: FixCommandOptions,
  result: OrchestratorResult,
  markdownEnabled: boolean,
): Promise<ReportArtifactsOutcome> {
  if (opts.noReport || !markdownEnabled || !result.scan) {
    return { reportGenerated: false, earlyExitCode: null };
  }

  const artifactCode = await generateAndSaveReportArtifacts({
    runner: ctx.runner,
    cwd: opts.cwd,
    config: ctx.config,
    scanBefore: result.scan,
    updates: result.updates,
    engineResults: result.aggregated?.engineResults,
    advisorResults: Object.keys(result.advisorResults).length > 0
      ? result.advisorResults
      : undefined,
    residualVerification: result.residualVerification,
    splitReports: opts.splitReports,
  });

  if (artifactCode !== 0) {
    return { reportGenerated: false, earlyExitCode: artifactCode };
  }
  return { reportGenerated: true, earlyExitCode: null };
}

async function persistAuditTrailAndSummary(
  opts: FixCommandOptions,
  result: OrchestratorResult,
  reportsDir: string,
  reportGenerated: boolean,
): Promise<void> {
  const auditTimestamp = new Date().toISOString();
  const cliVersion = await resolveCliVersion();
  await writeAuditTrail(opts.cwd, {
    timestamp: auditTimestamp,
    cli_version: cliVersion,
    dry_run: opts.dryRun,
    scan: result.scan,
    updates: result.updates,
    overall_status: result.overallStatus,
    has_pending_vulns: result.hasPendingVulns,
  }, reportsDir);

  const safeTimestamp = auditTimestamp.replace(/:/g, '-');
  const auditTrailPath = `${reportsDir}/runs/${safeTimestamp}.json`;

  const summary = formatFixSummary({
    scanResult: result.scan,
    updates: result.updates,
    hasPendingVulns: result.hasPendingVulns,
    overallStatus: result.overallStatus,
    reportPath: reportGenerated ? reportsDir : undefined,
    auditTrailPath,
  });
  process.stdout.write(summary);
}

function resolveFixExitCode(result: OrchestratorResult): number {
  if (result.overallStatus === "error") return 1; // real crash/failure
  if (result.hasPendingVulns) return 1;           // scan clean-exit, vulns remain
  return 0;
}

function buildOrchestratorOptions(
  opts: FixCommandOptions,
  authorizedIds: Set<string>,
): OrchestratorOptions {
  return {
    configPath: opts.config,
    cwd: opts.cwd,
    dryRun: opts.dryRun,
    verbose: opts.verbose,
    phases: parsePhases(opts.phases),
    authorizeBreaking: buildAuthorizeBreakingRecord(authorizedIds),
    rendererType: selectRenderer({ verbose: opts.verbose, quiet: opts.quiet, json: opts.json }),
  };
}

/**
 * Core fix pipeline: scan + ecosystem updates + reports.
 * Extracted from runFixCommand so it can be called inside a branch/commit wrapper.
 * Returns an exit code: 0 = success, 1 = error or pending vulns.
 */
async function runFixPipeline(
  ctx: RunContext,
  opts: FixCommandOptions,
): Promise<number> {
  const { config, runner } = ctx;
  const authorizedIds = new Set<string>(opts.authorizeBreaking ?? []);

  const result = await runOrchestrator(runner, config, buildOrchestratorOptions(opts, authorizedIds));

  if (result.scan) {
    warnOnUnauthorizedBreakingChanges(config, result.scan, authorizedIds);
  }

  const outputsConfig = config.outputs;
  const reportsDir = resolveReportsDir(opts.cwd, outputsConfig?.dir);
  const markdownEnabled = (outputsConfig?.formats ?? []).includes('markdown');

  if (opts.json) {
    await writeOutput(JSON.stringify(result, null, 2), opts.output);
  }

  const { reportGenerated, earlyExitCode } = await maybeGenerateReportArtifacts(
    ctx,
    opts,
    result,
    markdownEnabled,
  );
  if (earlyExitCode !== null) return earlyExitCode;

  await persistAuditTrailAndSummary(opts, result, reportsDir, reportGenerated);

  return resolveFixExitCode(result);
}

interface BranchWorkflowPlan {
  useBranch: boolean;
  effectiveOpenPr: boolean;
  branchPrefix: string;
}

function resolveEffectiveFlag(flag: boolean | undefined, configFlag: boolean | undefined): boolean {
  return flag ?? configFlag ?? false;
}

function resolveBranchPrefix(prefix: string | undefined, configPrefix: string | undefined): string {
  return prefix ?? configPrefix ?? DEFAULT_BRANCH_PREFIX;
}

function resolveBranchWorkflowPlan(ctx: RunContext, opts: FixCommandOptions): BranchWorkflowPlan {
  const wf = ctx.config.workflow;
  const effectiveCreateBranch = resolveEffectiveFlag(opts.createBranch, wf?.create_branch);
  const effectiveOpenPr = resolveEffectiveFlag(opts.openPr, wf?.open_pr);
  const useBranch = (effectiveOpenPr || effectiveCreateBranch) && !opts.dryRun;
  const branchPrefix = resolveBranchPrefix(opts.branchPrefix, wf?.branch_prefix);
  return { useBranch, effectiveOpenPr, branchPrefix };
}

async function runFixWithBranch(
  ctx: RunContext,
  opts: FixCommandOptions,
  plan: BranchWorkflowPlan,
): Promise<number> {
  const { runner, config } = ctx;
  const originalBranch = await detectGitBranch(opts.cwd, runner);
  const branchName = buildBranchName(plan.branchPrefix);

  const branchResult = await createBranchAndCommit(
    runner,
    opts.cwd,
    originalBranch,
    branchName,
    'fix: apply safe dependency updates [' + CLI_NAME + ']',
    async () => runFixPipeline(ctx, opts),
  );

  if (plan.effectiveOpenPr && branchResult.committed) {
    const effectivePrTitle = opts.prTitle ?? config.workflow?.pr_title;
    await openPullRequest(runner, opts.cwd, branchResult.branch, effectivePrTitle, ctx);
  }

  return branchResult.exitCode;
}

/**
 * Runs the full fix workflow: scan + ecosystem updates + reports.
 * Returns an exit code:
 *   0 — success
 *   1 — overall status error
 *
 * When --create-branch or --open-pr is requested (and not --dry-run):
 *   - Detects the current branch.
 *   - Creates a new branch before any mutations.
 *   - Runs the fix pipeline.
 *   - Commits all changes on success; rolls back to original branch on failure.
 *   - If --open-pr: pushes the branch and opens a GitHub pull request via `gh`.
 *
 * Scan architecture note:
 * - `runScanner` (called below as scanAfter) is OSV-ONLY.
 *   It produces the post-fix vulnerability snapshot used for the executive before/after diff.
 * - The before-fix snapshot (`scanBefore`) comes from `result.scan` returned by `runOrchestrator`,
 *   which performs the scan internally as part of Gate A. No standalone pre-fix scan is needed.
 * - SonarQube results come from the orchestrator pipeline (runOrchestrator) via
 *   `result.aggregated.engineResults`. They are NOT included in scanBefore/scanAfter.
 * - runOrchestrator is called exactly once and owns the full SonarQube execution lifecycle
 *   (including managed-mode provisioning). fix.ts never invokes SonarQube directly.
 */
export async function runFixCommand(
  ctx: RunContext,
  opts: FixCommandOptions,
): Promise<number> {
  const plan = resolveBranchWorkflowPlan(ctx, opts);

  if (!plan.useBranch) {
    return runFixPipeline(ctx, opts);
  }

  return runFixWithBranch(ctx, opts, plan);
}

/**
 * Push the branch and open a GitHub pull request via the `gh` CLI.
 * Requires the `gh` CLI to be installed and authenticated.
 * Exits with code 3 if `gh` is not available.
 */
async function openPullRequest(
  runner: CommandRunner,
  cwd: string,
  branchName: string,
  prTitle: string | undefined,
  ctx: RunContext,
): Promise<void> {
  const { config } = ctx;
  const cliVersion = await resolveCliVersion();

  // Check gh CLI is available
  const ghCheck = await runner.runArgs('gh', ['--version'], { cwd });
  if (ghCheck.exitCode !== 0) {
    process.stderr.write(
      __('[{{cliName}}] --open-pr requires the GitHub CLI (gh). Install it from https://cli.github.com and run: gh auth login\n', { cliName: CLI_NAME }),
    );
    process.exit(3);
  }

  // Push branch
  const pushResult = await runner.runArgs('git', ['push', 'origin', branchName], { cwd });
  if (pushResult.exitCode !== 0) {
    throw new Error(__('git push failed: {{detail}}', { detail: pushResult.stderr || pushResult.stdout }));
  }

  const title = prTitle ?? `fix: apply safe dependency updates for ${config.project.name}`;

  const body = [
    `## Summary`,
    ``,
    `Automated dependency update by ${CLI_NAME} v${cliVersion}.`,
    ``,
    `**Project:** ${config.project.client} / ${config.project.name}`,
    `**Ecosystems:** ${config.ecosystems.map((e) => e.id).join(', ')}`,
    ``,
    `🤖 Co-authored with ${CLI_NAME} v${cliVersion}`,
  ].join('\n');

  const prResult = await runner.runArgs(
    'gh',
    ['pr', 'create', '--title', title, '--body', body],
    { cwd },
  );

  if (prResult.exitCode !== 0) {
    throw new Error(__('gh pr create failed: {{detail}}', { detail: prResult.stderr || prResult.stdout }));
  }

  const prUrl = prResult.stdout.trim();
  process.stdout.write(__('[{{cliName}}] Pull request created: {{prUrl}}\n', { cliName: CLI_NAME, prUrl }));
}
