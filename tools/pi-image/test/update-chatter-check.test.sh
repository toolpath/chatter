#!/usr/bin/env bash
# Tests for "update-chatter.sh check" (in-pi/update-chatter.sh), and for how it reads the request.
# It runs in a Debian 13 container (see in-linux.sh), with fake docker, curl, dpkg, and df.
# Run:  tools/pi-image/test/update-chatter-check.test.sh
set -uo pipefail
if [ "${IN_TEST_CONTAINER:-}" != 1 ]; then exec "$(dirname "$0")/in-linux.sh" "$0"; fi
# shellcheck source-path=SCRIPTDIR source=update-chatter.lib.sh
source "$(dirname "$0")/update-chatter.lib.sh"

test_a_correct_update_file_is_ready() {
  set_up
  put_update_file > /dev/null
  touch "$inbox/.partial-abc"

  send_request check

  check "a correct update file is ready" status_is ready
  check "the status has the version of the update file" test "$(status_field version)" = "$NEW_VERSION"
  check "the status is the JSON that Chatter reads" status_is_valid_json
  check "the status has the free space" test "$(status_field freeBytes)" = 10000000000
  check "Chatter can read status.json" test "$(stat --format %a "$(status_file)")" = 644
  check "the update file is moved out of the inbox" test ! -e "$inbox/chatter-update.tar"
  check "the request is moved out of the inbox" test ! -e "$inbox/request.json"
  check "the helper does not delete other inbox entries" test -e "$inbox/.partial-abc"
  check "the state file says ready" test "$(state_value phase)" = ready
  check "the helper keeps its own copy of the update file" test -f "$state_dir/update.tar"
  check "the moved file is deleted after the copy" test -z "$(ls -A "$state_dir/incoming")"
  check "the check does not change the installed version" test "$(cat "$state_dir/installed-version")" = "$OLD_VERSION"
}

test_a_check_with_no_update_file_is_refused() {
  set_up
  send_request check
  check "no update file: refused" status_is refused
  check "no update file: the reason says so" reason_has "no update file"
}

test_a_bad_signature_is_refused() {
  set_up
  local dir
  dir="$(make_payload "$NEW_VERSION")"
  write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  sed -i 's/^version .*/version 9.9.9/' "$dir/manifest.txt"
  pack_into_inbox "$dir"

  send_request check

  check "a changed manifest: refused" status_is refused
  check "a changed manifest: the reason is the signature" reason_has "signature"
  check "a changed manifest: the status has no version from the unchecked file" test -z "$(status_field version)"
  check "a refused file leaves no work files" work_files_are_gone
  check "a refused file leaves no state" test ! -e "$state_dir/state"
}

test_a_signature_from_another_key_is_refused() {
  set_up
  local dir
  dir="$(make_payload "$NEW_VERSION")"
  write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir" "$keys_dir/other.pem"
  pack_into_inbox "$dir"

  send_request check

  check "signed with a key that does not match the keyId: refused" reason_has "signature"
}

test_an_unknown_key_is_refused() {
  set_up
  local dir
  dir="$(make_payload "$NEW_VERSION")"
  MANIFEST_KEY_ID="other" write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir" "$keys_dir/other.pem"
  pack_into_inbox "$dir"

  send_request check

  check "an unknown key: refused" status_is refused
  check "an unknown key: the reason says the Pi does not know the key" reason_has "key"
}

test_a_key_id_that_is_a_path_is_refused() {
  set_up
  local dir
  dir="$(make_payload "$NEW_VERSION")"
  cp "$keys_dir/$KEY_ID.pub" "$sandbox/outside.pub"
  MANIFEST_KEY_ID="../../../../outside" write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  pack_into_inbox "$dir"

  send_request check

  check "a keyId with a path: refused" status_is refused
  check "a keyId with a path: the reason is a bad file, not the key file" reason_has "not a correct"
}

test_a_changed_file_is_refused() {
  set_up
  local dir
  dir="$(make_payload "$NEW_VERSION")"
  write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  echo "ghcr.io/toolpath/chatter:6.6.6 $(fake_image_id evil)" | gzip > "$dir/chatter.tar.gz"
  pack_into_inbox "$dir"

  send_request check

  check "a changed file: refused" status_is refused
  check "a changed file: the reason is the size or checksum" reason_has "checksum"
  check "a changed file: nothing is loaded" test -z "$(grep load "$fake/calls.log")"
  check "a changed file leaves no work files" work_files_are_gone
}

# A roll back finds the old Chatter image by its tag. A new compose file with "latest" (or another version)
# would move that tag to the new image, and the roll back would start the new version again.
test_a_compose_file_that_does_not_name_the_version_is_refused() {
  local tag dir
  for tag in latest "$OLD_VERSION" 1.2.1; do
    set_up
    dir="$(make_payload "$NEW_VERSION")"
    write_compose "$dir/docker-compose.yml" "$tag" "$NEW_VM_TAG"
    write_manifest "$dir" "$NEW_VERSION"
    sign_manifest "$dir"
    pack_into_inbox "$dir"

    send_request check

    check "a signed compose file with chatter:$tag for version $NEW_VERSION: refused" reason_has "not a correct"
  done
}

test_a_wrong_size_is_refused() {
  set_up
  local dir size
  dir="$(make_payload "$NEW_VERSION")"
  write_manifest "$dir" "$NEW_VERSION"
  size="$(stat --format %s "$dir/rules.yml")"
  sed -i "s/^\(file rules.yml [0-9a-f]*\) $size$/\1 $((size + 1))/" "$dir/manifest.txt"
  sign_manifest "$dir"
  pack_into_inbox "$dir"

  send_request check

  check "a signed size that is not the real size: refused" reason_has "checksum"
}

test_an_older_version_is_refused() {
  set_up
  put_update_file 1.0.0 > /dev/null
  send_request check
  check "an older version: refused" status_is refused
  check "an older version: the reason says so" reason_has "not newer"
  check "an older version: the status has the checked version" test "$(status_field version)" = 1.0.0

  set_up
  put_update_file "$OLD_VERSION" > /dev/null
  send_request check
  check "the same version: refused" reason_has "not newer"

  set_up
  put_update_file 1.10.0 > /dev/null
  send_request check
  check "1.10.0 is newer than 1.1.0 (number by number, not text)" status_is ready
}

test_a_bad_version_text_is_refused() {
  local version
  for version in "1.2" "1.2.0-beta" "../1.2.0" "1.2.0 " "v1.2.0"; do
    set_up
    put_update_file "$version" > /dev/null
    send_request check
    check "the version \"$version\": refused" status_is refused
    check "the version \"$version\": not in the status" test -z "$(status_field version)"
  done
}

test_the_wrong_processor_type_is_refused() {
  set_up
  local dir
  dir="$(make_payload "$NEW_VERSION")"
  MANIFEST_ARCH=arm64 write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  pack_into_inbox "$dir"

  send_request check

  check "an update file for arm64 on an armv7 Pi: refused" reason_has "processor"

  set_up
  dir="$(make_payload "$NEW_VERSION")"
  MANIFEST_ARCH=arm64 write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  pack_into_inbox "$dir"
  FAKE_ARCH=arm64 send_request check
  check "an update file for arm64 on an arm64 Pi: ready" status_is ready
}

test_too_little_space_is_refused() {
  set_up
  put_update_file > /dev/null
  FAKE_FREE_BYTES=100000000 send_request check
  check "too little free space: refused" reason_has "space"
  check "too little free space: no work files stay" work_files_are_gone
}

test_a_too_large_file_is_refused() {
  set_up
  truncate --size 629145601 "$inbox/chatter-update.tar"
  send_request check
  check "a file larger than 600 MB: refused" reason_has "600 MB"
  check "a file larger than 600 MB: not copied" work_files_are_gone
}

test_a_symlink_or_fifo_as_the_update_file_is_refused() {
  set_up
  put_update_file > /dev/null
  mv "$inbox/chatter-update.tar" "$sandbox/real.tar"
  ln -s "$sandbox/real.tar" "$inbox/chatter-update.tar"
  send_request check
  check "a symlink as the update file: refused" reason_has "not a normal file"
  check "a symlink as the update file: the file it points to stays" test -f "$sandbox/real.tar"

  set_up
  mkfifo "$inbox/chatter-update.tar"
  send_request check
  check "a FIFO as the update file: refused (the helper does not wait for ever)" reason_has "not a normal file"

  set_up
  put_update_file > /dev/null
  ln "$inbox/chatter-update.tar" "$inbox/second-name.tar"
  send_request check
  check "an update file with a second name (hard link): refused" reason_has "not a normal file"
}

test_a_symlink_or_fifo_as_the_request_does_nothing() {
  set_up
  put_update_file > /dev/null
  printf 'check' > "$sandbox/request-text"
  ln -s "$sandbox/request-text" "$inbox/request.json"
  run_helper request
  check "a symlink as request.json: nothing runs" test ! -e "$(status_file)"
  check "a symlink as request.json: it is moved out of the inbox" test ! -e "$inbox/request.json"
  check "a symlink as request.json: the update file stays in the inbox" test -e "$inbox/chatter-update.tar"

  set_up
  mkfifo "$inbox/request.json"
  run_helper request
  local status=$?
  check "a FIFO as request.json: the helper ends (does not wait for ever)" test "$status" -eq 0
  check "a FIFO as request.json: nothing runs" test ! -e "$(status_file)"
  check "a FIFO as request.json: it is moved out of the inbox" test ! -e "$inbox/request.json"
}

test_only_the_exact_request_texts_work() {
  local text
  for text in $'check\n' "Check" "checkx" "install check" ""; do
    set_up
    put_update_file > /dev/null
    send_request "$text"
    check "the request \"${text//$'\n'/\\n}\": nothing runs" test ! -e "$(status_file)"
  done

  set_up
  put_update_file > /dev/null
  printf 'check' > "$inbox/request.json"
  ln "$inbox/request.json" "$inbox/other-name"
  run_helper request
  check "a request with a second name (hard link): nothing runs" test ! -e "$(status_file)"
}

# Packs the payload with one tar entry changed. The manifest is correctly signed.
tar_trick() {
  local dir
  dir="$(make_payload "$NEW_VERSION")"
  write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  "$@" "$dir"
}

pack_with_symlink() {
  ln -sf /etc/passwd "$1/rules.yml"
  pack_into_inbox "$1"
}

pack_with_dot_dot() {
  mkdir "$1/sub"
  (cd "$1/sub" && tar --create --absolute-names --file "$inbox/chatter-update.tar" \
    ../manifest.txt ../manifest.txt.sig ../chatter.tar.gz ../victoria-metrics.tar.gz ../vmalert.tar.gz \
    ../docker-compose.yml ../rules.yml)
}

pack_with_hard_link() {
  ln -f "$1/docker-compose.yml" "$1/rules.yml"
  pack_into_inbox "$1"
}

pack_with_duplicate() {
  pack_into_inbox "$1"
  tar --append --file "$inbox/chatter-update.tar" --directory "$1" rules.yml
}

pack_with_folder() {
  mkdir "$1/vmalert"
  pack_into_inbox "$1"
}

pack_with_unknown_name() {
  echo '{"state":"ready","version":"9.9.9"}' > "$1/status.json"
  pack_into_inbox "$1"
}

test_tar_tricks_are_refused() {
  local trick
  for trick in pack_with_symlink pack_with_dot_dot pack_with_hard_link pack_with_duplicate pack_with_folder \
    pack_with_unknown_name; do
    set_up
    tar_trick "$trick"
    send_request check
    check "$trick: refused" reason_has "not a correct"
    check "$trick: no work files stay" work_files_are_gone
  done
  check "a symlink entry: /etc/passwd is not changed" test ! -L /etc/passwd

  set_up
  echo "not a tar" > "$inbox/chatter-update.tar"
  send_request check
  check "a file that is not a tar: refused" reason_has "not a correct"

  # GNU tar unpacks a compressed file by itself. A small gzip could then fill the card past the 600 MB limit.
  set_up
  put_update_file > /dev/null
  gzip --stdout "$inbox/chatter-update.tar" > "$sandbox/compressed"
  cat "$sandbox/compressed" > "$inbox/chatter-update.tar"
  send_request check
  check "a correct update file in gzip: refused" reason_has "not a correct"
  check "a correct update file in gzip: no work files stay" work_files_are_gone
}

# The limits hold before the signature check, so an unsigned file cannot make the helper store or read much.
test_size_limits_before_the_signature_check() {
  local dir name
  set_up
  dir="$(make_payload "$NEW_VERSION")"
  write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  mkdir "$dir/many"
  for name in $(seq 1 20000); do : > "$dir/many/$name"; done
  tar --create --file "$inbox/chatter-update.tar" --directory "$dir" -- manifest.txt manifest.txt.sig many
  send_request check
  check "an update file with 20000 entries: refused" reason_has "not a correct"

  set_up
  dir="$(make_payload "$NEW_VERSION")"
  write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  head --bytes 5000 /dev/zero >> "$dir/manifest.txt.sig"
  pack_into_inbox "$dir"
  send_request check
  check "a signature file larger than 4096 bytes: refused before the signature check" reason_has "not a correct"

  set_up
  dir="$(make_payload "$NEW_VERSION")"
  MANIFEST_EXTRA="$(printf 'x%.0s' $(seq 1 5000))" write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  pack_into_inbox "$dir"
  send_request check
  check "a manifest larger than 4096 bytes: refused" reason_has "not a correct"
}

test_a_manifest_that_does_not_match_the_tar_is_refused() {
  set_up
  local dir
  dir="$(make_payload "$NEW_VERSION")"
  rm "$dir/rules.yml"
  write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  pack_into_inbox "$dir"
  send_request check
  check "a manifest with no rules.yml: refused" reason_has "not a correct"

  set_up
  dir="$(make_payload "$NEW_VERSION")"
  write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  pack_into_inbox "$dir" manifest.txt manifest.txt.sig chatter.tar.gz victoria-metrics.tar.gz vmalert.tar.gz docker-compose.yml
  send_request check
  check "a tar with no rules.yml, but the manifest lists it: refused" reason_has "not a correct"

  set_up
  dir="$(make_payload "$NEW_VERSION")"
  echo "status" > "$dir/status.json"
  MANIFEST_EXTRA="file status.json $(sha256sum "$dir/status.json" | cut -d ' ' -f 1) 7" write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  pack_into_inbox "$dir"
  send_request check
  check "a signed manifest with an unknown file name: refused" reason_has "not a correct"

  set_up
  dir="$(make_payload "$NEW_VERSION")"
  write_manifest "$dir" "$NEW_VERSION"
  sed -i 's/$/\r/' "$dir/manifest.txt"
  sign_manifest "$dir"
  pack_into_inbox "$dir"
  send_request check
  check "a signed manifest with CR LF line ends: refused" reason_has "not a correct"
}

test_unchanged_images_must_be_on_the_pi() {
  local dir old_vm="victoriametrics/victoria-metrics:$OLD_VM_TAG" old_vmalert="victoriametrics/vmalert:$OLD_VM_TAG"
  set_up
  dir="$(make_payload "$NEW_VERSION" "$OLD_VM_TAG")"
  rm "$dir/victoria-metrics.tar.gz" "$dir/vmalert.tar.gz"
  MANIFEST_EXTRA="unchanged victoria-metrics.tar.gz $old_vm $(fake_image_id "$old_vm")
unchanged vmalert.tar.gz $old_vmalert $(fake_image_id "$old_vmalert")" write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  pack_into_inbox "$dir"
  send_request check
  check "unchanged images that are on the Pi: ready" status_is ready

  set_up
  dir="$(make_payload "$NEW_VERSION" "$OLD_VM_TAG")"
  rm "$dir/victoria-metrics.tar.gz" "$dir/vmalert.tar.gz"
  MANIFEST_EXTRA="unchanged victoria-metrics.tar.gz $old_vm $(fake_image_id other)
unchanged vmalert.tar.gz $old_vmalert $(fake_image_id "$old_vmalert")" write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  pack_into_inbox "$dir"
  send_request check
  check "an unchanged image whose tag gives a different ID: refused" reason_has "image"

  set_up
  dir="$(make_payload "$NEW_VERSION" "$OLD_VM_TAG")"
  rm "$dir/victoria-metrics.tar.gz"
  MANIFEST_EXTRA="unchanged victoria-metrics.tar.gz victoriametrics/vmalert:$OLD_VM_TAG $(fake_image_id "$old_vmalert")" \
    write_manifest "$dir" "$NEW_VERSION"
  sign_manifest "$dir"
  pack_into_inbox "$dir"
  send_request check
  check "an unchanged image with the name of another image: refused" reason_has "not a correct"
}

test_a_fake_status_in_the_inbox_changes_nothing() {
  set_up
  put_update_file > /dev/null
  echo '{"state":"done","version":"9.9.9"}' > "$inbox/status.json"
  send_request check
  check "a status.json in the inbox: the helper writes its own status" status_is ready
  check "a status.json in the inbox: it stays in the inbox, untouched" grep -q 9.9.9 "$inbox/status.json"
}

test_a_new_check_deletes_the_old_ready_file() {
  set_up
  put_update_file > /dev/null
  send_request check
  echo "not a tar" > "$inbox/chatter-update.tar"
  send_request check
  check "a new, bad file after a ready one: refused" status_is refused
  check "the old ready state is gone" test ! -e "$state_dir/state"
  check "the old copy is gone" work_files_are_gone
}

test_the_installed_version_file() {
  set_up
  rm "$state_dir/installed-version"
  put_update_file > /dev/null
  send_request check
  check "no installed-version file: counts as 0.0.0, so any release is newer" status_is ready

  set_up
  echo "edge-1a2b3c" > "$state_dir/installed-version"
  put_update_file > /dev/null
  send_request check
  check "an installed version that is not a release: refused" reason_has "release"
}

# The data is measured in a container. A container whose first process ignores SIGTERM must still end.
test_a_hung_container_does_not_hang_the_check() {
  set_up
  put_update_file > /dev/null
  UPDATE_DOCKER_TIMEOUT=1s FAKE_DOCKER_HANGS_ON="--entrypoint du" FAKE_DOCKER_IGNORES_TERM=1 send_request check
  stop_hung_docker
  check "a hung measurement that ignores SIGTERM: refused (the helper did not hang)" status_is refused
  check "a hung measurement that ignores SIGTERM: the reason says so" reason_has "could not measure"
  check "a container gets an init process (it passes SIGTERM on), and never downloads an image" \
    docker_was_called_with "run --rm --init --pull=never --network none --user 0:0"
}

test_the_check_command_works_without_a_request() {
  set_up
  put_update_file > /dev/null
  run_helper check
  check "update-chatter.sh check: ready" status_is ready
}

test_the_heartbeat_changes_while_the_helper_works() {
  set_up
  put_update_file > /dev/null
  echo "old" > "$(status_file)"
  UPDATE_HEARTBEAT=1 FAKE_DOCKER_HANGS_ON="du" send_request check &
  local helper=$!
  sleep 3
  check "while the helper waits, the status is checking" status_is checking
  local first
  first="$(status_field heartbeat)"
  sleep 1.5
  check "the heartbeat time changes while the helper waits" test "$(status_field heartbeat)" != "$first"
  stop_hung_docker
  wait "$helper"
}

# A heartbeat that writes at the moment the helper stops it must not write "checking" over the result.
# The heartbeat writes each 10 ms, and each of its writes takes 0.5 seconds, so it is nearly always writing.
test_the_heartbeat_never_writes_after_the_result() {
  set_up
  put_update_file > /dev/null
  UPDATE_HEARTBEAT=0.01 FAKE_SLOW_BUSY_STATUS=1 send_request check
  sleep 1
  check "a heartbeat that writes while the helper ends: the result stays" status_is ready
}

test_a_correct_update_file_is_ready
test_a_check_with_no_update_file_is_refused
test_a_bad_signature_is_refused
test_a_signature_from_another_key_is_refused
test_an_unknown_key_is_refused
test_a_key_id_that_is_a_path_is_refused
test_a_changed_file_is_refused
test_a_compose_file_that_does_not_name_the_version_is_refused
test_a_wrong_size_is_refused
test_an_older_version_is_refused
test_a_bad_version_text_is_refused
test_the_wrong_processor_type_is_refused
test_too_little_space_is_refused
test_a_too_large_file_is_refused
test_a_symlink_or_fifo_as_the_update_file_is_refused
test_a_symlink_or_fifo_as_the_request_does_nothing
test_only_the_exact_request_texts_work
test_tar_tricks_are_refused
test_size_limits_before_the_signature_check
test_a_manifest_that_does_not_match_the_tar_is_refused
test_unchanged_images_must_be_on_the_pi
test_a_fake_status_in_the_inbox_changes_nothing
test_a_new_check_deletes_the_old_ready_file
test_the_installed_version_file
test_a_hung_container_does_not_hang_the_check
test_the_check_command_works_without_a_request
test_the_heartbeat_changes_while_the_helper_works
test_the_heartbeat_never_writes_after_the_result
finish_tests
