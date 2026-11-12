#!/usr/bin/env bash
# Tests for in-pi/docker-compose.override.yml, with real Docker (not a fake).
# Proves that the "node" user in the Chatter container can write in update/inbox/, but not in update/.
# Needs Docker and the node:22-bookworm-slim image (the base of the Chatter image). It pulls the image if needed.
# Run:  tools/pi-image/test/update-mounts.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
OVERRIDE="$HERE/in-pi/docker-compose.override.yml"
NODE_IMAGE="node:22-bookworm-slim"
failures=0

sandbox="$(mktemp -d)"
# The files in the sandbox belong to root and uid 1000, so a container deletes them.
trap 'docker run --rm --volume "$sandbox:/sandbox" debian:trixie rm -rf /sandbox/update; rm -rf "$sandbox"' EXIT

# Runs a check command. The first argument tells what the check proves.
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

# Makes the folders as customize.sh does on the card: update/ belongs to root (0755), update/inbox/ to uid 1000.
# The helper writes status.json in update/.
make_update_folders() {
  docker run --rm --volume "$sandbox:/card" debian:trixie sh -c \
    'install -d -m 0755 -o 0 -g 0 /card/update && install -d -m 0755 -o 1000 -g 1000 /card/update/inbox \
     && echo "{}" > /card/update/status.json'
}

# Prints each mount of the override file, with the sandbox in place of "./", one on each line.
override_mounts() {
  awk -v sandbox="$sandbox" '/^ *- \.\// { sub(/^ *- \.\//, ""); print sandbox "/" $0 }' "$OVERRIDE"
}

# Runs a shell command in a container as the node user (uid 1000), with the mounts of the override file.
# The Mac has bash 3.2, so this reads the mounts with a loop, not with mapfile.
run_as_node() {
  local options=() mount
  while IFS= read -r mount; do
    options+=(--volume "$mount")
  done < <(override_mounts)
  docker run --rm --user 1000:1000 "${options[@]}" "$NODE_IMAGE" sh -c "$1" > /dev/null 2>&1
}

compose_config() {
  docker compose --project-directory "$REPO_ROOT" \
    --file "$REPO_ROOT/docker-compose.yml" --file "$OVERRIDE" config 2> /dev/null
}

test_compose_keeps_the_data_volume_and_adds_the_update_folder() {
  local config
  config="$(compose_config)"
  check "Compose reads docker-compose.yml with the override file" test -n "$config"
  check "the Chatter container keeps its data volume" grep -q 'target: /app/data' <<< "$config"
  check "the Chatter container gets the update folder" grep -q 'target: /app/update$' <<< "$config"
  check "the Chatter container gets the inbox" grep -q 'target: /app/update/inbox' <<< "$config"
}

test_node_can_write_only_in_the_inbox() {
  make_update_folders
  check "node can write a file in update/inbox/" run_as_node 'echo x > /app/update/inbox/chatter-update.tar'
  check "node cannot write a file in update/" run_as_node '! touch /app/update/status.json'
  check "node cannot rename update/inbox/" run_as_node '! mv /app/update/inbox /app/update/other'
  check "node can read status.json in update/" run_as_node 'cat /app/update/status.json'
}

docker image inspect "$NODE_IMAGE" > /dev/null 2>&1 || docker pull --quiet "$NODE_IMAGE" > /dev/null
test_compose_keeps_the_data_volume_and_adds_the_update_folder
test_node_can_write_only_in_the_inbox

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
