#!/usr/bin/env bash
# The update helper of the Chatter card. It runs on the Pi as root, outside Docker.
# Chatter (in its container, as the node user) can only write into /opt/chatter/update/inbox/:
# the update file (chatter-update.tar) and a request (request.json, the text "check" or "install").
# systemd starts this script when a request comes (chatter-update.path and chatter-update.service).
#
#   update-chatter.sh request   reads the request from the inbox, and does it
#   update-chatter.sh check     checks the update file in the inbox
#   update-chatter.sh install   installs the checked update file, or rolls back to the old version
#   update-chatter.sh recover   undoes an install that stopped, and writes helper.json. It never reads the inbox.
#                               systemd runs it at each start of the Pi (chatter.service, before Chatter starts)
#                               and after each run of the helper (ExecStopPost=, also after a hard kill).
#
# It writes the result to /opt/chatter/update/status.json, which Chatter reads.
# It trusts only its own root-only files and the public keys in /etc/chatter/update-keys/.
# It trusts nothing in the inbox, and a file of an update file only after its signature and checksum passed.
# The steps are in "Work item 8" of the plan. Each step writes a line to the log: journalctl -u chatter-update
set -euo pipefail
shopt -s extglob nullglob inherit_errexit
export LC_ALL=C
umask 077

# Only the tests set UPDATE_ROOT: a folder that stands for "/" of the Pi.
UPDATE_ROOT="${UPDATE_ROOT:-}"
CHATTER_DIR="$UPDATE_ROOT/opt/chatter"
UPDATE_DIR="$CHATTER_DIR/update"
INBOX="$UPDATE_DIR/inbox"
KEYS_DIR="$UPDATE_ROOT/etc/chatter/update-keys"
STATE_DIR="$UPDATE_ROOT/var/lib/chatter-update"
STATE_FILE="$STATE_DIR/state"
INSTALLED_VERSION_FILE="$STATE_DIR/installed-version"
LOCK_FILE="$STATE_DIR/lock"
# A heartbeat writes status.json only while it holds this lock. stop_heartbeat takes it too.
STATUS_LOCK_FILE="$STATE_DIR/status.lock"
INCOMING="$STATE_DIR/incoming"
COPY="$STATE_DIR/update.tar"
FILES="$STATE_DIR/files"
BOOT_ID_FILE="$UPDATE_ROOT/proc/sys/kernel/random/boot_id"
BACKUPS="$CHATTER_DIR/backups"
HEALTH_URL="http://127.0.0.1:3001/api/health"

# The same limit as in Chatter (UPDATE_FILE_LIMIT_BYTES in packages/shared/src/updates.ts): 600 MiB.
FILE_LIMIT_BYTES=629145600
MANIFEST_LIMIT_BYTES=4096
# The manifest, its signature, and the 5 files of PAYLOAD_MEMBERS
MEMBERS_LIMIT=7
# The tar listing of a correct update file is far smaller. A larger one is never stored.
LISTING_LIMIT_BYTES=8192
# Free space that must stay on the card after an update
RESERVE_BYTES=$((200 * 1024 * 1024))
# A loaded image takes about 3 times the space of its gzip file
LOADED_IMAGE_FACTOR=3
# An Admin installs a checked file within a day, or checks it again
READY_MAX_AGE_SECONDS=86400
BACKUPS_TO_KEEP=2

QUICK_TIMEOUT="1m"
DOCKER_TIMEOUT="${UPDATE_DOCKER_TIMEOUT:-5m}"
LOAD_TIMEOUT="${UPDATE_LOAD_TIMEOUT:-15m}"
HEALTH_WAIT_SECONDS="${UPDATE_HEALTH_WAIT:-300}"
HEALTH_POLL_SECONDS="${UPDATE_HEALTH_POLL:-5}"
HEARTBEAT_SECONDS="${UPDATE_HEARTBEAT:-30}"

CHATTER_REPOSITORY="ghcr.io/toolpath/chatter"
PAYLOAD_MEMBERS=(chatter.tar.gz victoria-metrics.tar.gz vmalert.tar.gz docker-compose.yml rules.yml)
declare -A IMAGE_REPOSITORY=(
  [chatter.tar.gz]="$CHATTER_REPOSITORY"
  [victoria-metrics.tar.gz]="victoriametrics/victoria-metrics"
  [vmalert.tar.gz]="victoriametrics/vmalert"
)

# The reasons in status.json. Fixed text only: never text from the update file.
R_NO_FILE="There is no update file. Upload or download it again."
R_NOT_PLAIN="The update file is not a normal file. Upload or download it again."
R_TOO_LARGE="The update file is larger than 600 MB."
R_NO_SPACE="There is not enough free space on the card for this update."
R_BAD_FILE="This is not a correct Chatter update file."
R_UNKNOWN_KEY="The update file is signed with a key that this Pi does not know."
R_BAD_SIGNATURE="The signature of the update file is not correct."
R_BAD_CHECKSUM="A file in the update file does not have its signed size and checksum."
R_WRONG_ARCH="The update file is for a different processor type."
R_NOT_NEWER="The update file is not newer than the installed version."
R_NOT_RELEASE="The installed version is not a release version, so it cannot update from here."
R_IMAGE_MISSING="An image that the update file needs is not on this Pi."
R_NO_SIZE="The helper could not measure the Chatter data. See the log: journalctl -u chatter-update"
R_NOT_READY="No checked update file is ready. Check the update file first."
R_TOO_OLD="The check is too old. Check the file again."
R_CHANGED="The checked update file changed. Check the file again."
R_STOP_FAILED="Chatter did not stop, so the update did not start."
R_BACKUP_FAILED="The backup of the Chatter data did not work, so the update did not start."
R_LOAD_FAILED="The new version did not load."
R_START_FAILED="The new version did not start."
R_NOT_HEALTHY="The new version did not start correctly in 5 minutes."
R_NO_BACKUP="The new version did not start, and there is no complete backup of the old version. See the log: journalctl -u chatter-update"
R_RESTORE_FAILED="The old data could not be put back. The data backup is kept, and the Pi tries again at its next start. See the log: journalctl -u chatter-update"
R_RESTORE_WAITS="The old data waits to be put back from its backup, so no update can start. Restart the Pi to try again. See the log: journalctl -u chatter-update"
R_RESTORED_LATER="The new version did not start. The old data was put back from its backup, and the old version runs again."
R_RESTARTED="The Pi restarted after the check. Upload or download the update file again."
R_STOPPED="The update helper stopped before it ended. See the log: journalctl -u chatter-update"

# What this run knows. The values from the manifest are set only after the signature check.
result_written="no"
heartbeat_pid=""
known_version=""
manifest_version=""
manifest_arch=""
declare -A signed_sha256=() signed_size=() unchanged_tag=() unchanged_id=()
old_version=""
old_container=""

main() {
  exec 3>&1
  trap 'exit 143' TERM
  trap 'exit 130' INT
  trap 'exit 129' HUP
  case "${1:-}" in
    request) prepare_folders; run_request ;;
    check) prepare_folders; run_when_free run_check ;;
    install) prepare_folders; run_when_free run_install ;;
    recover) run_recover ;;
    *) echo "Usage: update-chatter.sh request|check|install|recover" >&2; exit 2 ;;
  esac
}

# ---------- Small tools ----------

# systemd writes the output to the log: journalctl -u chatter-update
# It writes to file descriptor 3, a copy of the first output: a trap can run while a command sends
# its output to /dev/null, and the log lines of the trap must not go there too.
log() {
  echo "$*" >&3
}

utc_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

is_release_version() {
  [[ ${1:-} =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

free_bytes() {
  local bytes
  bytes="$(df --output=avail -B1 "$CHATTER_DIR" 2> /dev/null | tail -n 1 | tr -d ' ')" || bytes=0
  if [[ $bytes =~ ^[0-9]+$ ]]; then echo "$bytes"; else echo 0; fi
}

has_free_space() {
  [ "$(free_bytes)" -ge "$1" ]
}

file_size() {
  stat --format %s -- "$1"
}

file_sha256() {
  sha256sum -- "$1" | cut -d ' ' -f 1
}

boot_id() {
  cat "$BOOT_ID_FILE" 2> /dev/null || echo "unknown"
}

prepare_folders() {
  install -d -m 0755 "$UPDATE_DIR"
  install -d -m 0700 "$STATE_DIR" "$INCOMING"
}

# Takes the lock, then runs the function. If another run holds the lock, it does nothing.
run_when_free() {
  if ! take_lock_now; then
    log "Another run of the helper works now. Nothing to do."
    return 0
  fi
  "$1"
}

# flock: the lock is free again when the helper ends in any way, also after a power cut.
take_lock_now() {
  exec 9> "$LOCK_FILE"
  flock --nonblock 9
}

# ---------- Versions and the processor type ----------

# Prints "newer", "older", or "same": version $1 compared with version $2, number by number.
compare_versions() {
  local -a first second
  local i a b
  IFS=. read -r -a first <<< "$1"
  IFS=. read -r -a second <<< "$2"
  for i in 0 1 2; do
    a="${first[i]##+(0)}"
    b="${second[i]##+(0)}"
    if [ "${#a}" -ne "${#b}" ]; then
      if [ "${#a}" -gt "${#b}" ]; then echo newer; else echo older; fi
      return 0
    fi
    if [[ $a > $b ]]; then echo newer; return 0; fi
    if [[ $a < $b ]]; then echo older; return 0; fi
  done
  echo same
}

is_newer() {
  [ "$(compare_versions "$1" "$2")" = newer ]
}

# Prints the installed version. A missing file counts as 0.0.0 (the update file must still be signed).
# Fails if the file holds something that is not a release version.
installed_version() {
  local version
  if [ ! -e "$INSTALLED_VERSION_FILE" ]; then
    echo "0.0.0"
    return 0
  fi
  version="$(head --bytes 64 -- "$INSTALLED_VERSION_FILE" | head -n 1)"
  is_release_version "$version" || return 1
  echo "$version"
}

# The processor type as the update files name it. (uname -m is not used: a Pi Zero 2 W can say armv7l or armv8l.)
pi_arch() {
  case "$(dpkg --print-architecture 2> /dev/null)" in
    armhf) echo armv7 ;;
    arm64) echo arm64 ;;
    amd64) echo amd64 ;;
    *) return 1 ;;
  esac
}

# ---------- status.json and the state file ----------

# Writes status.json in the shape that Chatter reads (UpdateStatus in packages/shared/src/updates.ts).
write_status() {
  local state="$1" version="${2:-}" reason="${3:-}" freed="${4:-}" json
  json="{\"state\":\"$state\""
  if is_release_version "$version"; then json+=",\"version\":\"$version\""; fi
  if [ -n "$reason" ]; then json+=",\"reason\":\"$reason\""; fi
  json+=",\"heartbeat\":\"$(utc_now)\",\"freeBytes\":$(free_bytes)"
  if [[ $freed =~ ^[0-9]+$ ]]; then json+=",\"freedBytes\":$freed"; fi
  printf '%s\n' "$json}" | atomic_write "$UPDATE_DIR/status.json" 644
}

# Writes stdin to a file: atomic_write <path> <mode>
# A temporary name in the same folder first, then sync and a rename. So a reader (Chatter, vmalert,
# or recover after a power cut) sees the old file or the new one, never half a file.
# Only root can write in these folders, and a rename replaces a symlink, it does not follow it.
atomic_write() {
  local path="$1" mode="$2" folder temp
  folder="$(dirname "$path")"
  temp="$(mktemp "$folder/.temp.XXXXXX")" || return 1
  if cat > "$temp" && chmod "$mode" "$temp" && sync -- "$temp" \
    && mv --force --no-target-directory -- "$temp" "$path"; then
    sync -- "$folder"
    return 0
  fi
  rm -f -- "$temp"
  return 1
}

# A busy helper writes the status again each 30 seconds, so Chatter knows that it still works.
start_heartbeat() {
  local state="$1" version="${2:-}" helper_pid=$$
  stop_heartbeat
  (
    trap - EXIT TERM INT HUP
    # Not the lock: a heartbeat that ends late must not hold it.
    exec 9>&-
    while sleep "$HEARTBEAT_SECONDS"; do
      kill -0 "$helper_pid" 2> /dev/null || exit 0
      { flock 8; write_status "$state" "$version"; } 8> "$STATUS_LOCK_FILE"
    done
  ) &
  heartbeat_pid=$!
}

# Waits until a write of the heartbeat has ended, then stops the heartbeat.
# So a heartbeat can never write "checking" or "installing" over the status that comes next.
stop_heartbeat() {
  [ -n "$heartbeat_pid" ] || return 0
  {
    flock --wait 60 8 || log "A heartbeat write did not end in 60 seconds."
    kill "$heartbeat_pid" 2> /dev/null || true
    wait "$heartbeat_pid" 2> /dev/null || true
  } 8> "$STATUS_LOCK_FILE"
  heartbeat_pid=""
}

# Writes the final status of this run.
finish_with() {
  stop_heartbeat
  write_status "$@"
  result_written="yes"
}

# The temporary files of atomic_write that a power cut left
remove_temp_files() {
  rm -f -- "$UPDATE_DIR"/.temp.* "$STATE_DIR"/.temp.* "$CHATTER_DIR"/.temp.* "$CHATTER_DIR"/vmalert/.temp.*
}

# The state file (root only) holds lines "name=value".
write_state() {
  printf '%s\n' "$@" | atomic_write "$STATE_FILE" 600
}

state_value() {
  [ -f "$STATE_FILE" ] || return 0
  sed -n "s/^$1=//p" "$STATE_FILE" | head -n 1
}

clear_state() {
  rm -f -- "$STATE_FILE"
}

# The copy of the update file, the extracted files, and the entries moved out of the inbox
remove_work_files() {
  rm -rf -- "$COPY" "$FILES" "${INCOMING:?}"/*
}

# ---------- The inbox ----------

# Renames an inbox entry into the root-only folder. A rename does not open the entry, so a FIFO cannot make
# the helper wait. --no-copy: if a rename is not possible, fail, and never copy (a copy opens the entry).
take_from_inbox() {
  [ -e "$INBOX/$1" ] || [ -L "$INBOX/$1" ] || return 1
  mv --no-copy --no-target-directory -- "$INBOX/$1" "$2" 2> /dev/null
}

# A plain file: a regular file, not a symlink, with no second name (hard link).
is_plain_file() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat --format %h -- "$1")" = 1 ]
}

# ---------- The request ----------

# The first step moves request.json out of the inbox, before anything that can fail.
# So a failed run cannot make the path unit start the helper again and again.
run_request() {
  local moved="$INCOMING/request.$$" request
  if ! take_from_inbox request.json "$moved"; then
    log "There is no request in the inbox."
    return 0
  fi
  if ! take_lock_now; then
    rm -rf -- "$moved"
    log "Another run of the helper works now. The request is dropped."
    return 0
  fi
  request="$(read_request "$moved")" || request=""
  rm -rf -- "$moved"
  case "$request" in
    check) run_check ;;
    install) run_install ;;
    *) log "The request is not \"check\" or \"install\". Nothing to do." ;;
  esac
}

# Prints the request: "check" or "install". The moved entry must be a plain file of at most 64 bytes,
# and the whole text must match, so a newline or any other byte makes it unknown.
read_request() {
  local size text
  is_plain_file "$1" || return 1
  size="$(file_size "$1")" || return 1
  [ "$size" -le 64 ] || return 1
  # The "x" keeps a newline at the end, which $( ) would drop.
  text="$(timeout 5 head --bytes 64 -- "$1"; echo x)" || return 1
  text="${text%x}"
  # Bash drops a NUL byte, so the length shows it.
  [ "${#text}" -eq "$size" ] || return 1
  case "$text" in
    check | install) echo "$text" ;;
    *) return 1 ;;
  esac
}

# ---------- check ----------

run_check() {
  trap on_exit EXIT
  refuse_while_old_data_waits
  undo_unfinished_install
  remove_temp_files
  write_status checking
  start_heartbeat checking
  forget_ready_file
  take_update_file
  check_tar_entries
  check_signature
  read_signed_manifest
  check_manifest_fits_this_pi
  check_free_space_for_install
  extract_and_check_files
  check_unchanged_images
  mark_ready
}

# Ends a check or an install that cannot go on: refused, with a fixed reason. Deletes the work files.
# Refuses a check or an install while the old data waits to be put back. The state and the backup stay.
refuse_while_old_data_waits() {
  [ "$(state_value phase)" = restore-failed ] || return 0
  log "Refused: $R_RESTORE_WAITS"
  finish_with refused "" "$R_RESTORE_WAITS"
  exit 0
}

refuse() {
  log "Refused: $1"
  clear_state
  remove_work_files
  finish_with refused "$known_version" "$1"
  exit 0
}

# A new check deletes an old ready file.
forget_ready_file() {
  clear_state
  remove_work_files
  install -d -m 0700 "$INCOMING" "$FILES"
}

# Moves the update file out of the inbox, and copies it. Chatter may still hold the moved file open and change it,
# but only root has the copy. The helper checks and installs the copy only.
take_update_file() {
  local moved="$INCOMING/update.$$" size
  take_from_inbox chatter-update.tar "$moved" || refuse "$R_NO_FILE"
  is_plain_file "$moved" || refuse "$R_NOT_PLAIN"
  size="$(file_size "$moved")"
  [ "$size" -le "$FILE_LIMIT_BYTES" ] || refuse "$R_TOO_LARGE"
  has_free_space $((size + RESERVE_BYTES)) || refuse "$R_NO_SPACE"
  log "Copying the update file ($size bytes)."
  timeout 10m head --bytes $((FILE_LIMIT_BYTES + 1)) -- "$moved" > "$COPY" || refuse "$R_NOT_PLAIN"
  rm -f -- "$moved"
  [ "$(file_size "$COPY")" -le "$FILE_LIMIT_BYTES" ] || refuse "$R_TOO_LARGE"
}

check_tar_entries() {
  tar_entries_are_safe "$COPY" || refuse "$R_BAD_FILE"
}

# Each entry must be a regular file with an allowed name, and each name comes only once.
# At most 7 entries, and the manifest and its signature are small. All before anything is extracted.
tar_entries_are_safe() {
  local names listing name line
  names="$(limited_listing "$1")" || return 1
  listing="$(limited_listing "$1" --verbose --numeric-owner)" || return 1
  is_short_listing "$names" && is_short_listing "$listing" || return 1
  [ "$(wc -l <<< "$names")" -eq "$(wc -l <<< "$listing")" ] || return 1
  [ -z "$(sort <<< "$names" | uniq --repeated)" ] || return 1
  while IFS= read -r name; do
    is_allowed_member "$name" || return 1
  done <<< "$names"
  while IFS= read -r line; do
    is_safe_listing_line "$line" || return 1
  done <<< "$listing"
}

# Prints the tar listing, but never more than LISTING_LIMIT_BYTES + 1 bytes.
limited_listing() {
  local file="$1"
  shift
  read_tar "$file" 2m --list --quoting-style=escape "$@" 2> /dev/null | head --bytes $((LISTING_LIMIT_BYTES + 1))
}

is_short_listing() {
  [ -n "$1" ] && [ "${#1}" -le "$LISTING_LIMIT_BYTES" ] && [ "$(wc -l <<< "$1")" -le "$MEMBERS_LIMIT" ]
}

# A line of the long listing, for example "-rw-r--r-- 0/0 123 2026-11-10 10:00 manifest.txt".
# GNU tar starts it with "-" for a regular file. The third field is the size.
is_safe_listing_line() {
  local mode size name
  read -r mode _ size _ _ name <<< "$1"
  [ "${mode:0:1}" = "-" ] && [[ $size =~ ^[0-9]+$ ]] || return 1
  case "$name" in
    manifest.txt | manifest.txt.sig) [ "$size" -le "$MANIFEST_LIMIT_BYTES" ] ;;
  esac
}

# Runs tar on a file, with a time limit: read_tar <file> <time limit> <tar options...>
# tar reads the file from stdin, because then GNU tar refuses a compressed file. With --file <name>,
# it unpacks gzip, xz, or zstd by itself, and a small file could fill the card past the size limit.
read_tar() {
  local file="$1" time_limit="$2"
  shift 2
  timeout "$time_limit" tar --file - "$@" < "$file"
}

is_allowed_member() {
  [ "$1" = manifest.txt ] || [ "$1" = manifest.txt.sig ] || is_payload_member "$1"
}

is_payload_member() {
  local member
  for member in "${PAYLOAD_MEMBERS[@]}"; do
    [ "$1" != "$member" ] || return 0
  done
  return 1
}

is_image_member() {
  [ -n "${IMAGE_REPOSITORY[$1]:-}" ]
}

# Extracts the named entries of the copy, one by one, into the new root-only folder. Then checks each again.
extract_members() {
  local name
  read_tar "$COPY" 10m --extract --no-wildcards --no-same-owner --no-same-permissions \
    --directory "$FILES" -- "$@" 2> /dev/null || return 1
  for name in "$@"; do
    is_plain_file "$FILES/$name" || return 1
  done
  [ -z "$(find "$FILES" -mindepth 1 ! -type f -print -quit)" ]
}

check_signature() {
  local key_id key
  extract_members manifest.txt manifest.txt.sig || refuse "$R_BAD_FILE"
  [ "$(file_size "$FILES/manifest.txt")" -le "$MANIFEST_LIMIT_BYTES" ] || refuse "$R_BAD_FILE"
  key_id="$(unsigned_key_id "$FILES/manifest.txt")" || refuse "$R_BAD_FILE"
  key="$KEYS_DIR/$key_id.pub"
  [ -f "$key" ] || refuse "$R_UNKNOWN_KEY"
  timeout 1m openssl pkeyutl -verify -pubin -inkey "$key" -rawin \
    -in "$FILES/manifest.txt" -sigfile "$FILES/manifest.txt.sig" > /dev/null 2>&1 || refuse "$R_BAD_SIGNATURE"
  log "The signature is correct (key $key_id)."
}

# Prints the keyId of the manifest. It is read before the signature check, so it may only pick a key file name.
unsigned_key_id() {
  [ "$(grep --count '^keyId ' "$1")" = 1 ] || return 1
  sed -n 's/^keyId \([a-z0-9-]\{1,64\}\)$/\1/p' "$1" | grep .
}

read_signed_manifest() {
  read_manifest "$FILES/manifest.txt" || refuse "$R_BAD_FILE"
  tar_matches_manifest || refuse "$R_BAD_FILE"
}

# Reads manifest.txt (after the signature check), strictly: each line has one shape, and each value one pattern.
#   format 1 / version <x.y.z> / arch <type> / keyId <id>, then for each other file one of:
#   file <name> <sha256> <size>
#   unchanged <image file name> <image tag> <image id>   (the image is already on the Pi)
read_manifest() {
  local line number=0 member
  manifest_version=""
  manifest_arch=""
  signed_sha256=()
  signed_size=()
  unchanged_tag=()
  unchanged_id=()
  while IFS= read -r line || [ -n "$line" ]; do
    number=$((number + 1))
    read_manifest_line "$number" "$line" || return 1
  done < "$1"
  for member in "${PAYLOAD_MEMBERS[@]}"; do
    [ -n "${signed_sha256[$member]:-}${unchanged_tag[$member]:-}" ] || return 1
  done
  [ -n "${signed_sha256[docker-compose.yml]:-}" ] && [ -n "${signed_sha256[rules.yml]:-}" ]
}

read_manifest_line() {
  local version_line='^version ([0-9]+\.[0-9]+\.[0-9]+)$' arch_line='^arch (amd64|arm64|armv7)$'
  case "$1" in
    1) [ "$2" = "format 1" ] ;;
    2) [[ $2 =~ $version_line ]] && manifest_version="${BASH_REMATCH[1]}" ;;
    3) [[ $2 =~ $arch_line ]] && manifest_arch="${BASH_REMATCH[1]}" ;;
    4) [[ $2 =~ ^keyId\ [a-z0-9-]{1,64}$ ]] ;;
    *) read_file_line "$2" ;;
  esac
}

read_file_line() {
  local file_line='^file ([a-z.-]+) ([0-9a-f]{64}) ([0-9]{1,10})$'
  local unchanged_line='^unchanged ([a-z.-]+) ([a-z0-9./-]+):([A-Za-z0-9._-]{1,128}) (sha256:[0-9a-f]{64})$'
  local member
  if [[ $1 =~ $file_line ]]; then
    member="${BASH_REMATCH[1]}"
    is_new_payload_member "$member" || return 1
    signed_sha256[$member]="${BASH_REMATCH[2]}"
    signed_size[$member]=$((10#${BASH_REMATCH[3]}))
  elif [[ $1 =~ $unchanged_line ]]; then
    member="${BASH_REMATCH[1]}"
    is_new_payload_member "$member" && is_image_member "$member" || return 1
    [ "${BASH_REMATCH[2]}" = "${IMAGE_REPOSITORY[$member]}" ] || return 1
    unchanged_tag[$member]="${BASH_REMATCH[2]}:${BASH_REMATCH[3]}"
    unchanged_id[$member]="${BASH_REMATCH[4]}"
  else
    return 1
  fi
}

is_new_payload_member() {
  is_payload_member "$1" && [ -z "${signed_sha256[$1]:-}${unchanged_tag[$1]:-}" ]
}

# The tar holds the manifest, its signature, and each "file" of the manifest. Nothing else.
tar_matches_manifest() {
  local expected actual
  expected="$(printf '%s\n' manifest.txt manifest.txt.sig "${!signed_sha256[@]}" | sort)"
  actual="$(read_tar "$COPY" 2m --list | sort)" || return 1
  [ "$expected" = "$actual" ]
}

check_manifest_fits_this_pi() {
  local installed
  known_version="$manifest_version"
  [ "$manifest_arch" = "$(pi_arch)" ] || refuse "$R_WRONG_ARCH"
  installed="$(installed_version)" || refuse "$R_NOT_RELEASE"
  is_newer "$manifest_version" "$installed" || refuse "$R_NOT_NEWER"
  log "The update file has version $manifest_version for $manifest_arch. The installed version is $installed."
}

# Space for the extracted files, the loaded images, a backup of the data, and the reserve.
check_free_space_for_install() {
  local needed
  needed="$(space_for_install)" || refuse "$R_NO_SIZE"
  has_free_space $((needed + $(extracted_bytes))) || refuse "$R_NO_SPACE"
}

extracted_bytes() {
  local member total=0
  for member in "${!signed_size[@]}"; do
    total=$((total + signed_size[$member]))
  done
  echo "$total"
}

# The space that the install needs after the check: the loaded images, a backup of the data, and the reserve.
space_for_install() {
  local member total=0 data
  for member in "${!signed_size[@]}"; do
    if is_image_member "$member"; then
      total=$((total + LOADED_IMAGE_FACTOR * signed_size[$member]))
    fi
  done
  data="$(data_bytes)" || return 1
  echo $((total + data + RESERVE_BYTES))
}

extract_and_check_files() {
  local member
  extract_members "${!signed_sha256[@]}" || refuse "$R_BAD_FILE"
  for member in "${!signed_sha256[@]}"; do
    [ "$(file_size "$FILES/$member")" = "${signed_size[$member]}" ] || refuse "$R_BAD_CHECKSUM"
    [ "$(file_sha256 "$FILES/$member")" = "${signed_sha256[$member]}" ] || refuse "$R_BAD_CHECKSUM"
  done
  log "Each file has its signed size and checksum."
  new_compose_names_the_version || refuse "$R_BAD_FILE"
}

# A roll back finds the old Chatter image by its tag. If the new compose file used "latest" (or another version),
# loading the new image would move that tag, and the roll back would start the new version again.
new_compose_names_the_version() {
  [ "$(chatter_image_in "$FILES/docker-compose.yml")" = "$CHATTER_REPOSITORY:$manifest_version" ]
}

check_unchanged_images() {
  local member
  for member in "${!unchanged_tag[@]}"; do
    [ "$(image_id "${unchanged_tag[$member]}")" = "${unchanged_id[$member]}" ] || refuse "$R_IMAGE_MISSING"
  done
}

mark_ready() {
  write_state "phase=ready" "version=$manifest_version" "sha256=$(file_sha256 "$COPY")" \
    "checked_at=$(date +%s)" "boot_id=$(boot_id)"
  log "Ready to install version $manifest_version."
  finish_with ready "$manifest_version"
}

# ---------- install ----------

# The phases in the state file tell "recover" what to undo after a power cut or a hard kill:
#   backing-up, loading: the old files are still in place, so start the old version again
#   swapped: the new compose file is in place, so roll back (with the old data)
#   restore-failed: the roll back could not put the old data back. "recover" tries again at each start of the Pi,
#                   and until then no check or install starts, so nothing can delete the backup.
run_install() {
  trap on_exit EXIT
  refuse_while_old_data_waits
  undo_unfinished_install
  remove_temp_files
  known_version="$(state_value version)"
  is_release_version "$known_version" || known_version=""
  write_status installing "$known_version"
  start_heartbeat installing "$known_version"
  check_ready_file
  back_up_old_version
  load_new_images
  start_new_version
  finish_install
}

# Goes on only with a fresh, unchanged ready file of a version that is still newer.
check_ready_file() {
  is_ready || refuse "$R_NOT_READY"
  is_fresh_check || refuse "$R_TOO_OLD"
  is_unchanged_copy || refuse "$R_CHANGED"
  old_version="$(installed_version)" || refuse "$R_NOT_RELEASE"
  is_newer "$known_version" "$old_version" || refuse "$R_NOT_NEWER"
  log "Installing version $known_version over version $old_version."
}

is_ready() {
  [ "$(state_value phase)" = ready ] && [ -n "$known_version" ]
}

# A Pi that stays on never runs "recover", so the age of the check is checked here.
is_fresh_check() {
  local checked_at age
  checked_at="$(state_value checked_at)"
  [[ $checked_at =~ ^[0-9]+$ ]] || return 1
  age=$(($(date +%s) - checked_at))
  [ "$age" -ge 0 ] && [ "$age" -le "$READY_MAX_AGE_SECONDS" ]
}

is_unchanged_copy() {
  [ -f "$COPY" ] || return 1
  [ "$(file_sha256 "$COPY")" = "$(state_value sha256)" ] || return 1
  read_manifest "$FILES/manifest.txt" || return 1
  [ "$manifest_version" = "$known_version" ]
}

# Clears "ready" at once (so a second install request does nothing), stops Chatter, and backs up the old version.
back_up_old_version() {
  local needed
  set_phase backing-up
  old_container="$(compose ps --all --quiet chatterbox)" || old_container=""
  compose stop chatterbox > /dev/null || fail_install "$R_STOP_FAILED"
  needed="$(space_for_install)" || fail_install "$R_NO_SIZE"
  has_free_space "$needed" || fail_install "$R_NO_SPACE"
  make_backup "$BACKUPS/$old_version" || fail_install "$R_BACKUP_FAILED"
  log "The old version is backed up in $BACKUPS/$old_version."
}

set_phase() {
  write_state "phase=$1" "version=$known_version" "old_version=$old_version"
}

# Writes the backup in a .tmp folder first. Only a backup with a "complete" mark is ever put back.
make_backup() {
  local backup="$1"
  install -d -m 0700 "$BACKUPS" || return 1
  rm -rf -- "$backup.tmp" || return 1
  install -d -m 0700 "$backup.tmp" "$backup.tmp/data" || return 1
  cp -- "$CHATTER_DIR/docker-compose.yml" "$backup.tmp/docker-compose.yml" || return 1
  cp -- "$CHATTER_DIR/vmalert/rules.yml" "$backup.tmp/rules.yml" || return 1
  copy_data_out "$backup.tmp/data" || return 1
  sync || return 1
  # A .old folder is left from a power cut in an earlier try. A backup of this version is from an earlier try.
  rm -rf -- "$backup.old" || return 1
  if [ -e "$backup" ]; then
    mv --no-target-directory -- "$backup" "$backup.old" || return 1
  fi
  echo "$old_version" > "$backup.tmp/version" || return 1
  mv --no-target-directory -- "$backup.tmp" "$backup" || return 1
  touch "$backup/complete" || return 1
  sync || return 1
  rm -rf -- "$backup.old"
  remove_old_backups
}

# Keeps the last 2 complete backups. Deletes the others, and each backup with no "complete" mark.
remove_old_backups() {
  local entry name kept=0
  for entry in "$BACKUPS"/*; do
    name="${entry##*/}"
    if ! is_release_version "$name" || [ ! -f "$entry/complete" ]; then
      rm -rf -- "$entry"
    fi
  done
  for name in $(complete_backups_newest_first); do
    kept=$((kept + 1))
    [ "$kept" -le "$BACKUPS_TO_KEEP" ] || rm -rf -- "${BACKUPS:?}/$name"
  done
}

complete_backups_newest_first() {
  local entry
  for entry in "$BACKUPS"/*/complete; do
    entry="${entry%/complete}"
    echo "${entry##*/}"
  done | sort -t . -k 1,1nr -k 2,2nr -k 3,3nr
}

# Copies chatter.db, focas/, and (if they are there) chatter.db-wal and chatter.db-shm out of the data volume.
# It runs in a container of the old Chatter image, so a symlink in the volume cannot point at a file of the Pi.
# cp -a keeps the owner (uid 1000).
# shellcheck disable=SC2016 # the script in single quotes runs in the container
copy_data_out() {
  run_in_old_image ro sh --volume "$1:/backup" -- -c '
      set -e
      cd /app/data
      for name in chatter.db chatter.db-wal chatter.db-shm focas; do
        if [ -e "$name" ] || [ -L "$name" ]; then cp -a "$name" /backup/; fi
      done'
}

# Puts the backed-up data back. First it copies the backup next to the data, with ".restore" names.
# If that fails, the data is not touched. Then it replaces the files of the new version (also its -wal and -shm).
# A power cut in the middle is safe: the phase stays "swapped", so "recover" restores again from the backup.
# shellcheck disable=SC2016 # the script in single quotes runs in the container
restore_data() {
  run_in_old_image rw sh --volume "$1:/backup:ro" -- -c '
      set -e
      cd /app/data
      names="chatter.db chatter.db-wal chatter.db-shm focas"
      remove_restore_copies() {
        for name in $names; do rm -rf "$name.restore"; done
      }
      remove_restore_copies
      trap remove_restore_copies EXIT
      for name in $names; do
        if [ -e "/backup/$name" ] || [ -L "/backup/$name" ]; then cp -a "/backup/$name" "$name.restore"; fi
      done
      for name in $names; do
        rm -rf "$name"
        if [ -e "$name.restore" ] || [ -L "$name.restore" ]; then mv "$name.restore" "$name"; fi
      done'
}

# Deletes the images of the version before the old one first, so the card never holds 3 sets of images.
# Then loads the new images. Each image file is deleted after it loads, to give the card the space back.
load_new_images() {
  local member
  set_phase loading
  remove_images_except "$(images_in "$CHATTER_DIR/docker-compose.yml"; unchanged_images)"
  for member in "${!signed_size[@]}"; do
    is_image_member "$member" || continue
    log "Loading $member. On a Pi, this takes some minutes."
    docker_within "$LOAD_TIMEOUT" load --input "$FILES/$member" > /dev/null || fail_install "$R_LOAD_FAILED"
    rm -f -- "$FILES/$member"
  done
  new_images_are_here || fail_install "$R_LOAD_FAILED"
}

unchanged_images() {
  local member
  for member in "${!unchanged_tag[@]}"; do
    echo "${unchanged_tag[$member]}"
  done
}

new_images_are_here() {
  local image
  chatter_image_in "$FILES/docker-compose.yml" > /dev/null || return 1
  for image in $(images_in "$FILES/docker-compose.yml"); do
    image_id "$image" > /dev/null || return 1
  done
}

# Puts the new compose file and rules in place, and starts the new version. The force is needed:
# vmalert must read the new rules, also when its own settings did not change.
start_new_version() {
  set_phase swapped
  put_file_in_place "$FILES/docker-compose.yml" "$CHATTER_DIR/docker-compose.yml" || fail_install "$R_START_FAILED"
  put_file_in_place "$FILES/rules.yml" "$CHATTER_DIR/vmalert/rules.yml" || fail_install "$R_START_FAILED"
  log "Starting version $known_version."
  compose up --detach --force-recreate > /dev/null || fail_install "$R_START_FAILED"
  wait_for_new_version || fail_install "$R_NOT_HEALTHY"
}

# Copies a file into place: put_file_in_place <source> <path>. vmalert never reads half a file.
put_file_in_place() {
  atomic_write "$2" 644 < "$1"
}

# Waits up to 5 minutes until the new version runs.
wait_for_new_version() {
  local new_image deadline=$((SECONDS + HEALTH_WAIT_SECONDS))
  new_image="$(image_id "$(chatter_image_in "$CHATTER_DIR/docker-compose.yml")")" || return 1
  until new_version_runs "$new_image"; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep "$HEALTH_POLL_SECONDS"
  done
  log "Version $known_version runs."
}

# The 3 containers run, the Chatter container is a new one from the new image, it is healthy,
# and /api/health gives the new version.
new_version_runs() {
  local container
  container="$(compose ps --all --quiet chatterbox)" || return 1
  [ -n "$container" ] && [ "$container" != "$old_container" ] || return 1
  [ "$(docker_within "$QUICK_TIMEOUT" inspect --format '{{.Image}}' "$container")" = "$1" ] || return 1
  all_services_run || return 1
  [ "$(docker_within "$QUICK_TIMEOUT" inspect --format '{{.State.Health.Status}}' "$container")" = healthy ] || return 1
  [ "$(running_version)" = "$known_version" ]
}

all_services_run() {
  local wanted running
  wanted="$(compose config --services | sort)" || return 1
  running="$(compose ps --status running --services | sort)" || return 1
  [ -n "$wanted" ] && [ "$wanted" = "$running" ]
}

# The version that /api/health gives. Only compared with the expected version, never written anywhere.
running_version() {
  curl --silent --max-time 5 --max-filesize 65536 "$HEALTH_URL" \
    | sed -n 's/.*"version" *: *"\([0-9.]*\)".*/\1/p'
}

finish_install() {
  write_installed_version "$known_version"
  clear_state
  finish_with "done" "$known_version"
  log "Version $known_version is installed."
  clean_up_after_done
}

write_installed_version() {
  is_release_version "$1" || return 1
  echo "$1" | atomic_write "$INSTALLED_VERSION_FILE" 600
}

# Deletes the images that neither the new nor the old version names (the old ones stay for a roll back),
# the work files, and old backups. A failure here never changes the result: it only goes to the log.
clean_up_after_done() {
  local free_before freed
  set +e
  free_before="$(free_bytes)"
  remove_images_except "$(images_in "$CHATTER_DIR/docker-compose.yml" "$BACKUPS/$old_version/docker-compose.yml")"
  remove_work_files
  remove_old_backups
  freed=$(($(free_bytes) - free_before))
  [ "$freed" -ge 0 ] || freed=0
  write_status "done" "$known_version" "" "$freed"
  set -e
}

# Deletes the Chatter, VictoriaMetrics, and vmalert images that are not in the list (one on each line).
# Other images stay. No "docker image prune": it could delete images that are not Chatter's.
remove_images_except() {
  local keep="$1" listing reference id
  if [ -z "$keep" ]; then
    log "No images to keep were found, so no image is deleted."
    return 0
  fi
  listing="$(docker_within "$QUICK_TIMEOUT" image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}')" || {
    log "Could not list the images."
    return 0
  }
  while read -r reference id; do
    is_chatter_image "$reference" || continue
    grep --quiet --line-regexp --fixed-strings -- "$reference" <<< "$keep" && continue
    [[ $reference != *:"<none>" ]] || reference="$id"
    if docker_within "$QUICK_TIMEOUT" rmi "$reference" > /dev/null 2>&1; then
      log "Deleted the image $reference."
    else
      log "Could not delete the image $reference."
    fi
  done <<< "$listing"
}

is_chatter_image() {
  case "${1%:*}" in
    "$CHATTER_REPOSITORY" | victoriametrics/victoria-metrics | victoriametrics/vmalert) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------- Undo an install ----------

# Ends an install that cannot go on. What it undoes depends on the phase.
fail_install() {
  log "The install failed: $1"
  undo_install "$1"
  exit 0
}

undo_install() {
  local phase
  phase="$(state_value phase)"
  set +e
  stop_heartbeat
  case "$phase" in
    backing-up | loading) start_old_version_again "$1" ;;
    swapped | restore-failed) roll_back "$1" ;;
  esac
  set -e
}

# The old compose file is still in place, and the data did not change: start the old version again.
start_old_version_again() {
  log "Starting the old version again."
  remove_images_except "$(images_in "$CHATTER_DIR/docker-compose.yml")"
  compose up --detach > /dev/null || log "The old version did not start."
  remove_old_backups
  end_undo failed "$1"
}

# The new version may have changed the data. Put back the old compose files and the old data, then start them.
roll_back() {
  local backup
  old_version="$(state_value old_version)"
  backup="$BACKUPS/$old_version"
  if ! is_release_version "$old_version" || [ ! -f "$backup/complete" ]; then
    start_with_no_backup
    return
  fi
  log "Rolling back to version $old_version."
  put_file_in_place "$backup/docker-compose.yml" "$CHATTER_DIR/docker-compose.yml"
  put_file_in_place "$backup/rules.yml" "$CHATTER_DIR/vmalert/rules.yml"
  # Again from the backup, so a power cut in finish_install cannot leave the wrong version.
  write_installed_version "$(head -n 1 "$backup/version")"
  if put_back_old_data "$backup"; then
    start_old_version "$1"
  else
    keep_chatter_stopped "$backup"
  fi
}

start_with_no_backup() {
  log "There is no complete backup of the old version, so nothing is put back."
  compose up --detach > /dev/null
  remove_old_backups
  end_undo failed "$R_NO_BACKUP"
}

# Restores only when Chatter is stopped, so the new version cannot write into the data while it changes.
put_back_old_data() {
  compose stop chatterbox > /dev/null || return 1
  restore_data "$1/data"
}

start_old_version() {
  compose up --detach --force-recreate > /dev/null || log "The old version did not start."
  remove_images_except "$(images_in "$CHATTER_DIR/docker-compose.yml")"
  remove_old_backups
  end_undo rolled-back "$1"
}

# The data may not match the old version, so Chatter must not start on it. The backup is never deleted here.
# The phase stays, with the start of the Pi: "recover" tries the restore again at the next start.
keep_chatter_stopped() {
  log "The old data was not put back, so Chatter is not started. The data backup is kept in $1."
  write_state "phase=restore-failed" "version=$known_version" "old_version=$old_version" "boot_id=$(boot_id)"
  remove_work_files
  finish_with failed "$known_version" "$R_RESTORE_FAILED"
}

end_undo() {
  clear_state
  remove_work_files
  finish_with "$1" "$known_version" "$2"
}

# ---------- recover ----------

# Always ends with success, so Chatter still starts (chatter.service also has "-" before it).
run_recover() {
  trap 'exit 0' EXIT
  prepare_folders
  write_helper_info
  if ! wait_for_lock; then
    log "Another run of the helper holds the lock for too long. Nothing to recover."
    return 0
  fi
  remove_temp_files
  rm -rf -- "${INCOMING:?}"/*
  known_version="$(state_value version)"
  is_release_version "$known_version" || known_version=""
  case "$(state_value phase)" in
    backing-up | loading | swapped) undo_install "$R_STOPPED" ;;
    restore-failed) retry_restore_after_a_restart ;;
    ready) recover_ready_file ;;
    *) remove_work_files; settle_busy_status ;;
  esac
}

# Tries the restore again once at each start of the Pi (chatter.service runs recover before Chatter starts).
# Not after each run of the helper: in the same start of the Pi, nothing changed since the last try.
retry_restore_after_a_restart() {
  if [ "$(state_value boot_id)" = "$(boot_id)" ]; then
    log "The old data waits to be put back. The helper tries again at the next start of the Pi."
    return 0
  fi
  log "Trying again to put back the old data."
  undo_install "$R_RESTORED_LATER"
}

# helper.json tells Chatter that it runs on a card with the helper, and which update file it needs.
write_helper_info() {
  local arch
  if ! arch="$(pi_arch)"; then
    log "Unknown processor type, so there is no helper.json."
    return 0
  fi
  echo "{\"arch\":\"$arch\"}" | atomic_write "$UPDATE_DIR/helper.json" 644
}

# Waits for a run that holds the lock. Each step of a run has a time limit, so 30 minutes is enough.
wait_for_lock() {
  exec 9> "$LOCK_FILE"
  flock --wait 1800 9
}

# A request run (check or install) first undoes an install that a hard kill or a power cut stopped.
undo_unfinished_install() {
  case "$(state_value phase)" in
    backing-up | loading | swapped)
      known_version="$(state_value version)"
      undo_install "$R_STOPPED"
      result_written="no"
      known_version=""
      ;;
  esac
}

# A ready file stays only in the same start of the Pi. After a restart, the Admin checks the file again.
recover_ready_file() {
  if [ "$(state_value boot_id)" != "$(boot_id)" ]; then
    log "The ready file is from an earlier start of the Pi, so it is deleted."
    clear_state
    remove_work_files
    write_status failed "$known_version" "$R_RESTARTED"
  elif status_is_busy; then
    # An install that stopped before it changed anything: the checked file is still ready.
    write_status ready "$known_version"
  fi
}

# A status that says "checking" or "installing" with no phase: the helper stopped before its result.
settle_busy_status() {
  local version
  status_is_busy || return 0
  version="$(status_value version)"
  # The phase is cleared just after installed-version is written, so the new version runs.
  if [ "$(status_value state)" = installing ] && is_release_version "$version" \
    && [ "$(installed_version 2> /dev/null)" = "$version" ]; then
    write_status "done" "$version"
  else
    write_status failed "$version" "$R_STOPPED"
  fi
}

status_is_busy() {
  local state
  state="$(status_value state)"
  [ "$state" = checking ] || [ "$state" = installing ]
}

# A value from status.json, which only the helper writes
status_value() {
  [ -f "$UPDATE_DIR/status.json" ] || return 0
  sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$UPDATE_DIR/status.json"
}

# ---------- Docker ----------

# Runs a docker command with a time limit: docker_within <time limit> <docker arguments...>
# At the limit, timeout sends SIGTERM. If docker does not end in 10 seconds more, it sends SIGKILL.
docker_within() {
  local time_limit="$1"
  shift
  timeout --kill-after=10s "$time_limit" docker "$@"
}

# Runs docker compose in /opt/chatter, as chatter.service does (so the project name is "chatter").
compose() {
  (cd "$CHATTER_DIR" && docker_within "$DOCKER_TIMEOUT" compose "$@")
}

# Runs a command in a container of the old Chatter image, with the Chatter data volume at /app/data, as root.
#   run_in_old_image <ro or rw: the data volume> <entrypoint> [more docker run options...] -- [arguments...]
# --pull=never: the image is on the Pi already, so a missing image fails at once and never downloads.
# --init: a small first process passes SIGTERM on to the command. (A shell as the first process ignores it.)
# --network none: the command cannot reach anything.
run_in_old_image() {
  local data_mode="$1" entrypoint="$2" volume image options=()
  shift 2
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    options+=("$1")
    shift
  done
  shift
  volume="$(data_volume)" || return 1
  image="$(chatter_image_in "$CHATTER_DIR/docker-compose.yml")" || return 1
  docker_within "$DOCKER_TIMEOUT" run --rm --init --pull=never --network none --user 0:0 \
    --entrypoint "$entrypoint" --volume "$volume:/app/data:$data_mode" "${options[@]}" "$image" "$@"
}

image_id() {
  docker_within "$QUICK_TIMEOUT" image inspect --format '{{.Id}}' "$1" 2> /dev/null
}

# Prints each image that the compose files name, one on each line.
images_in() {
  sed -n 's/^[[:space:]]*image:[[:space:]]*"\{0,1\}\([^"[:space:]#]*\)"\{0,1\}.*$/\1/p' "$@" | sort -u
}

chatter_image_in() {
  images_in "$1" | awk -v prefix="$CHATTER_REPOSITORY:" 'index($0, prefix) == 1 { print; exit }' | grep .
}

# The Chatter data volume, found by its Compose labels
data_volume() {
  local volumes
  volumes="$(docker_within "$QUICK_TIMEOUT" volume ls --quiet \
    --filter label=com.docker.compose.project=chatter \
    --filter label=com.docker.compose.volume=chatterbox-data)" || return 1
  [ -n "$volumes" ] && [ "$(wc -l <<< "$volumes")" -eq 1 ] || return 1
  echo "$volumes"
}

# The size of the Chatter data. The volume belongs to the node user, so the helper reads it only in a container,
# where a symlink in the volume cannot point at a file of the Pi.
data_bytes() {
  local bytes
  bytes="$(run_in_old_image ro du -- --summarize --bytes /app/data | cut -f 1)" || return 1
  [[ $bytes =~ ^[0-9]+$ ]] || return 1
  echo "$bytes"
}

# ---------- The end of a run ----------

# Runs when the helper ends in any way that a trap can catch. A hard kill (SIGKILL) is not caught:
# then "recover" (ExecStopPost= of chatter-update.service) does this work.
on_exit() {
  local code=$?
  stop_heartbeat
  [ "$result_written" = "no" ] || return 0
  set +e
  log "The helper stopped before it ended (exit code $code)."
  case "$(state_value phase)" in
    backing-up | loading | swapped) undo_install "$R_STOPPED" ;;
    # An install stopped before it changed anything: the checked file is still ready.
    ready) write_status ready "$(state_value version)" ;;
    # A check that stopped, or an install that stopped after the state was cleared (then it is done)
    *) remove_work_files; settle_busy_status ;;
  esac
}

main "$@"
