#!/usr/bin/env bash
# Tests for "update-chatter.sh install" (in-pi/update-chatter.sh), with the roll back and the clean up.
# It runs in a Debian 13 container (see in-linux.sh), with fake docker, curl, dpkg, and df.
# Run:  tools/pi-image/test/update-chatter-install.test.sh
set -uo pipefail
if [ "${IN_TEST_CONTAINER:-}" != 1 ]; then exec "$(dirname "$0")/in-linux.sh" "$0"; fi
# shellcheck source-path=SCRIPTDIR source=update-chatter.lib.sh
source "$(dirname "$0")/update-chatter.lib.sh"

CHATTER_OLD="ghcr.io/toolpath/chatter:$OLD_VERSION"
CHATTER_NEW="ghcr.io/toolpath/chatter:$NEW_VERSION"

# A sandbox with a checked (ready) update file of version 1.2.0
set_up_ready() {
  set_up
  put_update_file > /dev/null
  send_request check
}

old_version_runs() {
  [ "$(cat "$fake/running-tag")" = "$CHATTER_OLD" ] \
    && grep -q "chatter:$OLD_VERSION" "$root/opt/chatter/docker-compose.yml" \
    && grep -q "rules of $OLD_VERSION" "$root/opt/chatter/vmalert/rules.yml" \
    && [ "$(cat "$state_dir/installed-version")" = "$OLD_VERSION" ]
}

new_version_runs() {
  [ "$(cat "$fake/running-tag")" = "$CHATTER_NEW" ] \
    && grep -q "chatter:$NEW_VERSION" "$root/opt/chatter/docker-compose.yml" \
    && grep -q "rules of $NEW_VERSION" "$root/opt/chatter/vmalert/rules.yml" \
    && [ "$(cat "$state_dir/installed-version")" = "$NEW_VERSION" ]
}

nothing_of_the_run_stays() {
  [ ! -e "$state_dir/state" ] && work_files_are_gone
}

# The line number of the first docker call that has the text
call_line() {
  grep -nF -- "$1" "$fake/calls.log" | head -n 1 | cut -d : -f 1
}

test_an_install_runs_the_new_version() {
  set_up_ready
  send_request install

  check "install: done" status_is "done"
  check "install: the status has the new version" test "$(status_field version)" = "$NEW_VERSION"
  check "install: the status has the space that the clean up gave back" test -n "$(status_field freedBytes)"
  check "install: the status is the JSON that Chatter reads" status_is_valid_json
  check "install: the new version runs, with its compose file, rules, and installed-version" new_version_runs
  check "install: Chatter is stopped before the backup" docker_was_called_with "compose stop chatterbox"
  check "install: compose recreates each container, so vmalert reads the new rules" \
    docker_was_called_with "compose up --detach --force-recreate"
  check "install: the state and the work files are gone" nothing_of_the_run_stays
}

test_an_install_backs_up_the_old_version() {
  set_up_ready
  send_request install
  local backup="$root/opt/chatter/backups/$OLD_VERSION"

  check "the backup folder is root only" test "$(stat --format %a "$root/opt/chatter/backups")" = 700
  check "the backup has a complete mark" test -f "$backup/complete"
  check "the backup knows its version" test "$(cat "$backup/version")" = "$OLD_VERSION"
  check "the backup has the old compose file" grep -q "chatter:$OLD_VERSION" "$backup/docker-compose.yml"
  check "the backup has the old rules" grep -q "rules of $OLD_VERSION" "$backup/rules.yml"
  check "the backup has the old database" test "$(cat "$backup/data/chatter.db")" = "old-db"
  check "the backup keeps the owner of the database (uid 1000)" test "$(stat --format %u "$backup/data/chatter.db")" = 1000
  check "the backup has the FOCAS library folder" test -f "$backup/data/focas/libfwlib32.so"
  check "no temporary backup folder stays" test ! -e "$backup.tmp" -a ! -e "$backup.old"
}

test_an_install_deletes_only_images_that_no_version_needs() {
  set_up_ready
  send_request install

  check "the version before the old one is deleted" bash -c "! grep -q 'chatter:1.0.0 ' '$fake/images.txt'"
  check "it is deleted before the new images load" \
    test "$(call_line "rmi ghcr.io/toolpath/chatter:1.0.0")" -lt "$(call_line "load --input")"
  check "the old Chatter image stays, for a roll back" has_image "$CHATTER_OLD"
  check "the old VictoriaMetrics image stays, for a roll back" has_image "victoriametrics/victoria-metrics:$OLD_VM_TAG"
  check "the new images are on the Pi" has_image "$CHATTER_NEW"
  check "an image that is not Chatter's stays" has_image "debian:trixie"
}

test_a_failed_load_starts_the_old_version_again() {
  set_up_ready
  FAKE_DOCKER_FAILS_ON="vmalert.tar.gz" send_request install

  check "docker load fails: failed" status_is failed
  check "docker load fails: the reason says so" reason_has "did not load"
  check "docker load fails: the old version runs again" old_version_runs
  check "docker load fails: the new images are deleted" bash -c "! grep -q 'chatter:$NEW_VERSION ' '$fake/images.txt'"
  check "docker load fails: the old images stay" has_image "$CHATTER_OLD"
  check "docker load fails: the data is not changed" test "$(cat "$(data_file chatter.db)")" = "old-db"
  check "docker load fails: the state and the work files are gone" nothing_of_the_run_stays
}

test_a_failed_health_check_rolls_back() {
  set_up_ready
  FAKE_HEALTH=unhealthy send_request install

  check "the health check fails: rolled back" status_is rolled-back
  check "the health check fails: the reason says so" reason_has "did not start correctly"
  check "the health check fails: the old version runs again" old_version_runs
  check "the old database comes back" test "$(cat "$(data_file chatter.db)")" = "old-db"
  check "the old database still belongs to uid 1000" test "$(stat --format %u "$(data_file chatter.db)")" = 1000
  check "the WAL of the new version is gone" test ! -e "$(data_file chatter.db-wal)"
  check "the shared memory file of the new version is gone" test ! -e "$(data_file chatter.db-shm)"
  check "the FOCAS library comes back" test -f "$(data_file focas/libfwlib32.so)"
  check "the roll back starts the old containers again" test "$(grep -c "compose up --detach --force-recreate" "$fake/calls.log")" -eq 2
  check "the new images are deleted" bash -c "! grep -q 'chatter:$NEW_VERSION ' '$fake/images.txt'"
  check "the old images stay" has_image "$CHATTER_OLD"
  check "the state and the work files are gone" nothing_of_the_run_stays
}

test_a_roll_back_puts_back_the_old_wal() {
  set_up_ready
  setpriv --reuid=1000 --regid=1000 --clear-groups sh -c "echo old-wal > '$(data_file chatter.db-wal)'"
  FAKE_HEALTH=unhealthy send_request install

  check "the old WAL comes back, not the new one" test "$(cat "$(data_file chatter.db-wal)")" = "old-wal"
  check "the old WAL still belongs to uid 1000" test "$(stat --format %u "$(data_file chatter.db-wal)")" = 1000
}

# The restore copies the backup next to the data first. If that fails, the data is not touched,
# and Chatter does not start: the Admin must look at the data and the backup first.
test_a_failed_restore_keeps_the_data_and_the_backup() {
  set_up_ready
  FAKE_HEALTH=unhealthy FAKE_CP_FAILS_ON="focas.restore" send_request install
  local backup="$root/opt/chatter/backups/$OLD_VERSION"

  check "the restore fails: failed" status_is failed
  check "the restore fails: the reason says that the data backup is kept" reason_has "The data backup is kept"
  check "the restore fails: the data is not half deleted" test "$(cat "$(data_file chatter.db)")" = "new-db"
  check "the restore fails: the FOCAS library is still there" test -f "$(data_file focas/libfwlib32.so)"
  check "the restore fails: no .restore copies stay" test -z "$(find "$fake/volumes/chatter_chatterbox-data" -name "*.restore")"
  check "the restore fails: Chatter is not started again" \
    test "$(grep -c "compose up --detach" "$fake/calls.log")" -eq 1
  check "the restore fails: the backup is kept, complete" test -f "$backup/complete" -a -f "$backup/data/chatter.db"
  check "the restore fails: the log names the backup folder" grep -qF "kept in $backup" "$sandbox/helper.log"
}

test_a_roll_back_restores_only_after_chatter_stopped() {
  set_up_ready
  FAKE_HEALTH=unhealthy FAKE_DOCKER_FAILS_ON="compose stop chatterbox" FAKE_DOCKER_FAILS_FROM=2 send_request install

  check "Chatter does not stop for the roll back: failed" status_is failed
  check "Chatter does not stop for the roll back: the reason says that the data backup is kept" \
    reason_has "The data backup is kept"
  check "Chatter does not stop for the roll back: the data is not restored under it" \
    bash -c "! grep -qF '/backup:ro' '$fake/calls.log'"
}

test_a_container_that_is_not_new_rolls_back() {
  set_up_ready
  FAKE_SAME_CONTAINER=1 send_request install
  check "the Chatter container is not new: rolled back" status_is rolled-back

  set_up_ready
  FAKE_STOPPED_SERVICE=vmalert send_request install
  check "a container does not run: rolled back" status_is rolled-back

  set_up_ready
  FAKE_HEALTH_VERSION="$OLD_VERSION" send_request install
  check "/api/health gives another version: rolled back" status_is rolled-back
}

test_install_with_no_ready_file_is_refused() {
  set_up
  echo '{"state":"ready","version":"1.2.0"}' > "$inbox/status.json"
  send_request install
  check "install with no ready check: refused" status_is refused
  check "install with no ready check: the reason says to check first" reason_has "Check the update file first"
  check "install with no ready check: nothing is stopped" bash -c "! grep -q stop '$fake/calls.log'"
}

test_a_ready_file_older_than_a_day_is_refused() {
  set_up_ready
  sed -i "s/^checked_at=.*/checked_at=$(( $(date +%s) - 86401 ))/" "$state_dir/state"
  send_request install
  check "a check older than 24 hours: refused" status_is refused
  check "a check older than 24 hours: the reason says so" reason_has "The check is too old. Check the file again."
  check "a check older than 24 hours: the ready file is gone" nothing_of_the_run_stays
  check "a check older than 24 hours: nothing is stopped" bash -c "! grep -q stop '$fake/calls.log'"
}

test_a_second_install_of_the_same_file_does_nothing() {
  set_up_ready
  send_request install
  : > "$fake/calls.log"
  send_request install
  check "a second install: refused" status_is refused
  check "a second install: the new version still runs" new_version_runs
  check "a second install: nothing is stopped" bash -c "! grep -q stop '$fake/calls.log'"
}

test_install_after_the_file_changed() {
  set_up_ready
  put_update_file 1.3.0 > /dev/null
  send_request install
  check "a new file in the inbox after the check: the checked version installs" new_version_runs
  check "a new file in the inbox after the check: it stays in the inbox, unread" test -f "$inbox/chatter-update.tar"

  set_up_ready
  echo "changed" >> "$state_dir/update.tar"
  send_request install
  check "the checked copy changed: refused" status_is refused
  check "the checked copy changed: the reason says so" reason_has "changed"
  check "the checked copy changed: nothing is stopped" bash -c "! grep -q stop '$fake/calls.log'"
}

test_the_same_update_after_a_roll_back() {
  set_up_ready
  FAKE_HEALTH=unhealthy send_request install
  put_update_file > /dev/null
  send_request check
  send_request install
  local backups="$root/opt/chatter/backups"

  check "the same update after a roll back: done" status_is "done"
  check "the same update after a roll back: the new version runs" new_version_runs
  check "the backup of the old version is complete" test -f "$backups/$OLD_VERSION/complete"
  check "no .old or .tmp backup stays" test "$(ls -A "$backups")" = "$OLD_VERSION"
}

test_a_leftover_old_backup_is_deleted() {
  set_up_ready
  mkdir -p "$root/opt/chatter/backups/$OLD_VERSION.old"
  echo "power cut" > "$root/opt/chatter/backups/$OLD_VERSION.old/chatter.db"
  send_request install
  check "a leftover .old backup: done" status_is "done"
  check "a leftover .old backup is deleted" test ! -e "$root/opt/chatter/backups/$OLD_VERSION.old"
}

test_too_little_space_at_install_starts_the_old_version_again() {
  set_up_ready
  FAKE_FREE_BYTES=100000000 send_request install
  check "too little space at install: failed" status_is failed
  check "too little space at install: the reason says so" reason_has "space"
  check "too little space at install: the old version runs again" old_version_runs
}

# Runs the install, waits until it hangs in a phase, then stops it as systemd stops a service:
# a signal to each of its processes. (timeout puts docker in a process group of its own, so it gets its own signal.)
stop_install_in_phase() {
  local phase="$1" signal="$2" hang_on="$3"
  printf 'install' > "$inbox/request.json"
  start_helper_in_own_group "$hang_on" request
  check "the helper hangs in the phase $phase" test "$(state_value phase)" = "$phase"
  kill "-$signal" -- "-$(cat "$sandbox/helper.pid")"
  stop_hung_docker
  wait_until helper_has_ended
  check "the helper ends at once after the signal (it does not wait for a timeout)" helper_has_ended
  check "the trap writes its lines to the log" grep -q "stopped before it ended" "$sandbox/helper.log"
}

test_a_stopped_helper_cleans_up_with_its_trap() {
  # Longer than wait_until waits, so an end by a timeout (not by the trap) fails the test
  local UPDATE_DOCKER_TIMEOUT=50s UPDATE_LOAD_TIMEOUT=50s
  set_up_ready
  stop_install_in_phase loading TERM "load --input"
  check "stopped while loading: failed" status_is failed
  check "stopped while loading: the old version runs again" old_version_runs
  check "stopped while loading: the state and the work files are gone" nothing_of_the_run_stays

  set_up_ready
  stop_install_in_phase swapped TERM "up --detach --force-recreate"
  check "stopped after the swap: rolled back" status_is rolled-back
  check "stopped after the swap: the old version runs again" old_version_runs
  check "stopped after the swap: the old database comes back" test "$(cat "$(data_file chatter.db)")" = "old-db"
}

# The install writes installed-version, clears the state, then writes "done". A stop just before "done"
# must not write "failed": the new version is installed and runs.
test_a_helper_stopped_just_before_done_says_done() {
  set_up_ready
  printf 'install' > "$inbox/request.json"
  FAKE_DF_HANGS_WITHOUT="$state_dir/state" start_helper_in_own_group "nothing hangs in docker" request
  kill -TERM -- "-$(cat "$sandbox/helper.pid")"
  stop_hung_docker
  wait_until helper_has_ended
  check "stopped after the state was cleared: done, not failed" status_is "done"
  check "stopped after the state was cleared: the status has the new version" \
    test "$(status_field version)" = "$NEW_VERSION"
  check "stopped after the state was cleared: the new version runs" new_version_runs
}

# A container whose first process ignores SIGTERM does not stop at the time limit. Only SIGKILL ends the step.
test_a_hung_container_that_ignores_sigterm_is_killed() {
  local UPDATE_DOCKER_TIMEOUT=1s
  set_up_ready
  FAKE_DOCKER_HANGS_ON="--entrypoint sh --volume chatter_chatterbox-data:/app/data:ro" FAKE_DOCKER_IGNORES_TERM=1 \
    send_request install
  stop_hung_docker
  check "a hung backup that ignores SIGTERM: failed (the helper did not hang)" status_is failed
  check "a hung backup that ignores SIGTERM: the reason is the backup" reason_has "backup"
  check "a hung backup that ignores SIGTERM: the old version runs again" old_version_runs
}

test_the_clean_up_keeps_the_last_two_backups() {
  set_up_ready
  local backups="$root/opt/chatter/backups" version
  for version in 0.9.0 1.0.0; do
    mkdir -p "$backups/$version"
    touch "$backups/$version/complete"
  done
  mkdir -p "$backups/0.8.0"
  send_request install

  check "the clean up keeps the backup of the old version" test -f "$backups/$OLD_VERSION/complete"
  check "the clean up keeps the backup before it" test -d "$backups/1.0.0"
  check "the clean up deletes older backups" test ! -e "$backups/0.9.0"
  check "the clean up deletes a backup with no complete mark" test ! -e "$backups/0.8.0"
}

test_a_failed_clean_up_does_not_change_the_result() {
  set_up_ready
  FAKE_DOCKER_FAILS_ON="rmi" send_request install
  check "docker rmi fails: still done" status_is "done"
  check "docker rmi fails: the new version runs" new_version_runs
}

test_an_install_runs_the_new_version
test_an_install_backs_up_the_old_version
test_an_install_deletes_only_images_that_no_version_needs
test_a_failed_load_starts_the_old_version_again
test_a_failed_health_check_rolls_back
test_a_roll_back_puts_back_the_old_wal
test_a_failed_restore_keeps_the_data_and_the_backup
test_a_roll_back_restores_only_after_chatter_stopped
test_a_container_that_is_not_new_rolls_back
test_install_with_no_ready_file_is_refused
test_a_ready_file_older_than_a_day_is_refused
test_a_second_install_of_the_same_file_does_nothing
test_install_after_the_file_changed
test_the_same_update_after_a_roll_back
test_a_leftover_old_backup_is_deleted
test_too_little_space_at_install_starts_the_old_version_again
test_a_stopped_helper_cleans_up_with_its_trap
test_a_helper_stopped_just_before_done_says_done
test_a_hung_container_that_ignores_sigterm_is_killed
test_the_clean_up_keeps_the_last_two_backups
test_a_failed_clean_up_does_not_change_the_result
finish_tests
