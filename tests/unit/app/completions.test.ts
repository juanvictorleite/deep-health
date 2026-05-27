import { describe, expect, it } from 'vitest';
import {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
} from '@app/completions';

// ─── Bash completion ──────────────────────────────────────────────────────────

describe('generateBashCompletion', () => {
  it('includes the cli name in the complete directive', () => {
    const script = generateBashCompletion('security-scan');
    expect(script).toContain('complete -F _security_scan security-scan');
  });

  it('uses a sanitized function name derived from the cli name', () => {
    const script = generateBashCompletion('my-cli');
    expect(script).toContain('_my_cli()');
    expect(script).toContain('complete -F _my_cli my-cli');
  });

  it('includes all expected subcommands', () => {
    const script = generateBashCompletion('security-scan');
    const subcommands = ['init', 'scan', 'fix', 'executive-report', 'cloud-setup', 'doctor', 'completion'];
    for (const sub of subcommands) {
      expect(script).toContain(sub);
    }
  });

  it('includes common flags', () => {
    const script = generateBashCompletion('security-scan');
    const flags = ['--config', '--cwd', '--verbose', '--quiet', '--json', '--dry-run', '--output'];
    for (const flag of flags) {
      expect(script).toContain(flag);
    }
  });

  it('includes fix-specific flags', () => {
    const script = generateBashCompletion('security-scan');
    const flags = ['--phases', '--authorize-breaking', '--create-branch', '--open-pr'];
    for (const flag of flags) {
      expect(script).toContain(flag);
    }
  });

  it('completes completion subcommand with bash/zsh/fish', () => {
    const script = generateBashCompletion('security-scan');
    expect(script).toContain('bash');
    expect(script).toContain('zsh');
    expect(script).toContain('fish');
  });

  it('uses the provided cli name in comments and completion directive', () => {
    const script = generateBashCompletion('my-scanner');
    expect(script).toContain('my-scanner');
    expect(script).toContain('complete -F _my_scanner my-scanner');
  });

  it('produces a self-contained script with no external dependencies', () => {
    const script = generateBashCompletion('security-scan');
    // Should not reference any external binaries by name in the completion function body
    // other than compgen and standard bash builtins
    expect(script).not.toContain('require(');
    expect(script).not.toContain('import ');
  });
});

// ─── Zsh completion ───────────────────────────────────────────────────────────

describe('generateZshCompletion', () => {
  it('starts with the #compdef directive for the cli name', () => {
    const script = generateZshCompletion('security-scan');
    expect(script.startsWith('#compdef security-scan')).toBe(true);
  });

  it('uses a sanitized function name derived from the cli name', () => {
    const script = generateZshCompletion('my-cli');
    expect(script).toContain('_my_cli()');
  });

  it('includes all expected subcommands', () => {
    const script = generateZshCompletion('security-scan');
    const subcommands = ['init', 'scan', 'fix', 'executive-report', 'cloud-setup', 'doctor', 'completion'];
    for (const sub of subcommands) {
      expect(script).toContain(sub);
    }
  });

  it('includes common flags using _arguments style', () => {
    const script = generateZshCompletion('security-scan');
    const flags = ['--config', '--cwd', '--verbose', '--quiet', '--json', '--dry-run', '--output'];
    for (const flag of flags) {
      expect(script).toContain(flag);
    }
  });

  it('includes fix-specific flags', () => {
    const script = generateZshCompletion('security-scan');
    const flags = ['--phases', '--authorize-breaking', '--create-branch', '--open-pr'];
    for (const flag of flags) {
      expect(script).toContain(flag);
    }
  });

  it('completes completion subcommand with bash/zsh/fish', () => {
    const script = generateZshCompletion('security-scan');
    expect(script).toContain('bash');
    expect(script).toContain('zsh');
    expect(script).toContain('fish');
  });

  it('uses _arguments for structured argument handling', () => {
    const script = generateZshCompletion('security-scan');
    expect(script).toContain('_arguments');
  });

  it('produces a self-contained script', () => {
    const script = generateZshCompletion('security-scan');
    expect(script).not.toContain('require(');
    expect(script).not.toContain('import ');
  });

  it('uses the provided cli name in comments', () => {
    const script = generateZshCompletion('my-scanner');
    expect(script).toContain('my-scanner');
  });
});

// ─── Fish completion ──────────────────────────────────────────────────────────

describe('generateFishCompletion', () => {
  it('uses "complete -c <cliName>" directives', () => {
    const script = generateFishCompletion('security-scan');
    expect(script).toContain('complete -c security-scan');
  });

  it('includes all expected subcommands', () => {
    const script = generateFishCompletion('security-scan');
    const subcommands = ['init', 'scan', 'fix', 'executive-report', 'cloud-setup', 'doctor', 'completion'];
    for (const sub of subcommands) {
      expect(script).toContain(sub);
    }
  });

  it('includes common flags', () => {
    const script = generateFishCompletion('security-scan');
    // Fish uses `-l <name>` which maps to `--<name>`; check the flag name without dashes
    const flagNames = ['config', 'cwd', 'verbose', 'quiet', 'json', 'dry-run', 'output'];
    for (const name of flagNames) {
      expect(script).toContain(`-l ${name}`);
    }
  });

  it('includes fix-specific flags', () => {
    const script = generateFishCompletion('security-scan');
    // Fish uses `-l <name>` which maps to `--<name>`
    const flagNames = ['phases', 'authorize-breaking', 'create-branch', 'open-pr'];
    for (const name of flagNames) {
      expect(script).toContain(`-l ${name}`);
    }
  });

  it('completes completion subcommand with bash/zsh/fish', () => {
    const script = generateFishCompletion('security-scan');
    expect(script).toContain("'bash'");
    expect(script).toContain("'zsh'");
    expect(script).toContain("'fish'");
  });

  it('disables default file completion', () => {
    const script = generateFishCompletion('security-scan');
    // Fish uses -f flag to disable file completion
    expect(script).toContain('-f');
  });

  it('uses the provided cli name in completion directives and comments', () => {
    const script = generateFishCompletion('my-scanner');
    expect(script).toContain('complete -c my-scanner');
  });

  it('produces a self-contained script', () => {
    const script = generateFishCompletion('security-scan');
    expect(script).not.toContain('require(');
    expect(script).not.toContain('import ');
  });

  it('scopes init flags to the init subcommand', () => {
    const script = generateFishCompletion('security-scan');
    // Verify init-specific flags appear and are gated by seen_subcommand_from init
    expect(script).toContain("__fish_seen_subcommand_from init");
    expect(script).toContain('-l non-interactive');
    expect(script).toContain('-l force');
  });
});

// ─── CLI_NAME substitution ────────────────────────────────────────────────────

describe('CLI_NAME substitution in all generators', () => {
  const customName = 'acme-scanner';

  it('bash: substitutes custom cli name throughout the script', () => {
    const script = generateBashCompletion(customName);
    expect(script).toContain(customName);
    expect(script).toContain(`complete -F _acme_scanner ${customName}`);
    // Should not contain placeholder
    expect(script).not.toContain('security-scan');
  });

  it('zsh: substitutes custom cli name throughout the script', () => {
    const script = generateZshCompletion(customName);
    expect(script).toContain(customName);
    expect(script).toContain(`#compdef ${customName}`);
    expect(script).not.toContain('security-scan');
  });

  it('fish: substitutes custom cli name throughout the script', () => {
    const script = generateFishCompletion(customName);
    expect(script).toContain(`complete -c ${customName}`);
    expect(script).not.toContain('security-scan');
  });
});
