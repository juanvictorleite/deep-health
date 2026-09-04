import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { execa } from 'execa';

import { __ } from '@core/i18n';
import { success, warn, error, dim } from '@infra/utils/ui';

export interface DoctorCommandOptions {
  cwd: string;
  config: string;
}

export interface DoctorCheck {
  name: string;
  required: boolean;
  status: 'pass' | 'fail' | 'warn';
  detail?: string;
  hint?: string;
}

// ─── Individual checks ────────────────────────────────────────────────────────

export function checkNodeVersion(): DoctorCheck {
  const version = process.versions.node;
  return {
    name: __('Node.js'),
    required: true,
    status: 'pass',
    detail: `v${version}`,
  };
}

export async function checkDocker(): Promise<DoctorCheck> {
  const result = await execa('docker', ['info', '--format', '{{.ServerVersion}}'], {
    reject: false,
    all: true,
  });

  if (result.exitCode !== 0) {
    return {
      name: __('Docker'),
      required: true,
      status: 'fail',
      hint: __('Start the Docker daemon and try again.'),
    };
  }

  return {
    name: __('Docker'),
    required: true,
    status: 'pass',
    detail: result.stdout.trim() ? `v${result.stdout.trim()}` : undefined,
  };
}

export async function checkOsvScanner(): Promise<DoctorCheck> {
  const result = await execa('osv-scanner', ['--version'], {
    reject: false,
    all: true,
  });

  if (result.exitCode !== 0) {
    return {
      name: __('OSV Scanner'),
      required: true,
      status: 'fail',
      hint: __('Install osv-scanner: https://google.github.io/osv-scanner/'),
    };
  }

  const versionLine = result.stdout.trim() || result.stderr.trim();
  return {
    name: __('OSV Scanner'),
    required: true,
    status: 'pass',
    detail: versionLine || undefined,
  };
}

async function resolveOsvRunnerForConfig(
  cwd: string,
  configPath: string,
): Promise<'docker' | 'local'> {
  try {
    const raw = JSON.parse(await readFile(resolve(cwd, configPath), 'utf8')) as {
      scanners?: { osv?: { runner?: string } };
    };
    const runner = raw.scanners?.osv?.runner;
    return runner === undefined || runner === 'docker' ? 'docker' : 'local';
  } catch {
    // The independent config check reports missing or unreadable files. Preserve
    // the legacy host probe here so doctor still provides useful OSV feedback.
    return 'local';
  }
}

function checkOsvScannerForRunner(runner: 'docker' | 'local'): Promise<DoctorCheck> | DoctorCheck {
  if (runner === 'docker') {
    return {
      name: __('OSV Scanner'),
      required: true,
      status: 'pass',
      detail: __('Docker'),
    };
  }
  return checkOsvScanner();
}

export async function checkOsvScannerForConfig(
  cwd: string,
  configPath: string,
): Promise<DoctorCheck> {
  const runner = await resolveOsvRunnerForConfig(cwd, configPath);
  return checkOsvScannerForRunner(runner);
}

export async function checkGhCli(): Promise<DoctorCheck> {
  const result = await execa('gh', ['--version'], {
    reject: false,
    all: true,
  });

  if (result.exitCode !== 0) {
    return {
      name: __('gh CLI'),
      required: false,
      status: 'warn',
      hint: __('Install gh CLI to enable --open-pr: https://cli.github.com/'),
    };
  }

  const versionLine = result.stdout.split('\n')[0]?.trim();
  return {
    name: __('gh CLI'),
    required: false,
    status: 'pass',
    detail: versionLine || undefined,
  };
}

export async function checkConfig(cwd: string, configPath: string): Promise<DoctorCheck> {
  const absolutePath = resolve(cwd, configPath);
  try {
    await access(absolutePath);
    return {
      name: __('Config file'),
      required: true,
      status: 'pass',
      detail: absolutePath,
    };
  } catch {
    return {
      name: __('Config file'),
      required: true,
      status: 'fail',
      hint: __('Run "security-scan init" to generate a config file, or pass --config <path>.'),
    };
  }
}

export function checkSonarToken(): DoctorCheck {
  const token = process.env.SONAR_TOKEN;
  if (!token) {
    return {
      name: __('SonarQube token'),
      required: false,
      status: 'warn',
      hint: __('Set SONAR_TOKEN env var to enable SonarQube scanning.'),
    };
  }
  return {
    name: __('SonarQube token'),
    required: false,
    status: 'pass',
    detail: __('(set)'),
  };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const CHECK_ICON = '✔'; // ✔
const CROSS_ICON = '✘'; // ✘
const WARN_ICON = '⚠'; // ⚠

export function formatDoctorResults(checks: DoctorCheck[]): string {
  const lines: string[] = [];

  for (const check of checks) {
    if (check.status === 'pass') {
      const detail = check.detail ? ` ${dim(check.detail)}` : '';
      lines.push(success(`${CHECK_ICON} ${check.name}`) + detail);
    } else if (check.status === 'fail') {
      const reason = check.hint ? ` — ${check.hint}` : '';
      lines.push(error(`${CROSS_ICON} ${check.name}${reason}`));
      if (check.hint) {
        lines.push(dim(`  ${__('Hint')}: ${check.hint}`));
      }
    } else {
      // warn
      const reason = check.hint ? ` — ${check.hint}` : '';
      lines.push(warn(`${WARN_ICON} ${check.name}${reason}`));
      if (check.hint) {
        lines.push(dim(`  ${__('Hint')}: ${check.hint}`));
      }
    }
  }

  const required = checks.filter((c) => c.required);
  const passed = required.filter((c) => c.status === 'pass').length;
  const total = required.length;
  const warnings = checks.filter((c) => !c.required && c.status === 'warn').length;

  lines.push('');
  lines.push(
    passed === total
      ? success(__('{{passed}}/{{total}} required checks passed', { passed, total }))
      : error(__('{{passed}}/{{total}} required checks passed', { passed, total })),
  );

  if (warnings > 0) {
    lines.push(
      warn(__('{{warnings}} optional check(s) have warnings', { warnings })),
    );
  }

  return lines.join('\n');
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runDoctorCommand(opts: DoctorCommandOptions): Promise<number> {
  const osvRunner = await resolveOsvRunnerForConfig(opts.cwd, opts.config);
  const checks: DoctorCheck[] = await Promise.all([
    checkNodeVersion(),
    checkDocker(),
    checkOsvScannerForRunner(osvRunner),
    checkGhCli(),
    checkConfig(opts.cwd, opts.config),
    checkSonarToken(),
  ]);

  const output = formatDoctorResults(checks);
  process.stdout.write(output + '\n');

  const requiredFailed = checks.some((c) => c.required && c.status === 'fail');
  return requiredFailed ? 1 : 0;
}
