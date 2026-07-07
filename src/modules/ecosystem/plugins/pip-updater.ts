import type { CommandRunner, VulnerabilityClass } from '@core/types/common';
import type { FixerStrategyId, ValidationCommandConfig } from '@core/types/config';
import type { AdvisorResult } from '@core/types/report';
import type { ScanResultJson } from '@core/types/scan';
import { emptyEcosystem } from '@core/types/scan';
import type { UpdateResultJson } from '@core/types/update';
import { logger } from '@infra/utils/logger';

import type { PipToolingDetection } from './pip-tooling-detector';
import { mergeOsvFirstWins } from '../fixers/index';
import type { OsvFixOutcome } from '../fixers/index';
import { runUpdaterLifecycle } from '../utils/updater-lifecycle';
import {
  stripPipVersion,
  toPipInstallSpec,
  computeMaxSafeVersions,
  computeSortedSafeVersions,
  updateRequirementsContent,
  parsePipInstalledVersions,
  buildPipPackagesUpdated,
  parsePipAuditFixJson,
  buildMaxCvssMap,
  sortSpecsByCvss,
} from './pip/transforms';
import { resolveBackupFiles, resolveBootstrapSpec, applyToolingFix } from './pip/tooling';
import { validatePipSpecs, findCompatibleSubset } from './pip/spec-validation';
import type { PipFixerResult } from './pip/fixers';
import { isPipAuditAvailable, applyPipAudit, applyPipInstall, rewriteRequirementsTxt } from './pip/fixers';

export {
  resolveBackupFiles,
  resolveBootstrapSpec,
  stripPipVersion,
  toPipInstallSpec,
  computeMaxSafeVersions,
  computeSortedSafeVersions,
  updateRequirementsContent,
  parsePipInstalledVersions,
  buildPipPackagesUpdated,
  parsePipAuditFixJson,
  buildMaxCvssMap,
  sortSpecsByCvss,
  findCompatibleSubset,
};
export type { PipFixerResult };

export async function runPipUpdater(
  runner: CommandRunner,
  _config: unknown,
  scanResult: ScanResultJson,
  cwd: string,
  authorizeBreaking = false,
  validationCommands: ValidationCommandConfig[] = [],
  _fixerStrategy: FixerStrategyId = 'osv',
  preFixBackups?: Map<string, string>,
  osvFixOutcome?: OsvFixOutcome,
  preRunSnapshots?: Map<string, string>,
  _advisorResults?: AdvisorResult[],
  ecosystemKey = 'pip',
  detection?: PipToolingDetection,
): Promise<UpdateResultJson> {
  logger.info('Running pip safe updates...');

  const pipEcosystem = scanResult.ecosystems[ecosystemKey] ?? emptyEcosystem();

  const autoSafePackageNames = pipEcosystem.auto_safe_packages.map(stripPipVersion);
  const breakingPackageNames = authorizeBreaking
    ? pipEcosystem.breaking_packages.map(stripPipVersion)
    : [];
  const packageNamesToUpdate = [...new Set([...autoSafePackageNames, ...breakingPackageNames])];

  // Compute MAX safe versions per package from the vulnerabilities array
  const classifications = new Set<VulnerabilityClass>(
    authorizeBreaking ? ['auto_safe', 'breaking'] : ['auto_safe'],
  );
  const maxSafeVersions = computeMaxSafeVersions(pipEcosystem.vulnerabilities, classifications);
  const sortedSafeVersions = computeSortedSafeVersions(pipEcosystem.vulnerabilities, classifications);

  // Build the list of all package entries (auto_safe + optionally breaking) for fallback
  const allPackageEntries = [
    ...pipEcosystem.auto_safe_packages,
    ...(authorizeBreaking ? pipEcosystem.breaking_packages : []),
  ];

  // Version-pinned specs for pip install (e.g. 'pillow==9.5.0') — no -U flag.
  // Primary: use computeMaxSafeVersions result (picks max safeVersion across all vulns).
  // Fallback: toPipInstallSpec from scan entry string (for backward compat when vulnerabilities[] is empty).
  let packageSpecsToInstall = [
    ...new Set(
      packageNamesToUpdate.map((pkgName) => {
        const maxSafeVersion = maxSafeVersions.get(pkgName);
        if (maxSafeVersion !== undefined) {
          return `${pkgName}==${maxSafeVersion}`;
        }
        // Fallback: find the original scan entry and convert it
        const entry = allPackageEntries.find(
          (e) => stripPipVersion(e).toLowerCase() === pkgName,
        );
        return entry !== undefined ? toPipInstallSpec(entry) : pkgName;
      }),
    ),
  ];

  // Sort specs by CVSS severity descending so the greedy subset algorithm
  // in findCompatibleSubset prioritises the most critical security fixes.
  const cvssMap = buildMaxCvssMap(pipEcosystem.vulnerabilities, classifications);
  packageSpecsToInstall = sortSpecsByCvss(packageSpecsToInstall, cvssMap);

  const backupFiles = resolveBackupFiles(detection);
  const revertSpec = resolveBootstrapSpec(detection);

  return runUpdaterLifecycle<PipFixerResult>(
    {
      agentName: 'pip-safe-update',
      ecosystemKey,
      backupPaths: backupFiles,
      bootstrapSpec: revertSpec,

      async probe(ctx) {
        if (packageNamesToUpdate.length === 0) {
          return {
            $schema: 'osv-update-result/v1',
            agent: 'pip-safe-update',
            status: 'success',
            packages_updated: [],
            packages_skipped: [],
            packages_pending_breaking: pipEcosystem.breaking_packages,
            validations: [{ name: 'validation', status: 'skipped', detail: 'No packages to update' }],
            error: null,
          };
        }
        if (ctx.runner.dryRun) {
          logger.tagged('pip', 'DRY-RUN', `Would execute: pip install ${packageSpecsToInstall.join(' ')}`);
          for (const vc of validationCommands) {
            logger.tagged('pip', 'DRY-RUN', `Would execute: ${vc.command}`);
          }
        }
        return null;
      },

      async applyFix(ctx) {
        // Non-bare-pip tooling: route to native tool, skip pip-audit
        if (detection && detection.tooling !== 'bare-pip') {
          const result = await applyToolingFix(
            ctx.runner, ctx.cwd, detection, packageNamesToUpdate, packageSpecsToInstall,
          );
          if (result.ok && detection.tooling === 'uv') {
            // uv pip install does not rewrite requirements.txt automatically
            const installedVersions = parsePipInstalledVersions(result.value.stdout);
            await rewriteRequirementsTxt(ctx.cwd, installedVersions);
          }
          return result;
        }

        const pipAuditAvailable = await isPipAuditAvailable(ctx.runner, ctx.cwd);

        if (pipAuditAvailable) {
          logger.info('pip-audit available — using pip-audit --fix for vulnerability remediation');
          return applyPipAudit(ctx.runner, ctx.cwd);
        }

        logger.info('pip-audit not available — falling back to pip install (version-pinned)');

        let specsToInstall = packageSpecsToInstall;

        // Only run dry-run validation when we have vulnerability data with fallback versions.
        // Without sortedSafeVersions entries, there are no alternatives to try, so validation
        // adds no value over the install itself.
        if (sortedSafeVersions.size > 0) {
          const { validated, skipped } = await validatePipSpecs(
            ctx.runner,
            ctx.cwd,
            packageSpecsToInstall,
            sortedSafeVersions,
          );

          for (const s of skipped) {
            logger.warn(`Skipping ${s.pkg}: ${s.reason}`);
          }

          if (validated.length === 0) {
            return { ok: false, error: 'All package specs failed dry-run validation' };
          }

          specsToInstall = validated;
        }

        const installResult = await applyPipInstall(ctx.runner, ctx.cwd, specsToInstall);

        if (installResult.ok) {
          // Rewrite requirements.txt with the installed versions (pip install does not do this)
          const installedVersions = parsePipInstalledVersions(installResult.value.stdout);
          await rewriteRequirementsTxt(ctx.cwd, installedVersions);
        }

        return installResult;
      },

      async derivePackagesUpdated(_ctx, fixerResult) {
        let packages: string[];
        if (fixerResult.mode === 'pip-audit') {
          packages = parsePipAuditFixJson(fixerResult.stdout);
        } else {
          const installedVersions = parsePipInstalledVersions(fixerResult.stdout);
          packages = buildPipPackagesUpdated(pipEcosystem.auto_safe_packages, installedVersions);
        }
        return mergeOsvFirstWins(osvFixOutcome, packages);
      },
    },
    { runner, cwd, scanResult, ecosystemId: ecosystemKey, validationCommands, authorizeBreaking },
    { preFixBackups, preRunSnapshots },
  );
}
