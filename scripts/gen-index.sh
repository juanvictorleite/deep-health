#!/usr/bin/env bash
#
# gen-index.sh — generate the mechanical listing of a directory index.md from each
# concept doc's frontmatter, visibility-aware. The harden of "indexed or it doesn't
# exist": instead of hand-maintaining the listing (and having lint-docs only CHECK
# it), the listing is generated, so it cannot drift — and a public build filters by
# `visibility`, so a public index lists only public docs (no dangling links, no
# leak, by construction).
#
# Opt-in on a managed block. Only an index.md that CONTAINS the markers
#   <!-- index:auto:start -->  …  <!-- index:auto:end -->
# is touched; everything outside the block (intro prose, custom grouping, subdir
# links) is preserved verbatim. An index.md without the markers is left fully
# hand-authored — adoption is incremental, like the arch-gate's committed-ruleset
# opt-in.
#
# Subcommands:
#   gen   <bundle> [--visibility <csv>]   Rewrite every managed block in place.
#   check <bundle> [--visibility <csv>]   Exit 1 if any managed block is stale
#                                         (the "did you regenerate?" parity floor).
#
# --visibility <csv>  Include only docs whose frontmatter visibility ∈ the set
#                     (absent ⇒ private). Omitted ⇒ include every doc (dev build).
#                     e.g. --visibility public,showcase  → the public bundle's index.
#
# A listed row is:  * [<title>](<file>)  — <Status>
#   title  = frontmatter `title`, else the first '# ' heading, else the filename.
#   Status = frontmatter `status` (omitted from the row if absent).
# Rows are sorted by filename (so NNNN-slug docs list in numeric order).
#
# Follow-up (harden): bash is the prototyping rung, gated by tests/unit/gen-index.sh,
# the destination rung is TS in se-core, parity corpus moving with it.

set -uo pipefail

PROG="${0##*/}"
START_MARK='<!-- index:auto:start -->'
END_MARK='<!-- index:auto:end -->'

die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 2; }

# --- argument parsing -------------------------------------------------------

MODE="${1:-}"
case "$MODE" in
	gen | check) shift ;;
	-h | --help)
		grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'
		exit 0
		;;
	*) die "usage: $PROG <gen|check> <bundle> [--visibility <csv>]" ;;
esac

BUNDLE=""
VIS_FILTER=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--visibility) VIS_FILTER="${2:-}"; shift 2 ;;
		-*) die "unknown option: $1" ;;
		*) BUNDLE="$1"; shift ;;
	esac
done
[[ -n "$BUNDLE" ]] || die "usage: $PROG $MODE <bundle> [--visibility <csv>]"
BUNDLE="${BUNDLE%/}"
[[ -d "$BUNDLE" ]] || die "bundle root not found: $BUNDLE"

# --- frontmatter helpers ----------------------------------------------------

fm_value() { # fm_value <file> <key>
	awk -v key="$2" '
		NR == 1 && $0 != "---" { exit }
		NR == 1 { infm = 1; next }
		infm && $0 == "---" { exit }
		infm {
			if ($0 ~ "^" key ":") {
				sub("^" key ":[[:space:]]*", "")
				gsub(/^[[:space:]]+|[[:space:]]+$/, "")
				gsub(/^"|"$/, "")
				print; exit
			}
		}
	' "$1"
}

first_heading() { # first_heading <file> → text after the first '# '
	awk '/^# / { sub(/^# +/, ""); print; exit }' "$1"
}

doc_title() { # doc_title <file>
	local t; t="$(fm_value "$1" title)"
	[[ -z "$t" ]] && t="$(first_heading "$1")"
	if [[ -z "$t" ]]; then
		t="${1##*/}"; t="${t%.md}"
	fi
	printf '%s' "$t"
}

# visibility ∈ filter? absent ⇒ private. Empty filter ⇒ always include.
included() { # included <file>
	[[ -z "$VIS_FILTER" ]] && return 0
	local v; v="$(fm_value "$1" visibility)"; [[ -z "$v" ]] && v="private"
	case ",$VIS_FILTER," in *",$v,"*) return 0 ;; *) return 1 ;; esac
}

# --- generate the block body for one directory ------------------------------

render_block() { # render_block <dir>
	local dir="$1" f base title status
	while IFS= read -r f; do
		base="${f##*/}"
		[[ "$base" == "index.md" || "$base" == "log.md" ]] && continue
		included "$f" || continue
		title="$(doc_title "$f")"
		status="$(fm_value "$f" status)"
		if [[ -n "$status" ]]; then
			printf '* [%s](%s) — %s\n' "$title" "$base" "$status"
		else
			printf '* [%s](%s)\n' "$title" "$base"
		fi
	done < <(find "$dir" -maxdepth 1 -type f -name '*.md' | sort)
}

# Splice the rendered body between the markers in <index>; print result to stdout.
splice() { # splice <index> <blockfile>
	awk -v s="$START_MARK" -v e="$END_MARK" -v bf="$2" '
		index($0, s) { print; while ((getline line < bf) > 0) print line; close(bf); skipping=1; next }
		index($0, e) { skipping=0; print; next }
		!skipping { print }
	' "$1"
}

# --- driver -----------------------------------------------------------------

STALE=0
CHANGED=0
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT

while IFS= read -r idx; do
	grep -qF "$START_MARK" "$idx" || continue
	grep -qF "$END_MARK"  "$idx" || { echo "  $idx: has start marker but no end marker — skipped"; STALE=1; continue; }
	render_block "$(dirname "$idx")" >"$TMP"
	new="$(splice "$idx" "$TMP")"
	if [[ "$new" == "$(cat "$idx")" ]]; then
		continue
	fi
	if [[ "$MODE" == "gen" ]]; then
		printf '%s\n' "$new" >"$idx"
		echo "  regenerated: $idx"
		CHANGED=$((CHANGED + 1))
	else
		echo "  STALE: $idx — managed block out of date (run: $PROG gen $BUNDLE)"
		STALE=1
	fi
done < <(find "$BUNDLE" -type f -name 'index.md' | sort)

if [[ "$MODE" == "check" ]]; then
	if [[ "$STALE" -ne 0 ]]; then
		echo "$PROG: FAIL — managed index block(s) out of date." >&2
		exit 1
	fi
	echo "$PROG: OK — all managed index blocks current."
	exit 0
fi

echo "$PROG: regenerated $CHANGED managed index block(s)."
exit 0
