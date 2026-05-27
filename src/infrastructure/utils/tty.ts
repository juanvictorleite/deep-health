import { CLI_NAME } from '@infra/brand';

/**
 * Known CI environment variable names beyond the generic CI flag.
 * The list covers the most common hosted CI services.
 */
const CI_ENV_VARS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BITBUCKET_BUILD_NUMBER',
  'JENKINS_URL',
  'CIRCLECI',
  'TRAVIS',
] as const;

/**
 * Returns true when the process is running inside a known CI environment.
 * Checks process.env.CI first, then a set of well-known CI-specific env vars.
 *
 * Pure utility — no side effects.
 */
export function isCI(): boolean {
  for (const varName of CI_ENV_VARS) {
    const value = process.env[varName];
    if (value !== undefined && value !== '' && value !== '0' && value !== 'false') {
      return true;
    }
  }
  return false;
}

/**
 * Returns true when the process has an interactive TTY on stdin AND is not
 * running in a CI environment.
 *
 * Pure utility — no side effects.
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true && !isCI();
}

/**
 * Throws a descriptive Error when the current environment is not interactive.
 * The error message suggests the --non-interactive flag so callers can handle
 * CI / piped-input scenarios gracefully.
 *
 * Pure utility — no process.exit calls. The caller decides how to handle the error.
 */
export function assertInteractive(commandName: string): void {
  if (!isInteractive()) {
    throw new Error(
      `Interactive prompt required but no TTY detected.\n` +
        `Running in CI? Use: ${CLI_NAME} ${commandName} --non-interactive`,
    );
  }
}
