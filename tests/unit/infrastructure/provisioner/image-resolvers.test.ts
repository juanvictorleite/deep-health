/**
 * Coverage for src/infrastructure/provisioner/image-resolvers.ts
 *
 * Migrated from the deleted npm-runner.test.ts, pip-runner.test.ts, and
 * php-image-resolver.test.ts resolver suites (ADR 0007) — expectations are
 * unchanged, only the entry point moved to resolveEcosystemImage(id, version).
 */
import { resolveEcosystemImage, NPM_DEFAULT_IMAGE, PIP_DEFAULT_IMAGE } from '@infra/provisioner/image-resolvers';
import { COMPOSER_DEFAULT_IMAGE } from '@infra/provisioner/php-profiles';
import { describe, it, expect } from 'vitest';


describe('resolveEcosystemImage("npm", ...)', () => {
  it('NPM_DEFAULT_IMAGE is node:lts', () => {
    expect(NPM_DEFAULT_IMAGE).toBe('node:lts');
  });

  it('returns NPM_DEFAULT_IMAGE for undefined', () => {
    expect(resolveEcosystemImage('npm', undefined)).toBe('node:lts');
  });

  it('returns NPM_DEFAULT_IMAGE for empty string', () => {
    expect(resolveEcosystemImage('npm', '')).toBe('node:lts');
  });

  it('returns NPM_DEFAULT_IMAGE for whitespace-only string', () => {
    expect(resolveEcosystemImage('npm', '   ')).toBe('node:lts');
  });

  it('resolves major version string "20" to "node:20"', () => {
    expect(resolveEcosystemImage('npm', '20')).toBe('node:20');
  });

  it('extracts major from "20.11.1" → "node:20"', () => {
    expect(resolveEcosystemImage('npm', '20.11.1')).toBe('node:20');
  });

  it('returns NPM_DEFAULT_IMAGE for non-numeric major "abc"', () => {
    expect(resolveEcosystemImage('npm', 'abc')).toBe('node:lts');
  });

  it('returns NPM_DEFAULT_IMAGE for "v20" (has non-digit prefix)', () => {
    expect(resolveEcosystemImage('npm', 'v20')).toBe('node:lts');
  });
});

describe('resolveEcosystemImage("pip", ...)', () => {
  it('PIP_DEFAULT_IMAGE is python:3-slim', () => {
    expect(PIP_DEFAULT_IMAGE).toBe('python:3-slim');
  });

  it('returns PIP_DEFAULT_IMAGE for undefined', () => {
    expect(resolveEcosystemImage('pip', undefined)).toBe('python:3-slim');
  });

  it('returns PIP_DEFAULT_IMAGE for empty string', () => {
    expect(resolveEcosystemImage('pip', '')).toBe('python:3-slim');
  });

  it('returns PIP_DEFAULT_IMAGE for whitespace-only string', () => {
    expect(resolveEcosystemImage('pip', '   ')).toBe('python:3-slim');
  });

  it('resolves "3.11" → "python:3.11-slim"', () => {
    expect(resolveEcosystemImage('pip', '3.11')).toBe('python:3.11-slim');
  });

  it('resolves "3.11.2" → "python:3.11-slim" (major.minor only)', () => {
    expect(resolveEcosystemImage('pip', '3.11.2')).toBe('python:3.11-slim');
  });

  it('resolves bare "3" → "python:3-slim"', () => {
    expect(resolveEcosystemImage('pip', '3')).toBe('python:3-slim');
  });

  it('returns PIP_DEFAULT_IMAGE for non-numeric input "abc"', () => {
    expect(resolveEcosystemImage('pip', 'abc')).toBe('python:3-slim');
  });

  it('returns PIP_DEFAULT_IMAGE for "v3.11" (has non-digit prefix in first segment)', () => {
    expect(resolveEcosystemImage('pip', 'v3.11')).toBe('python:3-slim');
  });
});

describe('resolveEcosystemImage("composer", ...)', () => {
  it('COMPOSER_DEFAULT_IMAGE is composer:2', () => {
    expect(COMPOSER_DEFAULT_IMAGE).toBe('composer:2');
  });

  it('returns composer fallback image for undefined/empty', () => {
    expect(resolveEcosystemImage('composer', undefined)).toBe('composer:2');
    expect(resolveEcosystemImage('composer', '')).toBe('composer:2');
    expect(resolveEcosystemImage('composer', '   ')).toBe('composer:2');
  });

  it('resolves major.minor from 8.2.1 to php:8.2-cli', () => {
    expect(resolveEcosystemImage('composer', '8.2.1')).toBe('php:8.2-cli');
  });

  it('resolves bare major 8 to php:8-cli', () => {
    expect(resolveEcosystemImage('composer', '8')).toBe('php:8-cli');
  });

  it('falls back for non-numeric prefixes', () => {
    expect(resolveEcosystemImage('composer', 'v8.2')).toBe('composer:2');
    expect(resolveEcosystemImage('composer', 'abc')).toBe('composer:2');
  });
});

describe('resolveEcosystemImage — unknown ecosystem', () => {
  it('throws for an unregistered ecosystem id', () => {
    expect(() => resolveEcosystemImage('unknown-ecosystem')).toThrow(
      /unknown ecosystem id/i,
    );
  });
});
