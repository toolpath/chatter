#!/usr/bin/env bash
# Adds the table "Which file do I need?" to the notes of a GitHub Release, after the other notes.
# If the notes have the table already, it is replaced, so the release job can run again.
# The release job in .github/workflows/docker.yml runs it after it adds the files.
#
# Run:   GH_TOKEN=<token> tools/release/add-download-table.sh v1.2.0
# Needs: gh (the GitHub command line tool)
set -euo pipefail

TABLE_START="<!-- chatter-downloads -->"
TABLE_END="<!-- /chatter-downloads -->"

main() {
  [ "$#" -eq 1 ] || fail "Usage: add-download-table.sh <tag, such as v1.2.0>"
  local tag="$1"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "The tag must look like v1.2.0, not: $tag"

  # Global, because the trap runs after main ends
  notes_file="$(mktemp)"
  trap 'rm -f "$notes_file"' EXIT
  gh release view "$tag" --json body --jq .body | without_old_table > "$notes_file"
  printf '\n%s\n' "$(download_table "${tag#v}")" >> "$notes_file"
  gh release edit "$tag" --notes-file "$notes_file"
}

fail() {
  echo "add-download-table: $*" >&2
  exit 1
}

# Prints the notes without the lines from TABLE_START to TABLE_END, and without empty lines at the end,
# so that a second run does not add empty lines
without_old_table() {
  awk -v start="$TABLE_START" -v end="$TABLE_END" '
    $0 == start { in_table = 1; next }
    $0 == end { in_table = 0; next }
    in_table { next }
    /^[[:space:]]*$/ { empty_lines = empty_lines $0 "\n"; next }
    { printf "%s%s\n", empty_lines, $0; empty_lines = "" }
  '
}

download_table() {
  local version="$1"
  cat << EOF
$TABLE_START
## Which file do I need?

| You have | Download | Then |
|---|---|---|
| A computer with an Intel or AMD processor | \`chatter-$version-docker-amd64.zip\` | Unzip it, and do the steps in \`chatter/README.txt\`. |
| A computer with a 64-bit ARM processor, such as a Mac with Apple silicon | \`chatter-$version-docker-arm64.zip\` | Unzip it, and do the steps in \`chatter/README.txt\`. This version cannot read FANUC machines. For FANUC, use the Intel/AMD package: a Mac runs it with emulation. |
| A Raspberry Pi with the Chatter card, to update it | \`chatter-update-$version-armv7.tar\` | In Chatter, go to **Settings > Updates** and click **Upload update file**. |
| A new Raspberry Pi | \`chatter-imager.json\` | Open it in Raspberry Pi Imager. Imager downloads the card image (\`chatter.img.xz\`) itself. See **Install on a Raspberry Pi** in the docs. |
$TABLE_END
EOF
}

main "$@"
