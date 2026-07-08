#!/usr/bin/env sh
# shellcheck shell=sh
#
# Hermetic POSIX test for install.sh's pure functions. No network calls —
# GitHub Releases API responses are provided via an inline JSON fixture.
#
# Run: sh tests/install.sh.test.sh
set -u

exec < /dev/null

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "PASS: $1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "FAIL: $1 -- $2"
}

assert_success() {
  label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass "$label"
  else
    fail "$label" "expected success, command failed: $*"
  fi
}

assert_failure() {
  label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail "$label" "expected failure, command succeeded: $*"
  else
    pass "$label"
  fi
}

assert_output_eq() {
  label="$1"
  expected="$2"
  shift 2
  if actual="$("$@" 2>/dev/null)"; then
    if [ "$actual" = "$expected" ]; then
      pass "$label"
    else
      fail "$label" "expected '${expected}', got '${actual}'"
    fi
  else
    fail "$label" "command failed unexpectedly: $*"
  fi
}

assert_contains() {
  label="$1"
  haystack="$2"
  needle="$3"
  case "$haystack" in
    *"$needle"*) pass "$label" ;;
    *) fail "$label" "expected output to contain '${needle}'" ;;
  esac
}

# shellcheck source=install.sh
INSTALL_SH_LIB=1
export INSTALL_SH_LIB
. ./install.sh

# --- validate_brand -----------------------------------------------------

assert_success "validate_brand accepts security-scan" validate_brand security-scan
assert_success "validate_brand accepts deep-health" validate_brand deep-health
assert_failure "validate_brand rejects unknown brand" validate_brand nonsense-cli
assert_failure "validate_brand rejects empty string" validate_brand ""

# --- choose_brand --------------------------------------------------------

assert_output_eq "choose_brand echoes explicit valid brand" \
  "deep-health" choose_brand "deep-health"

assert_output_eq "choose_brand falls back to default when non-interactive" \
  "security-scan" choose_brand ""

assert_failure "choose_brand rejects an invalid explicit brand" choose_brand "not-a-brand"

# --- map_target ------------------------------------------------------------

assert_output_eq "map_target linux/x86_64/glibc -> linux-x64.bin" \
  "linux-x64.bin" map_target Linux x86_64 0

assert_output_eq "map_target linux/x86_64/musl -> linux-x64-musl.bin" \
  "linux-x64-musl.bin" map_target Linux x86_64 1

assert_output_eq "map_target linux/aarch64/glibc -> linux-arm64.bin" \
  "linux-arm64.bin" map_target Linux aarch64 0

assert_output_eq "map_target linux/arm64/glibc -> linux-arm64.bin" \
  "linux-arm64.bin" map_target Linux arm64 0

assert_failure "map_target linux/aarch64/musl is unsupported" map_target Linux aarch64 1

assert_output_eq "map_target darwin/arm64 -> macos-arm64" \
  "macos-arm64" map_target Darwin arm64 0

assert_failure "map_target darwin/x86_64 (Intel) is unsupported" map_target Darwin x86_64 0

assert_output_eq "map_target MINGW -> win-x64.exe" \
  "win-x64.exe" map_target MINGW64_NT-10.0 x86_64 0

assert_failure "map_target unknown OS/arch is unsupported" map_target Plan9 risc-v 0

# --- select_asset_url (brand + platform anchored) ---------------------------

FIXTURE_JSON=$(cat <<'JSON'
{
  "tag_name": "v1.4.0",
  "name": "v1.4.0",
  "assets": [
    {
      "name": "security-scan-1.4.0-20260518-120000-linux-x64.bin",
      "browser_download_url": "https://github.com/ejklock/deep-health/releases/download/v1.4.0/security-scan-1.4.0-20260518-120000-linux-x64.bin"
    },
    {
      "name": "security-scan-1.4.0-20260518-120000-linux-x64-musl.bin",
      "browser_download_url": "https://github.com/ejklock/deep-health/releases/download/v1.4.0/security-scan-1.4.0-20260518-120000-linux-x64-musl.bin"
    },
    {
      "name": "security-scan-1.4.0-20260518-120000-linux-arm64.bin",
      "browser_download_url": "https://github.com/ejklock/deep-health/releases/download/v1.4.0/security-scan-1.4.0-20260518-120000-linux-arm64.bin"
    },
    {
      "name": "security-scan-1.4.0-20260518-120000-macos-arm64",
      "browser_download_url": "https://github.com/ejklock/deep-health/releases/download/v1.4.0/security-scan-1.4.0-20260518-120000-macos-arm64"
    },
    {
      "name": "security-scan-1.4.0-20260518-120000-win-x64.exe",
      "browser_download_url": "https://github.com/ejklock/deep-health/releases/download/v1.4.0/security-scan-1.4.0-20260518-120000-win-x64.exe"
    },
    {
      "name": "deep-health-1.4.0-20260518-120000-linux-x64.bin",
      "browser_download_url": "https://github.com/ejklock/deep-health/releases/download/v1.4.0/deep-health-1.4.0-20260518-120000-linux-x64.bin"
    },
    {
      "name": "deep-health-1.4.0-20260518-120000-macos-arm64",
      "browser_download_url": "https://github.com/ejklock/deep-health/releases/download/v1.4.0/deep-health-1.4.0-20260518-120000-macos-arm64"
    }
  ]
}
JSON
)

assert_output_eq "select_asset_url: security-scan linux-x64.bin is not the musl asset" \
  "https://github.com/ejklock/deep-health/releases/download/v1.4.0/security-scan-1.4.0-20260518-120000-linux-x64.bin" \
  select_asset_url "$FIXTURE_JSON" security-scan linux-x64.bin

assert_output_eq "select_asset_url: security-scan linux-x64-musl.bin resolves the musl asset" \
  "https://github.com/ejklock/deep-health/releases/download/v1.4.0/security-scan-1.4.0-20260518-120000-linux-x64-musl.bin" \
  select_asset_url "$FIXTURE_JSON" security-scan linux-x64-musl.bin

assert_output_eq "select_asset_url: deep-health macos-arm64 is not the security-scan asset" \
  "https://github.com/ejklock/deep-health/releases/download/v1.4.0/deep-health-1.4.0-20260518-120000-macos-arm64" \
  select_asset_url "$FIXTURE_JSON" deep-health macos-arm64

assert_output_eq "select_asset_url: security-scan win-x64.exe" \
  "https://github.com/ejklock/deep-health/releases/download/v1.4.0/security-scan-1.4.0-20260518-120000-win-x64.exe" \
  select_asset_url "$FIXTURE_JSON" security-scan win-x64.exe

assert_failure "select_asset_url: deep-health win-x64.exe has no matching asset in fixture" \
  select_asset_url "$FIXTURE_JSON" deep-health win-x64.exe

assert_failure "select_asset_url: unknown brand has no matching asset" \
  select_asset_url "$FIXTURE_JSON" totally-unknown-cli linux-x64.bin

# Exercise the grep/awk fallback parser directly regardless of local jq availability.
assert_output_eq "select_asset_url_fallback: security-scan linux-arm64.bin" \
  "https://github.com/ejklock/deep-health/releases/download/v1.4.0/security-scan-1.4.0-20260518-120000-linux-arm64.bin" \
  select_asset_url_fallback "$FIXTURE_JSON" security-scan linux-arm64.bin

assert_failure "select_asset_url_fallback: no match returns nonzero" \
  select_asset_url_fallback "$FIXTURE_JSON" deep-health linux-arm64.bin

if command -v jq >/dev/null 2>&1; then
  assert_output_eq "select_asset_url_jq: deep-health linux-x64.bin" \
    "https://github.com/ejklock/deep-health/releases/download/v1.4.0/deep-health-1.4.0-20260518-120000-linux-x64.bin" \
    select_asset_url_jq "$FIXTURE_JSON" deep-health linux-x64.bin
else
  pass "select_asset_url_jq: skipped (jq not installed locally, dispatcher still covered by fallback)"
fi

# --- usage / --help --------------------------------------------------------

USAGE_OUTPUT="$(usage)"

if [ -n "$USAGE_OUTPUT" ]; then
  pass "usage output is non-empty"
else
  fail "usage output is non-empty" "usage produced no output"
fi

assert_contains "usage mentions --dir" "$USAGE_OUTPUT" "--dir"
assert_contains "usage mentions --version" "$USAGE_OUTPUT" "--version"
assert_contains "usage mentions --name" "$USAGE_OUTPUT" "--name"

# --- summary -----------------------------------------------------------

echo "Result: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi

exit 0
