/**
 * Shell completion script generators for bash, zsh, and fish.
 *
 * Each function produces a self-contained completion script as a string.
 * The cliName parameter is substituted at generation time (not runtime),
 * so the output works with whitelabel builds.
 */

/**
 * Generates a bash completion script for the given CLI name.
 *
 * The script defines a `_<cli>` function and registers it via `complete -F`.
 * It completes subcommands, common flags, and fix-specific flags.
 */
export function generateBashCompletion(cliName: string): string {
  const fnName = `_${cliName.replace(/-/g, '_')}`;
  return `# Bash completion for ${cliName}
# Source this file or add to ~/.bashrc:
#   source <(${cliName} completion bash)
#   # or:
#   ${cliName} completion bash >> ~/.bashrc

${fnName}() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    words=("\${COMP_WORDS[@]}")
    cword=$COMP_CWORD
  }

  local subcommands="init scan fix executive-report cloud-setup doctor completion"
  local common_flags="--config --cwd --verbose --quiet --json --dry-run --output"
  local fix_flags="--phases --authorize-breaking --create-branch --open-pr"

  # Determine which subcommand (if any) is already on the line
  local subcommand=""
  local i
  for (( i=1; i<cword; i++ )); do
    case "\${words[i]}" in
      init|scan|fix|executive-report|cloud-setup|doctor|completion)
        subcommand="\${words[i]}"
        break
        ;;
    esac
  done

  if [[ -z "$subcommand" ]]; then
    # Complete subcommands and top-level flags
    COMPREPLY=( $(compgen -W "$subcommands --help --version" -- "$cur") )
    return 0
  fi

  case "$subcommand" in
    fix)
      COMPREPLY=( $(compgen -W "$common_flags $fix_flags --help" -- "$cur") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
      ;;
    init)
      COMPREPLY=( $(compgen -W "--project-name --client --cwd --output --force --non-interactive --json --help" -- "$cur") )
      ;;
    *)
      COMPREPLY=( $(compgen -W "$common_flags --help" -- "$cur") )
      ;;
  esac

  return 0
}

complete -F ${fnName} ${cliName}
`;
}

/**
 * Generates a zsh completion script for the given CLI name.
 *
 * Uses the #compdef directive and _arguments for structured argument completion.
 */
export function generateZshCompletion(cliName: string): string {
  return `#compdef ${cliName}
# Zsh completion for ${cliName}
# Add to your ~/.zshrc:
#   ${cliName} completion zsh >> ~/.zshrc
# Or save to a file in your $fpath:
#   ${cliName} completion zsh > "\${fpath[1]}/_${cliName}"

_${cliName.replace(/-/g, '_')}() {
  local -a subcommands
  subcommands=(
    'init:Generate a project-config.yml template'
    'scan:Run vulnerability scan only (Phase 1)'
    'fix:Run full workflow: scan + ecosystem updates + executive report'
    'executive-report:Generate executive report'
    'cloud-setup:Interactive Google Drive folder picker'
    'doctor:Check environment and configuration'
    'completion:Generate shell completion scripts'
  )

  local -a common_flags
  common_flags=(
    '(-c --config)'{-c,--config}'[Path to project-config.yml]:config file:_files'
    '--cwd[Working directory]:directory:_directories'
    '(-v --verbose)'{-v,--verbose}'[Verbose output]'
    '(-q --quiet)'{-q,--quiet}'[Suppress all output except errors]'
    '--json[Output results as JSON]'
    '--dry-run[Show commands without executing]'
    '(-o --output)'{-o,--output}'[Write report to file]:output file:_files'
  )

  local -a fix_flags
  fix_flags=(
    '--phases[Comma-separated phases to run]:phases'
    '--authorize-breaking[Authorize breaking-change updates]:ecosystem id'
    '--create-branch[Create a git branch before applying fixes]'
    '--open-pr[Create a GitHub pull request after fix]'
  )

  local -a init_flags
  init_flags=(
    '--project-name[Project name]:name'
    '--client[Client name]:name'
    '--cwd[Working directory]:directory:_directories'
    '--output[Output path]:file:_files'
    '--force[Overwrite existing file]'
    '--non-interactive[Skip interactive prompts]'
    '--json[Output result as JSON (requires --non-interactive)]'
  )

  if (( CURRENT == 2 )); then
    _describe 'subcommand' subcommands
    return
  fi

  case $words[2] in
    fix)
      _arguments $common_flags $fix_flags '--help[Show help]'
      ;;
    init)
      _arguments $init_flags '--help[Show help]'
      ;;
    completion)
      local -a shells
      shells=('bash:Generate bash completion' 'zsh:Generate zsh completion' 'fish:Generate fish completion')
      _describe 'shell' shells
      ;;
    *)
      _arguments $common_flags '--help[Show help]'
      ;;
  esac
}

_${cliName.replace(/-/g, '_')}
`;
}

/**
 * Generates a fish completion script for the given CLI name.
 *
 * Uses 'complete -c' directives to register completions for each flag and subcommand.
 */
export function generateFishCompletion(cliName: string): string {
  return `# Fish completion for ${cliName}
# Add to your config:
#   ${cliName} completion fish > ~/.config/fish/completions/${cliName}.fish

# Disable file completion by default
complete -c ${cliName} -f

# Subcommands
complete -c ${cliName} -n '__fish_use_subcommand' -a 'init' -d 'Generate a project-config.yml template'
complete -c ${cliName} -n '__fish_use_subcommand' -a 'scan' -d 'Run vulnerability scan only (Phase 1)'
complete -c ${cliName} -n '__fish_use_subcommand' -a 'fix' -d 'Run full workflow: scan + ecosystem updates + executive report'
complete -c ${cliName} -n '__fish_use_subcommand' -a 'executive-report' -d 'Generate executive report'
complete -c ${cliName} -n '__fish_use_subcommand' -a 'cloud-setup' -d 'Interactive Google Drive folder picker'
complete -c ${cliName} -n '__fish_use_subcommand' -a 'doctor' -d 'Check environment and configuration'
complete -c ${cliName} -n '__fish_use_subcommand' -a 'completion' -d 'Generate shell completion scripts'

# completion subcommand: shell argument
complete -c ${cliName} -n '__fish_seen_subcommand_from completion' -a 'bash' -d 'Generate bash completion script'
complete -c ${cliName} -n '__fish_seen_subcommand_from completion' -a 'zsh' -d 'Generate zsh completion script'
complete -c ${cliName} -n '__fish_seen_subcommand_from completion' -a 'fish' -d 'Generate fish completion script'

# Common flags (scan, fix, executive-report)
complete -c ${cliName} -n '__fish_seen_subcommand_from scan fix executive-report' -l config -s c -d 'Path to project-config.yml' -F
complete -c ${cliName} -n '__fish_seen_subcommand_from scan fix executive-report' -l cwd -d 'Working directory' -F
complete -c ${cliName} -n '__fish_seen_subcommand_from scan fix executive-report' -l verbose -s v -d 'Verbose output'
complete -c ${cliName} -n '__fish_seen_subcommand_from scan fix executive-report' -l quiet -s q -d 'Suppress all output except errors'
complete -c ${cliName} -n '__fish_seen_subcommand_from scan fix executive-report' -l json -d 'Output results as JSON'
complete -c ${cliName} -n '__fish_seen_subcommand_from scan fix executive-report' -l dry-run -d 'Show commands without executing'
complete -c ${cliName} -n '__fish_seen_subcommand_from scan fix executive-report' -l output -s o -d 'Write report to file' -F

# fix-specific flags
complete -c ${cliName} -n '__fish_seen_subcommand_from fix' -l phases -d 'Comma-separated phases to run'
complete -c ${cliName} -n '__fish_seen_subcommand_from fix' -l authorize-breaking -d 'Authorize breaking-change updates for ecosystem id(s)'
complete -c ${cliName} -n '__fish_seen_subcommand_from fix' -l create-branch -d 'Create a git branch before applying fixes'
complete -c ${cliName} -n '__fish_seen_subcommand_from fix' -l open-pr -d 'Create a GitHub pull request after fix'

# init flags
complete -c ${cliName} -n '__fish_seen_subcommand_from init' -l project-name -d 'Project name'
complete -c ${cliName} -n '__fish_seen_subcommand_from init' -l client -d 'Client name'
complete -c ${cliName} -n '__fish_seen_subcommand_from init' -l cwd -d 'Working directory' -F
complete -c ${cliName} -n '__fish_seen_subcommand_from init' -l output -d 'Output path' -F
complete -c ${cliName} -n '__fish_seen_subcommand_from init' -l force -d 'Overwrite existing file'
complete -c ${cliName} -n '__fish_seen_subcommand_from init' -l non-interactive -d 'Skip interactive prompts'
complete -c ${cliName} -n '__fish_seen_subcommand_from init' -l json -d 'Output result as JSON (requires --non-interactive)'
`;
}
