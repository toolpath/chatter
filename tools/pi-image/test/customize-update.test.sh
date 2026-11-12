#!/usr/bin/env bash
# Tests for the update helper part of customize.sh: the folders, owners, and modes on the card,
# and the copied files. It runs copy_chatter into a temporary folder, not into a card image.
# It runs as root in a Debian 13 container (see in-linux.sh), because it sets owners.
# Run:  tools/pi-image/test/customize-update.test.sh
set -uo pipefail
if [ "${IN_TEST_CONTAINER:-}" != 1 ]; then exec "$(dirname "$0")/in-linux.sh" "$0"; fi

failures=0
sandboxes=()
trap 'rm -rf "${sandboxes[@]}"' EXIT

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

# Loads customize.sh without running it, and points it at a temporary card and payload.
# $1: a folder of public keys for in-pi/update-keys/ (empty: none)
set_up() {
  sandbox="$(mktemp -d)"
  sandboxes+=("$sandbox")
  # shellcheck source-path=SCRIPTDIR source=../customize.sh
  IMAGE_URL="file:///test" source /pi-image/customize.sh
  set +e
  ROOT="$sandbox/card"
  PAYLOAD="$sandbox/payload"
  IN_PI="$sandbox/in-pi"
  cp -R /pi-image/in-pi "$IN_PI"
  rm -rf "$IN_PI/update-keys"
  if [ -n "$1" ]; then cp -R "$1" "$IN_PI/update-keys"; fi
  mkdir -p "$ROOT/etc/systemd/system" "$PAYLOAD/images"
  echo "services: {}" > "$PAYLOAD/docker-compose.yml"
  echo "groups: []" > "$PAYLOAD/rules.yml"
  echo "image" > "$PAYLOAD/images/chatter.tar.gz"
  echo "1.4.0" > "$PAYLOAD/installed-version"
}

# Prints "<owner uid>:<group gid> <mode>" of a file or folder on the card
owner_and_mode() {
  stat --format '%u:%g %a' "$ROOT/$1"
}

test_the_update_folders_have_the_owners_of_the_plan() {
  set_up ""
  copy_chatter > "$sandbox/output.log" 2>&1

  check "/opt/chatter/update is root, 0755" test "$(owner_and_mode opt/chatter/update)" = "0:0 755"
  check "/opt/chatter/update/inbox is uid 1000, so Chatter can write there" \
    test "$(owner_and_mode opt/chatter/update/inbox)" = "1000:1000 755"
  check "/var/lib/chatter-update is root only" test "$(owner_and_mode var/lib/chatter-update)" = "0:0 700"
  check "/opt/chatter/backups is root only" test "$(owner_and_mode opt/chatter/backups)" = "0:0 700"
  check "/etc/chatter/update-keys is root, 0755" test "$(owner_and_mode etc/chatter/update-keys)" = "0:0 755"
  check "installed-version has the version of the card" \
    test "$(cat "$ROOT/var/lib/chatter-update/installed-version")" = "1.4.0"
  check "installed-version is root only" test "$(owner_and_mode var/lib/chatter-update/installed-version)" = "0:0 600"
}

test_the_update_files_are_copied() {
  set_up ""
  copy_chatter > "$sandbox/output.log" 2>&1

  check "the helper is on the card and can run" test "$(owner_and_mode opt/chatter/update-chatter.sh)" = "0:0 755"
  check "the compose override is next to docker-compose.yml" test -f "$ROOT/opt/chatter/docker-compose.override.yml"
  check "the path unit is on the card" test -f "$ROOT/etc/systemd/system/chatter-update.path"
  check "the helper service is on the card" test -f "$ROOT/etc/systemd/system/chatter-update.service"
}

test_the_public_keys_are_copied() {
  local keys
  keys="$(mktemp -d)"
  sandboxes+=("$keys")
  echo "key one" > "$keys/chatter-2026.pub"
  echo "key two" > "$keys/chatter-2027.pub"
  echo "not a key" > "$keys/notes.txt"
  set_up "$keys"
  copy_chatter > "$sandbox/output.log" 2>&1

  check "each public key is copied" test -f "$ROOT/etc/chatter/update-keys/chatter-2026.pub" \
    -a -f "$ROOT/etc/chatter/update-keys/chatter-2027.pub"
  check "a public key can be read by all" test "$(owner_and_mode etc/chatter/update-keys/chatter-2026.pub)" = "0:0 644"
  check "only .pub files are copied" test ! -e "$ROOT/etc/chatter/update-keys/notes.txt"
  check "no warning when there is a key" bash -c "! grep -q 'Warning' '$sandbox/output.log'"
}

test_no_public_key_gives_a_warning() {
  set_up ""
  copy_chatter > "$sandbox/output.log" 2>&1
  local status=$?
  check "no public key: the build goes on" test "$status" -eq 0
  check "no public key: a clear warning" grep -q "Warning: there is no public update key" "$sandbox/output.log"
}

test_the_update_folders_have_the_owners_of_the_plan
test_the_update_files_are_copied
test_the_public_keys_are_copied
test_no_public_key_gives_a_warning

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
