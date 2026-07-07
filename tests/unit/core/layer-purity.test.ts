/**
 * Fitness test: src/core is the innermost layer and must never import from
 * outer layers (@infra, @modules, @orchestration, @reporting, @app) or reach
 * outside its own directory via relative traversal. See ADR 0006.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = resolve(__dirname, '../../../src/core');

const FORBIDDEN_PREFIXES = ['@infra/', '@modules/', '@orchestration/', '@reporting/', '@app/'];
const IMPORT_SPECIFIER_RE = /(?:import|export)\s+(?:[^'";]*?from\s+)?['"]([^'"]+)['"]/g;

function walkTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER_RE)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function describeViolation(importPath: string, fileDir: string): string | undefined {
  if (FORBIDDEN_PREFIXES.some((prefix) => importPath.startsWith(prefix))) {
    return `forbidden outer-layer import "${importPath}"`;
  }
  if (importPath.startsWith('.') && !resolve(fileDir, importPath).startsWith(CORE_ROOT)) {
    return `relative import "${importPath}" escapes src/core`;
  }
  return undefined;
}

function collectViolations(files: string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const fileDir = resolve(file, '..');
    for (const importPath of extractImportSpecifiers(source)) {
      const reason = describeViolation(importPath, fileDir);
      if (reason) violations.push(`${file}: ${reason}`);
    }
  }
  return violations;
}

describe('core layer purity', () => {
  it('src/core contains no imports from @infra, @modules, @orchestration, @reporting, @app, or paths escaping src/core', () => {
    const violations = collectViolations(walkTsFiles(CORE_ROOT));
    expect(violations).toEqual([]);
  });
});
