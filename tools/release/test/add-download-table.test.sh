#!/usr/bin/env bash
# Tests for add-download-table.sh. A fake "gh" keeps the release notes in a file, so the tests need no GitHub.
# Run:  tools/release/test/add-download-table.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/add-download-table.sh"
failures=0

sandboxes=()
trap 'rm -rf "${sandboxes[@]}"' EXIT

# Makes a temporary folder with a fake gh. The release notes start as the given text.
# "gh release view --json body --jq .body" prints the notes. "gh release edit --notes-file" replaces them.
set_up() {
  sandbox="$(mktemp -d)"
  sandboxes+=("$sandbox")
  mkdir -p "$sandbox/bin"
  printf '%s' "$1" > "$sandbox/notes.md"
  cat > "$sandbox/bin/gh" << 'EOF'
#!/usr/bin/env bash
sandbox="$(dirname "$0")/.."
echo "$*" >> "$sandbox/gh-calls.log"
case "$1 $2" in
  "release view") cat "$sandbox/notes.md"; echo ;;
  "release edit") cp "${*: -1}" "$sandbox/notes.md" ;;
  *) echo "fake gh: unknown command $*" >&2; exit 1 ;;
esac
EOF
  chmod +x "$sandbox/bin/gh"
}

add_table() {
  PATH="$sandbox/bin:$PATH" "$SCRIPT" "$@" > "$sandbox/output.log" 2>&1
}

check() {
  local description="$1"
  shift
  if "$@"; then
    echo "ok   - $description"
  else
    echo "FAIL - $description"
    failures=$((failures + 1))
  fi
}

notes_have() {
  grep -qF -- "$1" "$sandbox/notes.md"
}

count_in_notes() {
  grep -cF -- "$1" "$sandbox/notes.md"
}

test_adds_the_table_after_the_notes() {
  set_up "## What's Changed
* New things"
  add_table v1.2.0
  check "the script ends with success" test "$?" -eq 0
  check "the notes of the release stay first" test "$(head -1 "$sandbox/notes.md")" = "## What's Changed"
  check "the table has a heading" notes_have "## Which file do I need?"
  check "a computer with Intel/AMD: the amd64 Docker package" notes_have "\`chatter-1.2.0-docker-amd64.zip\`"
  check "a computer with 64-bit ARM: the arm64 Docker package" notes_have "\`chatter-1.2.0-docker-arm64.zip\`"
  check "a Chatter Pi: the armv7 update file" notes_have "\`chatter-update-1.2.0-armv7.tar\`"
  check "a new Pi: only the list file, because Imager downloads the card itself" \
    notes_have "| A new Raspberry Pi | \`chatter-imager.json\` |"
  check "no update file for a computer, because the release does not have one" \
    test "$(count_in_notes "chatter-update-1.2.0-amd64.tar")$(count_in_notes "chatter-update-1.2.0-arm64.tar")" = "00"
}

# The release job can run again. Then the table is replaced, not added a second time.
test_replaces_an_old_table() {
  set_up "Notes"
  add_table v1.2.0
  add_table v1.2.0
  check "a second run: one table only" test "$(count_in_notes "## Which file do I need?")" -eq 1
  check "a second run: the notes stay" notes_have "Notes"
  local first_run
  first_run="$(cat "$sandbox/notes.md")"
  add_table v1.2.0
  check "a third run: the notes are the same, with no new empty lines" test "$(cat "$sandbox/notes.md")" = "$first_run"
}

test_keeps_text_after_the_table() {
  set_up "Notes"
  add_table v1.2.0
  printf '\nText that a person added after the table\n' >> "$sandbox/notes.md"
  add_table v1.2.0
  check "text after the table stays" notes_have "Text that a person added after the table"
  check "text after the table: one table only" test "$(count_in_notes "## Which file do I need?")" -eq 1
}

test_refuses_a_tag_that_is_not_a_release() {
  local tag
  for tag in "1.2.0" "v1.2" "v1.2.0-rc1"; do
    set_up "Notes"
    add_table "$tag"
    check "refuses the tag $tag" test "$?" -ne 0
    check "the tag $tag: the notes do not change" test "$(cat "$sandbox/notes.md")" = "Notes"
  done
}

test_adds_the_table_after_the_notes
test_replaces_an_old_table
test_keeps_text_after_the_table
test_refuses_a_tag_that_is_not_a_release

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
