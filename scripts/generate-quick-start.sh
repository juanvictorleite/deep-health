#!/usr/bin/env bash
# generate-quick-start.sh
# Generates quick-start doc from the shared template.
# Usage: bash scripts/generate-quick-start.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE="${REPO_ROOT}/scripts/templates/quick-start.template.md"
HEADER="<!-- GENERATED — do not edit. Source: quick-start.template.md -->"

generate() {
  local cli_name="$1"
  local cli_dir=".${cli_name}"
  local usage_guide_link="$2"
  local output="$3"

  sed \
    -e "s|{{CLI_NAME}}|${cli_name}|g" \
    -e "s|{{CLI_DIR}}|${cli_dir}|g" \
    -e "s|{{USAGE_GUIDE_LINK}}|${usage_guide_link}|g" \
    "${TEMPLATE}" > "${output}.tmp"

  # Frontmatter-aware header placement: if the template starts with a YAML
  # frontmatter block ('---' ... '---'), the header must land AFTER the
  # closing '---' so lint-docs.sh's has_frontmatter() (first line == '---')
  # still passes. Otherwise, fall back to prepending the header at line 1.
  awk -v header="${HEADER}" '
    NR==1 && $0=="---" { fm=1; print; next }
    NR==1 { print header; print; next }
    fm==1 && $0=="---" { print; print header; fm=2; next }
    { print }
  ' "${output}.tmp" > "${output}"
  rm "${output}.tmp"

  echo "Generated: ${output}"
}

generate \
  "security-scan" \
  "./usage-guide.md" \
  "${REPO_ROOT}/docs/pt-br/quick-start.md"
