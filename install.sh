#!/usr/bin/env sh
# shellcheck shell=sh
#
# Quick installer for the security-scan / deep-health CLI.
#
#   curl -fsSL <url>/install.sh | sh
#   curl -fsSL <url>/install.sh | sh -s -- --name deep-health
#
set -eu

REPO="${REPO:-ejklock/deep-health}"
INSTALL_DIR="${INSTALL_DIR:-${HOME}/.local/bin}"
VERSION="${VERSION:-latest}"
CLI_NAME="${CLI_NAME:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

DEFAULT_BRAND="security-scan"
EXPLICIT_NAME=""
HELP_REQUESTED=0

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Install the security-scan / deep-health CLI from GitHub Releases into a
local bin directory. Safe to pipe: curl -fsSL <url> | sh

Options:
  --dir <path>          Install directory (default: ~/.local/bin)
  --version <tag>        Release tag to install (default: latest)
  --repo <owner/repo>     GitHub repository to fetch releases from
  --name <brand>          CLI brand to install: security-scan or deep-health
  --help                  Show this help message

Environment overrides: INSTALL_DIR, VERSION, CLI_NAME, REPO, GITHUB_TOKEN
EOF
}

validate_brand() {
  case "$1" in
    security-scan|deep-health) return 0 ;;
    *) return 1 ;;
  esac
}

prompt_brand_menu() {
  printf 'Select CLI to install:\n' >&2
  printf '  1) security-scan (default)\n' >&2
  printf '  2) deep-health\n' >&2
  printf 'Choice [1]: ' >&2
  read -r choice < /dev/tty

  case "$choice" in
    ''|1) echo "$DEFAULT_BRAND" ;;
    2) echo "deep-health" ;;
    *)
      echo "Error: invalid selection '${choice}'" >&2
      return 1
      ;;
  esac
}

choose_brand() {
  explicit_name="$1"

  if [ -n "$explicit_name" ]; then
    if validate_brand "$explicit_name"; then
      echo "$explicit_name"
      return 0
    fi
    echo "Error: invalid brand '${explicit_name}' (expected security-scan or deep-health)" >&2
    return 1
  fi

  if [ -r /dev/tty ] && [ -t 0 ]; then
    prompt_brand_menu
    return $?
  fi

  echo "$DEFAULT_BRAND"
}

map_target_linux() {
  uname_m="$1"
  is_musl="$2"

  case "$uname_m" in
    x86_64|amd64)
      if [ "$is_musl" = "1" ]; then
        echo "linux-x64-musl.bin"
      else
        echo "linux-x64.bin"
      fi
      ;;
    aarch64|arm64)
      if [ "$is_musl" = "1" ]; then
        echo "Error: no musl build for linux-arm64" >&2
        return 1
      fi
      echo "linux-arm64.bin"
      ;;
    *)
      echo "Error: unsupported Linux architecture '${uname_m}'" >&2
      return 1
      ;;
  esac
}

map_target_darwin() {
  uname_m="$1"

  case "$uname_m" in
    arm64)
      echo "macos-arm64"
      ;;
    x86_64)
      echo "Error: no Intel macOS build available (Apple Silicon only)" >&2
      return 1
      ;;
    *)
      echo "Error: unsupported macOS architecture '${uname_m}'" >&2
      return 1
      ;;
  esac
}

map_target() {
  uname_s="$1"
  uname_m="$2"
  is_musl="$3"

  case "$uname_s" in
    Linux) map_target_linux "$uname_m" "$is_musl" ;;
    Darwin) map_target_darwin "$uname_m" ;;
    MINGW*|MSYS*|CYGWIN*) echo "win-x64.exe" ;;
    *)
      echo "Error: unsupported platform '${uname_s}/${uname_m}' (supported: linux-x64, linux-x64-musl, linux-arm64, macos-arm64, win-x64)" >&2
      return 1
      ;;
  esac
}

detect_musl() {
  if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
    echo 1
    return 0
  fi

  if [ -f /etc/alpine-release ]; then
    echo 1
    return 0
  fi

  echo 0
}

detect_target() {
  uname_s="$(uname -s)"
  uname_m="$(uname -m)"
  is_musl="$(detect_musl)"
  map_target "$uname_s" "$uname_m" "$is_musl"
}

select_asset_url_jq() {
  json="$1"
  cli_name="$2"
  asset_suffix="$3"

  url="$(printf '%s' "$json" | jq -r --arg p "${cli_name}-" --arg s "-${asset_suffix}" \
    '[.assets[]? | select((.name|startswith($p)) and (.name|endswith($s)))][0].browser_download_url // empty')"

  if [ -z "$url" ] || [ "$url" = "null" ]; then
    echo "Error: no release asset found matching '${cli_name}-*-${asset_suffix}'" >&2
    return 1
  fi

  echo "$url"
}

select_asset_url_fallback() {
  json="$1"
  cli_name="$2"
  asset_suffix="$3"

  url="$(printf '%s\n' "$json" | awk -v prefix="${cli_name}-" -v suffix="-${asset_suffix}" '
    /"name"[[:space:]]*:/ {
      name = $0
      sub(/.*"name"[[:space:]]*:[[:space:]]*"/, "", name)
      sub(/".*/, "", name)
    }
    /"browser_download_url"[[:space:]]*:/ {
      url = $0
      sub(/.*"browser_download_url"[[:space:]]*:[[:space:]]*"/, "", url)
      sub(/".*/, "", url)
      if (index(name, prefix) == 1) {
        suflen = length(suffix)
        namelen = length(name)
        if (namelen >= suflen && substr(name, namelen - suflen + 1) == suffix) {
          print url
          found = 1
          exit
        }
      }
    }
    END { exit(found ? 0 : 1) }
  ')"
  status=$?

  if [ "$status" -ne 0 ] || [ -z "$url" ]; then
    echo "Error: no release asset found matching '${cli_name}-*-${asset_suffix}'" >&2
    return 1
  fi

  echo "$url"
}

select_asset_url() {
  json="$1"
  cli_name="$2"
  asset_suffix="$3"

  if command -v jq >/dev/null 2>&1; then
    select_asset_url_jq "$json" "$cli_name" "$asset_suffix"
  else
    select_asset_url_fallback "$json" "$cli_name" "$asset_suffix"
  fi
}

require_downloader() {
  if command -v curl >/dev/null 2>&1; then
    echo curl
    return 0
  fi

  if command -v wget >/dev/null 2>&1; then
    echo wget
    return 0
  fi

  echo "Error: neither curl nor wget is available; install one and retry" >&2
  return 1
}

release_api_url() {
  if [ "$VERSION" = "latest" ]; then
    echo "https://api.github.com/repos/${REPO}/releases/latest"
  else
    echo "https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
  fi
}

fetch_release_json() {
  downloader="$1"
  api_url="$(release_api_url)"

  auth_header=""
  if [ -n "$GITHUB_TOKEN" ]; then
    auth_header="Authorization: Bearer ${GITHUB_TOKEN}"
  fi

  if [ "$downloader" = "curl" ]; then
    if [ -n "$auth_header" ]; then
      curl -fsSL -H "$auth_header" "$api_url"
    else
      curl -fsSL "$api_url"
    fi
  else
    if [ -n "$auth_header" ]; then
      wget -qO- --header="$auth_header" "$api_url"
    else
      wget -qO- "$api_url"
    fi
  fi || {
    echo "Error: failed to fetch release metadata from ${api_url}" >&2
    echo "Hint: check network access and REPO/VERSION, or set GITHUB_TOKEN if you are rate-limited or the repo is private." >&2
    return 1
  }
}

install_binary() {
  url="$1"
  downloader="$2"

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  dest_tmp="${tmp}/${CLI_NAME}"

  if [ "$downloader" = "curl" ]; then
    curl -fSL -o "$dest_tmp" "$url"
  else
    wget -O "$dest_tmp" "$url"
  fi

  mkdir -p "$INSTALL_DIR"
  mv "$dest_tmp" "${INSTALL_DIR}/${CLI_NAME}"
  chmod +x "${INSTALL_DIR}/${CLI_NAME}"

  if ! "${INSTALL_DIR}/${CLI_NAME}" --version >/dev/null 2>&1; then
    if ! "${INSTALL_DIR}/${CLI_NAME}" --help >/dev/null 2>&1; then
      echo "Error: installed binary at ${INSTALL_DIR}/${CLI_NAME} failed to execute" >&2
      return 1
    fi
  fi

  echo "Installed ${CLI_NAME} (${VERSION}) to ${INSTALL_DIR}/${CLI_NAME}"
}

check_path() {
  case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) return 0 ;;
  esac

  rc_file="$HOME/.profile"
  case "${SHELL:-}" in
    */zsh) rc_file="$HOME/.zshrc" ;;
    */bash) rc_file="$HOME/.bashrc" ;;
  esac

  echo "Warning: ${INSTALL_DIR} is not on your PATH." >&2
  echo "Add it by running:" >&2
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\"" >&2
  echo "and adding that line to ${rc_file} to persist it." >&2
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir) INSTALL_DIR="${2:?--dir requires a value}"; shift 2 ;;
      --version) VERSION="${2:?--version requires a value}"; shift 2 ;;
      --repo) REPO="${2:?--repo requires a value}"; shift 2 ;;
      --name) EXPLICIT_NAME="${2:?--name requires a value}"; shift 2 ;;
      --help) HELP_REQUESTED=1; return 0 ;;
      *)
        echo "Error: unknown argument '$1'" >&2
        return 1
        ;;
    esac
  done
}

main() {
  EXPLICIT_NAME="$CLI_NAME"

  if ! parse_args "$@"; then
    usage >&2
    return 1
  fi

  if [ "$HELP_REQUESTED" = "1" ]; then
    usage
    return 0
  fi

  if [ -n "$EXPLICIT_NAME" ] && ! validate_brand "$EXPLICIT_NAME"; then
    echo "Error: invalid --name/CLI_NAME '${EXPLICIT_NAME}' (expected security-scan or deep-health)" >&2
    return 1
  fi

  CLI_NAME="$(choose_brand "$EXPLICIT_NAME")"

  downloader="$(require_downloader)"
  asset_suffix="$(detect_target)"
  release_json="$(fetch_release_json "$downloader")"
  asset_url="$(select_asset_url "$release_json" "$CLI_NAME" "$asset_suffix")"

  install_binary "$asset_url" "$downloader"
  check_path
}

if [ "${INSTALL_SH_LIB:-0}" != "1" ]; then
  main "$@"
fi
