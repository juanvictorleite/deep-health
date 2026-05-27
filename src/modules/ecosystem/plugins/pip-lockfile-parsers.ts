import { parse as parseTOML } from 'smol-toml';
import type { PythonDependencyGraph, PythonPackageNode } from '@modules/ecosystem/plugins/pip-dep-graph';

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-').trim();
}

function emptyGraph(): PythonDependencyGraph {
  return new Map<string, PythonPackageNode>();
}

function buildEdges(graph: PythonDependencyGraph): void {
  for (const [name, node] of graph) {
    for (const dep of node.dependsOn) {
      const depNode = graph.get(dep.name);
      if (depNode) {
        const alreadyLinked = depNode.requiredBy.some((r) => r.name === name);
        if (!alreadyLinked) {
          depNode.requiredBy.push({ name, constraint: dep.constraint });
        }
      }
    }
  }
}

function extractPoetryConstraint(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj['version'] === 'string') return obj['version'];
  }
  return '*';
}

function tomlSafe(content: string): Record<string, unknown> | null {
  try {
    return parseTOML(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function jsonSafe(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildPoetryDependsOn(deps: unknown): Array<{ name: string; constraint?: string }> {
  const result: Array<{ name: string; constraint?: string }> = [];
  if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) return result;
  for (const [depName, depValue] of Object.entries(deps as Record<string, unknown>)) {
    result.push({ name: normalizeName(depName), constraint: extractPoetryConstraint(depValue) });
  }
  return result;
}

function addPackageToGraph(
  graph: PythonDependencyGraph,
  pkg: unknown,
  buildDependsOnFn: (p: Record<string, unknown>) => Array<{ name: string; constraint?: string }>,
): void {
  if (typeof pkg !== 'object' || pkg === null) return;
  const p = pkg as Record<string, unknown>;
  if (typeof p['name'] !== 'string' || typeof p['version'] !== 'string') return;
  graph.set(normalizeName(p['name']), {
    version: p['version'],
    directDependency: false,
    dependsOn: buildDependsOnFn(p),
    requiredBy: [],
  });
}

function parseTomlLockfile(
  content: string,
  addPackageFn: (graph: PythonDependencyGraph, pkg: unknown) => void,
): PythonDependencyGraph {
  const graph = emptyGraph();
  if (!content.trim()) return graph;
  const parsed = tomlSafe(content);
  if (!parsed) return graph;
  const packages = parsed['package'];
  if (!Array.isArray(packages)) return graph;
  for (const pkg of packages) addPackageFn(graph, pkg);
  buildEdges(graph);
  return graph;
}

function addPoetryPackage(graph: PythonDependencyGraph, pkg: unknown): void {
  addPackageToGraph(graph, pkg, (p) => buildPoetryDependsOn(p['dependencies']));
}

export function parsePoetryLock(content: string): PythonDependencyGraph {
  return parseTomlLockfile(content, addPoetryPackage);
}

function buildUvDependsOnFromArray(deps: unknown): Array<{ name: string; constraint?: string }> {
  const result: Array<{ name: string; constraint?: string }> = [];
  if (!Array.isArray(deps)) return result;
  for (const dep of deps) {
    if (typeof dep !== 'object' || dep === null) continue;
    const d = dep as Record<string, unknown>;
    if (typeof d['name'] !== 'string') continue;
    result.push({
      name: normalizeName(d['name']),
      constraint: typeof d['specifier'] === 'string' ? d['specifier'] : '*',
    });
  }
  return result;
}

function addUvPackage(graph: PythonDependencyGraph, pkg: unknown): void {
  addPackageToGraph(graph, pkg, (p) => [
    ...buildUvDependsOnFromArray(p['dependencies']),
    ...buildUvDependsOnFromArray(p['dev-dependencies']),
  ]);
}

export function parseUvLock(content: string): PythonDependencyGraph {
  return parseTomlLockfile(content, addUvPackage);
}

function buildPipfileDependsOn(requires: unknown): Array<{ name: string; constraint?: string }> {
  const result: Array<{ name: string; constraint?: string }> = [];
  if (typeof requires !== 'object' || requires === null) return result;
  for (const [depName, constraint] of Object.entries(requires as Record<string, unknown>)) {
    result.push({
      name: normalizeName(depName),
      constraint: typeof constraint === 'string' ? constraint : '*',
    });
  }
  return result;
}

function addPipfileSectionPackages(
  graph: PythonDependencyGraph,
  section: unknown,
): void {
  if (typeof section !== 'object' || section === null) return;
  for (const [pkgName, pkgData] of Object.entries(section as Record<string, unknown>)) {
    if (typeof pkgData !== 'object' || pkgData === null) continue;
    const p = pkgData as Record<string, unknown>;
    if (typeof p['version'] !== 'string') continue;
    graph.set(normalizeName(pkgName), {
      version: p['version'].replace(/^==/, ''),
      directDependency: false,
      dependsOn: buildPipfileDependsOn(p['requires']),
      requiredBy: [],
    });
  }
}

export function parsePipfileLock(content: string): PythonDependencyGraph {
  const graph = emptyGraph();
  if (!content.trim()) return graph;
  const parsed = jsonSafe(content);
  if (!parsed) return graph;
  addPipfileSectionPackages(graph, parsed['default']);
  addPipfileSectionPackages(graph, parsed['develop']);
  buildEdges(graph);
  return graph;
}

const PDM_CONSTRAINT_PATTERN = /^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)(>=|<=|==|!=|~=|>|<|===)(.*)$/;

function parsePdmDependencyString(dep: string): { name: string; constraint?: string } {
  const match = dep.trim().match(PDM_CONSTRAINT_PATTERN);
  if (match) {
    return { name: normalizeName(match[1]!), constraint: match[3]! + match[4]! };
  }
  return { name: normalizeName(dep.trim()) };
}

function buildPdmDependsOn(deps: unknown): Array<{ name: string; constraint?: string }> {
  const result: Array<{ name: string; constraint?: string }> = [];
  if (!Array.isArray(deps)) return result;
  for (const dep of deps) {
    if (typeof dep === 'string') result.push(parsePdmDependencyString(dep));
  }
  return result;
}

function addPdmPackage(graph: PythonDependencyGraph, pkg: unknown): void {
  addPackageToGraph(graph, pkg, (p) => buildPdmDependsOn(p['dependencies']));
}

export function parsePdmLock(content: string): PythonDependencyGraph {
  return parseTomlLockfile(content, addPdmPackage);
}
