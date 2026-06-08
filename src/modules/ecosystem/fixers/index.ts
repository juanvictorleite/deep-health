import type { FixerStrategyId } from '@core/types/config';

import { applyNpmAuditFix } from './npm-audit-fixer';
import { applyOsvNoOp } from './osv-fixer';
import { applyOsvThenAuditFix } from './osv-then-audit-fixer';
import type { FixerFn } from './types';

export type { OsvFixOutcome, FixerCallOptions, FixerCallResult, FixerFn } from './types';
export { extractPackageName, mergeOsvFirstWins } from './types';

/**
 * Typed dispatch map from FixerStrategyId to the corresponding fixer function.
 * All fixer functions share the same FixerCallOptions/FixerCallResult signature
 * for uniform call-site dispatch in updaters.
 *
 * - 'osv': no-op inside the updater — the real OSV fix is coordinated by the orchestrator.
 *   The orchestrator runs `osv-scanner fix` before calling the updater; authorized breaking
 *   changes are also applied at orchestration level with the npm runner.
 * - 'npm-audit': runs `npm audit fix` via the npm runner.
 * - 'osv-then-audit': runs `npm audit fix` on top of the OSV-fixed state; supports partial
 *   rollback to the OSV-only state if validation fails after the audit-fix step.
 */
export const FIXER_MAP: Record<FixerStrategyId, FixerFn> = {
  'osv': applyOsvNoOp,
  'npm-audit': applyNpmAuditFix,
  'osv-then-audit': applyOsvThenAuditFix,
};

export { applyNpmAuditFix } from './npm-audit-fixer';
export { applyOsvNoOp } from './osv-fixer';
export { applyOsvThenAuditFix } from './osv-then-audit-fixer';
