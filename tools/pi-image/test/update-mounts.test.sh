#!/usr/bin/env bash
# Tests for in-pi/docker-compose.override.yml, with real Docker (not a fake).
# Proves that the "node" user in the Chatter container can write in update/inbox/, but not in update/,
# also with the container rights of docker-compose.yml. Also proves that the override file keeps those rights.
# Needs Docker, jq and the node:22-bookworm-slim image (the base of the Chatter image). It pulls the image if needed.
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

# Runs a shell command in a container as the node user (uid 1000), with the mounts of the override file
# and the container rights of the chatterbox service in docker-compose.yml.
# The Mac has bash 3.2, so this reads the mounts with a loop, not with mapfile.
run_as_node() {
  local options=() mount
  while IFS= read -r mount; do
    options+=(--volume "$mount")
  done < <(override_mounts)
  docker run --rm --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 256 \
    "${options[@]}" "$NODE_IMAGE" sh -c "$1" > /dev/null 2>&1
}

compose_config() {
  docker compose --project-directory "$REPO_ROOT" \
    --file "$REPO_ROOT/docker-compose.yml" --file "$OVERRIDE" config "$@" 2> /dev/null
}

# Reads the compose config (JSON) on stdin. True when the jq filter $2 is true for the service $1.
service_has() {
  jq -e --arg service "$1" ".services[\$service] | $2" > /dev/null
}

# The Pi uses docker-compose.yml with the override file. Docker Compose merges them, so this reads the merged config.
test_compose_keeps_the_container_rights() {
  local config service
  config="$(compose_config --format json)"
  check "Compose gives the config as JSON" jq -e '.services.chatterbox' > /dev/null <<< "$config"
  for service in chatterbox victoriametrics vmalert; do
    check "$service drops all capabilities" service_has "$service" '.cap_drop == ["ALL"]' <<< "$config"
    check "$service gets no capability back" service_has "$service" '(.cap_add // []) == []' <<< "$config"
    check "$service is not privileged" service_has "$service" '(.privileged // false) == false' <<< "$config"
    check "$service has only no-new-privileges:true" service_has "$service" '.security_opt == ["no-new-privileges:true"]' <<< "$config"
    check "$service has a process limit" service_has "$service" '.pids_limit > 0' <<< "$config"
  done
  check "chatterbox has the process limit 256" service_has chatterbox '.pids_limit == 256' <<< "$config"
  check "chatterbox runs as the user of the image" service_has chatterbox '.user == null' <<< "$config"
}

test_compose_keeps_the_data_volume_and_adds_the_update_folder() {
  local config
  config="$(compose_config)"
  check "Compose reads docker-compose.yml with the override file" test -n "$config"
  check "the Chatter container keeps its data volume" grep -q 'target: /app/data' <<< "$config"
  check "the Chatter container gets the update folder" grep -q 'target: /app/update$' <<< "$config"
  check "the Chatter container gets the inbox" grep -q 'target: /app/update/inbox' <<< "$config"
  check "the network history stays internal" grep -q 'internal: true' <<< "$(top_level_network history <<< "$config")"
}

# Prints the settings of one network in the top-level "networks:" of the compose config.
top_level_network() {
  awk -v name="  $1:" '/^networks:/ { in_networks = 1; next } /^[^ ]/ { in_networks = 0 }
    in_networks && $0 == name { in_network = 1; next } in_networks && /^  [^ ]/ { in_network = 0 }
    in_networks && in_network'
}

test_node_can_write_only_in_the_inbox() {
  make_update_folders
  check "node can write a file in update/inbox/" run_as_node 'echo x > /app/update/inbox/chatter-update.tar'
  check "node cannot write a file in update/" run_as_node '! touch /app/update/status.json'
  check "node cannot rename update/inbox/" run_as_node '! mv /app/update/inbox /app/update/other'
  check "node can read status.json in update/" run_as_node 'cat /app/update/status.json'
}

if ! command -v jq > /dev/null; then
  echo "FAIL - this test needs jq"
  exit 1
fi
docker image inspect "$NODE_IMAGE" > /dev/null 2>&1 || docker pull --quiet "$NODE_IMAGE" > /dev/null
test_compose_keeps_the_data_volume_and_adds_the_update_folder
test_compose_keeps_the_container_rights
test_node_can_write_only_in_the_inbox

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
