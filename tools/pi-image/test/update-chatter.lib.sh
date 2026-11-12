#!/usr/bin/env bash
# Shared parts of the tests for in-pi/update-chatter.sh (the update helper).
# The tests run as root in a Debian 13 container (see in-linux.sh), as the helper does on the Pi.
# Each test gets a sandbox: a folder that stands for "/" of the Pi (UPDATE_ROOT), and fake commands:
# - docker: keeps images, one Chatter container, and the data volume as files in $sandbox/fake
# - curl: answers /api/health with the version of the running Chatter image
# - dpkg: gives the processor type (FAKE_ARCH, default armhf)
# - df: gives the free space (FAKE_FREE_BYTES, default 10 GB). It hangs one time when the file FAKE_DF_HANGS_WITHOUT is gone.
# - cp: the real cp, but it fails when its arguments contain FAKE_CP_FAILS_ON
# - mv: the real mv. FAKE_SLOW_BUSY_STATUS=1: a status.json that says "checking" takes 0.5 seconds to put in place
# A throwaway signing key is made at each run. No private key is in the repo.

HELPER=/pi-image/in-pi/update-chatter.sh
KEY_ID="test-2026"
OLD_VERSION="1.1.0"
NEW_VERSION="1.2.0"
OLD_VM_TAG="v1.155.0"
NEW_VM_TAG="v1.156.0"
failures=0

keys_dir="$(mktemp -d)"
sandboxes=("$keys_dir")
trap 'rm -rf "${sandboxes[@]}"' EXIT
openssl genpkey -algorithm ed25519 -out "$keys_dir/$KEY_ID.pem" 2> /dev/null
openssl pkey -in "$keys_dir/$KEY_ID.pem" -pubout -out "$keys_dir/$KEY_ID.pub"
openssl genpkey -algorithm ed25519 -out "$keys_dir/other.pem" 2> /dev/null

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

finish_tests() {
  if [ "$failures" -ne 0 ]; then
    echo "$failures check(s) failed"
    exit 1
  fi
  echo "All checks passed"
}

# ---------- The sandbox ----------

# Makes a new sandbox with version 1.1.0 installed and running. Sets $sandbox, $root, $fake, $inbox, $state_dir.
set_up() {
  sandbox="$(mktemp -d)"
  sandboxes+=("$sandbox")
  # uid 1000 (the node user in the fake containers) must reach the data volume
  chmod 755 "$sandbox"
  root="$sandbox/root"
  fake="$sandbox/fake"
  inbox="$root/opt/chatter/update/inbox"
  state_dir="$root/var/lib/chatter-update"
  mkdir -p "$sandbox/bin" "$sandbox/build" "$fake/volumes/chatter_chatterbox-data"
  install -d -m 0755 "$root/opt/chatter/vmalert" "$root/opt/chatter/update" "$root/etc/chatter/update-keys"
  install -d -m 0755 -o 1000 -g 1000 "$inbox"
  install -d -m 0700 "$state_dir"
  mkdir -p "$root/proc/sys/kernel/random"
  echo "boot-1" > "$root/proc/sys/kernel/random/boot_id"
  cp "$keys_dir/$KEY_ID.pub" "$root/etc/chatter/update-keys/"
  echo "$OLD_VERSION" > "$state_dir/installed-version"
  write_compose "$root/opt/chatter/docker-compose.yml" "$OLD_VERSION" "$OLD_VM_TAG"
  echo "# rules of $OLD_VERSION" > "$root/opt/chatter/vmalert/rules.yml"
  make_fake_commands
  make_fake_docker_state
}

write_compose() {
  cat > "$1" << EOF
services:
  chatterbox:
    image: ghcr.io/toolpath/chatter:$2
  victoriametrics:
    image: victoriametrics/victoria-metrics:$3
  vmalert:
    image: victoriametrics/vmalert:$3
EOF
}

fake_image_id() {
  echo "sha256:$(printf '%s' "$1" | sha256sum | cut -c 1-64)"
}

# The Pi has the version before the current one (1.0.0), the current one (1.1.0), and an image that is not Chatter's.
# The Chatter data belongs to uid 1000 (node), as in the real volume.
make_fake_docker_state() {
  local image
  : > "$fake/calls.log"
  : > "$fake/images.txt"
  for image in ghcr.io/toolpath/chatter:1.0.0 "ghcr.io/toolpath/chatter:$OLD_VERSION" \
    "victoriametrics/victoria-metrics:$OLD_VM_TAG" "victoriametrics/vmalert:$OLD_VM_TAG" debian:trixie; do
    echo "$image $(fake_image_id "$image")" >> "$fake/images.txt"
  done
  echo "ghcr.io/toolpath/chatter:$OLD_VERSION" > "$fake/old-tag"
  (cd "$root/opt/chatter" && PATH="$sandbox/bin:$PATH" FAKE_DIR="$fake" docker compose up --detach)
  : > "$fake/calls.log"
  local data="$fake/volumes/chatter_chatterbox-data"
  echo "old-db" > "$data/chatter.db"
  mkdir -p "$data/focas"
  echo "old-library" > "$data/focas/libfwlib32.so"
  chown -R 1000:1000 "$data"
}

make_fake_commands() {
  cat > "$sandbox/bin/dpkg" << 'EOF'
#!/bin/sh
[ "$1" = "--print-architecture" ] && echo "${FAKE_ARCH:-armhf}"
EOF
  cat > "$sandbox/bin/df" << 'EOF'
#!/bin/sh
if [ -n "${FAKE_DF_HANGS_WITHOUT:-}" ] && [ ! -e "$FAKE_DF_HANGS_WITHOUT" ] && [ ! -e "$FAKE_DIR/hung" ]; then
  echo "$$" > "$FAKE_DIR/hung"
  exec sleep 600
fi
echo "Avail"
echo "${FAKE_FREE_BYTES:-10000000000}"
EOF
  cat > "$sandbox/bin/curl" << 'EOF'
#!/bin/sh
running_tag="$(cat "$FAKE_DIR/running-tag")"
echo "{\"status\":\"ok\",\"uptime\":1,\"version\":\"${FAKE_HEALTH_VERSION:-${running_tag##*:}}\"}"
EOF
  cat > "$sandbox/bin/cp" << 'EOF'
#!/usr/bin/env bash
if [ -n "${FAKE_CP_FAILS_ON:-}" ] && [[ "$*" == *"$FAKE_CP_FAILS_ON"* ]]; then exit 1; fi
exec /bin/cp "$@"
EOF
  cat > "$sandbox/bin/mv" << 'EOF'
#!/usr/bin/env bash
if [ "${FAKE_SLOW_BUSY_STATUS:-0}" = 1 ] && [[ ${!#} == */status.json ]] \
  && grep -q '"state":"checking"' "${@: -2:1}" 2> /dev/null; then
  sleep 0.5
fi
exec /bin/mv "$@"
EOF
  write_fake_docker "$sandbox/bin/docker"
  chmod +x "$sandbox/bin/"*
}

# The fake docker. Its state is in $FAKE_DIR:
#   images.txt         one line for each image: "<repository>:<tag> <image id>"
#   container          the ID of the Chatter container; container-image: its image ID; running-tag: its image
#   volumes/<name>/    the files of a volume
#   calls.log          each call, one on each line
# It fails when its arguments contain FAKE_DOCKER_FAILS_ON (FAKE_DOCKER_FAILS_FROM=2: from the second such call). It hangs one time when they contain FAKE_DOCKER_HANGS_ON:
# then the file "hung" holds the process ID of the hung call (stop_hung_docker ends it).
# FAKE_DOCKER_IGNORES_TERM=1: the hung call ignores SIGTERM, as a container whose first process has no handler does.
# FAKE_HEALTH: the health of the container (default healthy). FAKE_SAME_CONTAINER=1: "compose up" keeps the old container.
# FAKE_STOPPED_SERVICE: a service that does not run after "compose up".
# A Chatter image other than the first one changes the database at its start, as a new version can.
write_fake_docker() {
  cat > "$1" << 'EOF'
#!/usr/bin/env bash
set -uo pipefail
fake="$FAKE_DIR"
images="$fake/images.txt"
echo "$*" >> "$fake/calls.log"
if [ -n "${FAKE_DOCKER_FAILS_ON:-}" ] && [[ "$*" == *"$FAKE_DOCKER_FAILS_ON"* ]]; then
  matches=$(( $(cat "$fake/fail-count" 2> /dev/null || echo 0) + 1 ))
  echo "$matches" > "$fake/fail-count"
  [ "$matches" -lt "${FAKE_DOCKER_FAILS_FROM:-1}" ] || exit 1
fi
if [ -n "${FAKE_DOCKER_HANGS_ON:-}" ] && [[ "$*" == *"$FAKE_DOCKER_HANGS_ON"* ]] && [ ! -e "$fake/hung" ]; then
  echo "$$" > "$fake/hung"
  if [ "${FAKE_DOCKER_IGNORES_TERM:-0}" = 1 ]; then trap '' TERM; fi
  exec sleep 600
fi

image_id() {
  awk -v ref="$1" '$1 == ref { print $2; found = 1 } END { exit !found }' "$images"
}

forget_image() {
  awk -v ref="$1" '$1 != ref && substr($2, 8, 12) != ref' "$images" > "$images.new" && mv "$images.new" "$images"
}

image_command() {
  case "$1" in
    inspect) image_id "${!#}" ;;
    ls) awk '{ print $1, substr($2, 8, 12) }' "$images" ;;
    *) exit 1 ;;
  esac
}

remove_image() {
  grep -q -- "$1" "$images" || exit 1
  forget_image "$1"
}

load_image() {
  local tag id
  [ "$1" = "--input" ] || exit 1
  while read -r tag id; do
    forget_image "$tag"
    echo "$tag $id" >> "$images"
  done < <(gzip -dc "$2")
}

container_command() {
  case "$2" in
    '{{.Image}}') cat "$fake/container-image" ;;
    '{{.State.Health.Status}}') echo "${FAKE_HEALTH:-healthy}" ;;
    *) exit 1 ;;
  esac
}

# docker run: runs the command here, with each mount target replaced by the folder that it mounts.
run_container() {
  local user="0:0" entrypoint="" mounts=() source target arg command=() image
  while [ $# -gt 0 ]; do
    case "$1" in
      --rm | --init | --pull=never) shift ;;
      --network) shift 2 ;;
      --user) user="$2"; shift 2 ;;
      --entrypoint) entrypoint="$2"; shift 2 ;;
      --volume)
        source="${2%%:*}"; target="${2#*:}"; target="${target%:ro}"; target="${target%:rw}"
        [[ $source == /* ]] || source="$fake/volumes/$source"
        mounts+=("$target=$source"); shift 2 ;;
      -*) echo "fake docker: unknown option $1" >&2; exit 1 ;;
      *) break ;;
    esac
  done
  image="$1"; shift
  image_id "$image" > /dev/null || exit 1
  for arg in "$entrypoint" "$@"; do
    for mount in "${mounts[@]}"; do arg="${arg//"${mount%%=*}"/"${mount#*=}"}"; done
    command+=("$arg")
  done
  if [ "$user" = "0:0" ]; then
    "${command[@]}"
  else
    setpriv --reuid="${user%:*}" --regid="${user#*:}" --clear-groups "${command[@]}"
  fi
}

new_version_changes_the_database() {
  local data="$fake/volumes/chatter_chatterbox-data"
  setpriv --reuid=1000 --regid=1000 --clear-groups sh -c \
    "echo new-db > '$data/chatter.db' && echo new-wal > '$data/chatter.db-wal' && echo new-shm > '$data/chatter.db-shm'"
}

compose_up() {
  local image tag number
  for image in $(sed -n 's/^ *image: *//p' "$PWD/docker-compose.yml"); do
    image_id "$image" > /dev/null || exit 1
  done
  tag="$(sed -n 's/^ *image: *\(ghcr.io\/toolpath\/chatter:.*\)$/\1/p' "$PWD/docker-compose.yml")"
  if [ "${FAKE_SAME_CONTAINER:-0}" != 1 ] || [ ! -s "$fake/container" ]; then
    number=$(( $(cat "$fake/counter" 2> /dev/null || echo 0) + 1 ))
    echo "$number" > "$fake/counter"
    echo "container-$number" > "$fake/container"
    image_id "$tag" > "$fake/container-image"
  fi
  echo "$tag" > "$fake/running-tag"
  [ "$tag" = "$(cat "$fake/old-tag")" ] || new_version_changes_the_database
}

compose_command() {
  case "$*" in
    "ps --all --quiet chatterbox") cat "$fake/container" ;;
    "ps --status running --services") printf '%s\n' chatterbox victoriametrics vmalert | grep -vx "${FAKE_STOPPED_SERVICE:-none}" ;;
    "config --services") printf '%s\n' chatterbox victoriametrics vmalert ;;
    "stop chatterbox") ;;
    "up --detach"*) compose_up ;;
    *) echo "fake docker: unknown compose command $*" >&2; exit 1 ;;
  esac
}

command="$1"
shift
case "$command" in
  image) image_command "$@" ;;
  rmi) remove_image "$1" ;;
  load) load_image "$@" ;;
  volume) echo "chatter_chatterbox-data" ;;
  run) run_container "$@" ;;
  inspect) container_command "$@" ;;
  compose) compose_command "$@" ;;
  *) echo "fake docker: unknown command $command" >&2; exit 1 ;;
esac
EOF
}

# ---------- Update files ----------

# Makes the files of an update file in a new folder, and prints the folder.
# A fake image file holds the lines that the fake "docker load" reads: "<tag> <image id>".
make_payload() {
  local version="$1" vm_tag="${2:-$NEW_VM_TAG}" dir image name
  dir="$(mktemp -d "$sandbox/build/payload.XXXXXX")"
  for image in "ghcr.io/toolpath/chatter:$version" "victoriametrics/victoria-metrics:$vm_tag" "victoriametrics/vmalert:$vm_tag"; do
    name="$(image_member "$image")"
    echo "$image $(fake_image_id "$image")" | gzip > "$dir/$name"
  done
  write_compose "$dir/docker-compose.yml" "$version" "$vm_tag"
  echo "# rules of $version" > "$dir/rules.yml"
  echo "$dir"
}

image_member() {
  case "$1" in
    ghcr.io/toolpath/chatter:*) echo chatter.tar.gz ;;
    victoriametrics/victoria-metrics:*) echo victoria-metrics.tar.gz ;;
    victoriametrics/vmalert:*) echo vmalert.tar.gz ;;
  esac
}

# Writes manifest.txt in a payload folder, with a "file" line for each file there.
# Options (environment): MANIFEST_ARCH (armv7), MANIFEST_KEY_ID ($KEY_ID), MANIFEST_EXTRA (more lines at the end).
write_manifest() {
  local dir="$1" version="$2" name
  {
    echo "format 1"
    echo "version $version"
    echo "arch ${MANIFEST_ARCH:-armv7}"
    echo "keyId ${MANIFEST_KEY_ID:-$KEY_ID}"
    for name in chatter.tar.gz victoria-metrics.tar.gz vmalert.tar.gz docker-compose.yml rules.yml; do
      [ -f "$dir/$name" ] || continue
      echo "file $name $(sha256sum "$dir/$name" | cut -d ' ' -f 1) $(stat --format %s "$dir/$name")"
    done
    [ -z "${MANIFEST_EXTRA:-}" ] || printf '%s\n' "$MANIFEST_EXTRA"
  } > "$dir/manifest.txt"
}

sign_manifest() {
  local dir="$1" key="${2:-$keys_dir/$KEY_ID.pem}"
  openssl pkeyutl -sign -inkey "$key" -rawin -in "$dir/manifest.txt" -out "$dir/manifest.txt.sig"
}

# Packs a payload folder into the inbox as chatter-update.tar. Without names, it packs each file of the folder.
pack_into_inbox() {
  local dir="$1"
  shift
  if [ "$#" -eq 0 ]; then
    # shellcheck disable=SC2046 # the test files have no spaces in their names
    set -- $(cd "$dir" && ls)
  fi
  tar --create --file "$inbox/chatter-update.tar" --directory "$dir" -- "$@"
  chown 1000:1000 "$inbox/chatter-update.tar"
}

# Makes a correct, signed update file in the inbox. Prints its payload folder.
# shellcheck disable=SC2120 # some test files always use the default version
put_update_file() {
  local version="${1:-$NEW_VERSION}" dir
  dir="$(make_payload "$version")"
  write_manifest "$dir" "$version"
  sign_manifest "$dir"
  pack_into_inbox "$dir"
  echo "$dir"
}

# ---------- Running the helper ----------

helper_env() {
  env PATH="$sandbox/bin:$PATH" FAKE_DIR="$fake" UPDATE_ROOT="$root" \
    UPDATE_DOCKER_TIMEOUT="${UPDATE_DOCKER_TIMEOUT:-20s}" UPDATE_LOAD_TIMEOUT="${UPDATE_LOAD_TIMEOUT:-20s}" \
    UPDATE_HEALTH_WAIT="${UPDATE_HEALTH_WAIT:-2}" UPDATE_HEALTH_POLL="${UPDATE_HEALTH_POLL:-0.2}" \
    UPDATE_HEARTBEAT="${UPDATE_HEARTBEAT:-30}" "$@"
}

# Runs the helper with arguments. It must end within 60 seconds. Its output goes to $sandbox/helper.log.
run_helper() {
  helper_env timeout --kill-after=5 60 bash "$HELPER" "$@" >> "$sandbox/helper.log" 2>&1
}

# Writes a request into the inbox as Chatter does (no newline), and runs the helper as the systemd path unit does.
send_request() {
  printf '%s' "$1" > "$inbox/request.json"
  chown 1000:1000 "$inbox/request.json"
  run_helper request
}

# Starts the helper in the background, in its own process group (as systemd gives a service its own group),
# and waits until docker hangs on the text in $1. $sandbox/helper.pid holds the process ID, which is also the group ID.
# shellcheck disable=SC2016 # the script in single quotes runs in the new process
start_helper_in_own_group() {
  local hang_on="$1"
  shift
  FAKE_DOCKER_HANGS_ON="$hang_on" helper_env setsid bash -c 'echo "$$" > "$0"; exec bash "$1" "$2"' \
    "$sandbox/helper.pid" "$HELPER" "$@" >> "$sandbox/helper.log" 2>&1 &
  wait_until test -s "$fake/hung"
}

helper_has_ended() {
  ! kill -0 "$(cat "$sandbox/helper.pid")" 2> /dev/null
}

stop_hung_docker() {
  kill -KILL "$(cat "$fake/hung")" 2> /dev/null || true
}

# Waits up to 20 seconds until a command succeeds.
wait_until() {
  local tries=0
  until "$@"; do
    tries=$((tries + 1))
    [ "$tries" -lt 100 ] || return 1
    sleep 0.2
  done
}

# ---------- Reading the results ----------

status_file() { echo "$root/opt/chatter/update/status.json"; }

# Prints a text or number field of status.json
status_field() {
  sed -n -e "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" -e "s/.*\"$1\":\([0-9][0-9]*\).*/\1/p" "$(status_file)"
}

status_is() {
  [ "$(status_field state)" = "$1" ]
}

reason_has() {
  [[ "$(status_field reason)" == *"$1"* ]]
}

state_value() {
  sed -n "s/^$1=//p" "$state_dir/state" 2> /dev/null
}

has_image() {
  grep -q "^$1 " "$fake/images.txt"
}

data_file() {
  echo "$fake/volumes/chatter_chatterbox-data/$1"
}

docker_was_called_with() {
  grep -qF -- "$1" "$fake/calls.log"
}

# A status.json as Chatter parses it: one JSON object with the fields that the contract allows.
status_is_valid_json() {
  grep -qE '^\{"state":"[a-z-]+"(,"version":"[0-9]+\.[0-9]+\.[0-9]+")?(,"reason":"[^"]+")?,"heartbeat":"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z","freeBytes":[0-9]+(,"freedBytes":[0-9]+)?\}$' "$(status_file)"
}

work_files_are_gone() {
  [ ! -e "$state_dir/update.tar" ] && [ ! -e "$state_dir/files" ] && [ -z "$(ls -A "$state_dir/incoming" 2> /dev/null)" ]
}
