import { readFile } from 'node:fs/promises';

import type { ReachabilityAdapter, ReachabilityCheck } from '@core/policy/reachability';
import { logger } from '@infra/utils/logger';

import type { PythonDependencyGraph, PythonPackageNode } from './pip-dep-graph';
import { parseViaAnnotations } from './pip-dep-graph';
import {
  parsePoetryLock,
  parseUvLock,
  parsePipfileLock,
  parsePdmLock,
} from './pip-lockfile-parsers';
import type { PipToolingDetection } from './pip-tooling-detector';
import { detectPipTooling } from './pip-tooling-detector';
import { resolveWithUv } from './pip-uv-resolver';

// ─── PEP 503 normalization ────────────────────────────────────────────────────

export function normalizePep503(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-').trim();
}

// ─── PEP 440 version comparison ───────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map((p) => parseInt(p, 10) || 0);
  const bParts = b.split('.').map((p) => parseInt(p, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Handles ~= (compatible release): >=base AND ==major.minor.*
function satisfiesCompatibleRelease(version: string, base: string): boolean {
  const parts = base.split('.');
  if (parts.length < 2) return compareVersions(version, base) >= 0;
  const prefix = parts.slice(0, -1).join('.');
  const vParts = version.split('.');
  const vPrefix = vParts.slice(0, parts.length - 1).join('.');
  return compareVersions(version, base) >= 0 && vPrefix === prefix;
}

// Handles == with wildcard (==X.Y.*)
function satisfiesWildcardEqual(version: string, target: string): boolean {
  const prefix = target.slice(0, -2);
  return version.startsWith(prefix + '.') || version === prefix;
}

// Handles != with wildcard (!=X.Y.*)
function satisfiesWildcardNotEqual(version: string, target: string): boolean {
  return !satisfiesWildcardEqual(version, target);
}

type OperatorHandler = (version: string, operand: string) => boolean;

const OPERATOR_MAP: [string, OperatorHandler][] = [
  ['===', (v, op) => v === op],
  ['~=', (v, op) => satisfiesCompatibleRelease(v, op)],
  ['==', (v, op) => (op.endsWith('.*') ? satisfiesWildcardEqual(v, op) : v === op)],
  ['!=', (v, op) => (op.endsWith('.*') ? satisfiesWildcardNotEqual(v, op) : v !== op)],
  ['>=', (v, op) => compareVersions(v, op) >= 0],
  ['<=', (v, op) => compareVersions(v, op) <= 0],
  ['>', (v, op) => compareVersions(v, op) > 0],
  ['<', (v, op) => compareVersions(v, op) < 0],
];

function satisfiesSingleSpec(version: string, spec: string): boolean {
  const trimmed = spec.trim();
  if (!trimmed || trimmed === '*') return true;

  for (const [op, handler] of OPERATOR_MAP) {
    if (trimmed.startsWith(op)) {
      return handler(version, trimmed.slice(op.length).trim());
    }
  }

  return true;
}

export function satisfiesPep440(version: string, specifier: string): boolean {
  if (!specifier || !specifier.trim() || specifier.trim() === '*') return true;
  const specs = specifier.split(',');
  return specs.every((spec) => satisfiesSingleSpec(version, spec.trim()));
}

// ─── Graph helpers ────────────────────────────────────────────────────────────

export function findInGraph(
  graph: PythonDependencyGraph,
  normalizedName: string,
): PythonPackageNode | undefined {
  const direct = graph.get(normalizedName);
  if (direct) return direct;

  for (const [key, node] of graph) {
    if (normalizePep503(key) === normalizedName) return node;
  }
  return undefined;
}

export async function buildGraphFromDetection(
  detection: PipToolingDetection,
  cwd: string,
): Promise<PythonDependencyGraph | undefined> {
  try {
    if (detection.tier === 1) {
      const lockfile = detection.lockfile;
      if (!lockfile) return undefined;
      const content = await readFile(lockfile, 'utf-8');
      if (detection.tooling === 'poetry') return parsePoetryLock(content);
      if (detection.tooling === 'uv') return parseUvLock(content);
      if (detection.tooling === 'pipenv') return parsePipfileLock(content);
      if (detection.tooling === 'pdm') return parsePdmLock(content);
      return undefined;
    }

    if (detection.tier === 2) {
      const content = await readFile(detection.manifest, 'utf-8');
      return parseViaAnnotations(content);
    }

    // Tier 3: bare-pip — use uv resolver
    return await resolveWithUv(cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`pip-reachability: failed to build dependency graph: ${msg}`);
    return undefined;
  }
}

// ─── Constraint checks ────────────────────────────────────────────────────────

export function checkParentBlocks(
  node: PythonPackageNode,
  safeVersion: string,
): string[] {
  const blocking: string[] = [];
  for (const parent of node.requiredBy) {
    if (!parent.constraint) continue;
    if (!satisfiesPep440(safeVersion, parent.constraint)) {
      blocking.push(`${parent.name} (${parent.constraint})`);
    }
  }
  return blocking;
}

export function checkCrossConflict(
  node: PythonPackageNode,
  safeVersionByName: Map<string, string>,
): string[] {
  const conflicts: string[] = [];
  for (const dep of node.dependsOn) {
    if (!dep.constraint) continue;
    const depSafeVersion = safeVersionByName.get(normalizePep503(dep.name));
    if (depSafeVersion === undefined) continue;
    if (!satisfiesPep440(depSafeVersion, dep.constraint)) {
      conflicts.push(`${dep.name} (requires ${dep.constraint}, safe version is ${depSafeVersion})`);
    }
  }
  return conflicts;
}

// ─── Per-package reachability check ──────────────────────────────────────────

export function checkPackageReachability(
  ref: string,
  graph: PythonDependencyGraph,
  safeVersionByName: Map<string, string>,
  tier: 1 | 2 | 3,
): ReachabilityCheck {
  const atIdx = ref.lastIndexOf('@');
  if (atIdx <= 0) return { packageRef: ref, reachable: true };

  const pkgName = ref.slice(0, atIdx);
  const safeVersion = ref.slice(atIdx + 1);
  const normalizedName = normalizePep503(pkgName);

  const node = findInGraph(graph, normalizedName);
  if (!node) {
    return {
      packageRef: ref,
      reachable: false,
      blockReason: `Package ${pkgName} not found in dependency graph`,
    };
  }

  // Editable installs are always reachable (EDGE E3)
  if (node.editable) {
    return { packageRef: ref, reachable: true };
  }

  // AC5: transitive-only check (tier 2 and 3 only)
  if (tier !== 1 && !node.directDependency) {
    return {
      packageRef: ref,
      reachable: false,
      blockReason: 'Transitive dependency — cannot be directly pinned in requirements.txt',
    };
  }

  // Parent-blocks-child check
  const blockingParents = checkParentBlocks(node, safeVersion);
  if (blockingParents.length > 0) {
    return {
      packageRef: ref,
      reachable: false,
      blockReason: `Parent constraint blocks upgrade to ${safeVersion}: ${blockingParents.join(', ')}`,
      blockedBy: blockingParents,
    };
  }

  // Cross-package conflict check
  const conflicts = checkCrossConflict(node, safeVersionByName);
  if (conflicts.length > 0) {
    return {
      packageRef: ref,
      reachable: false,
      blockReason: `Cross-package conflict: ${conflicts.join(', ')}`,
      blockedBy: conflicts,
    };
  }

  return { packageRef: ref, reachable: true };
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class PipReachabilityAdapter implements ReachabilityAdapter {
  readonly ecosystemId = 'pip';

  async checkReachability(
    packages: string[],
    context: { cwd: string },
  ): Promise<ReachabilityCheck[]> {
    const allReachable = (): ReachabilityCheck[] =>
      packages.map((ref) => ({ packageRef: ref, reachable: true }));

    try {
      const detection = await detectPipTooling(context.cwd);

      const graph = await buildGraphFromDetection(detection, context.cwd);
      if (!graph || graph.size === 0) return allReachable();

      // Build safe-version lookup map (PEP 503 normalized name → safe version)
      const safeVersionByName = new Map<string, string>();
      for (const ref of packages) {
        const atIdx = ref.lastIndexOf('@');
        if (atIdx <= 0) continue;
        const name = normalizePep503(ref.slice(0, atIdx));
        const version = ref.slice(atIdx + 1);
        safeVersionByName.set(name, version);
      }

      return packages.map((ref) =>
        checkPackageReachability(ref, graph, safeVersionByName, detection.tier),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`pip-reachability: detection failed, returning all reachable: ${msg}`);
      return allReachable();
    }
  }
}
