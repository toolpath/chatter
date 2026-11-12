#!/usr/bin/env bash
# Tests for "update-chatter.sh recover" (in-pi/update-chatter.sh): after a power cut, a hard kill, or a hung Docker.
# systemd runs "recover" at each start of the Pi (chatter.service) and after each run of the helper (ExecStopPost=).
# It runs in a Debian 13 container (see in-linux.sh), with fake docker, curl, dpkg, and df.
# Run:  tools/pi-image/test/update-chatter-recover.test.sh
set -uo pipefail
if [ "${IN_TEST_CONTAINER:-}" != 1 ]; then exec "$(dirname "$0")/in-linux.sh" "$0"; fi
# shellcheck source-path=SCRIPTDIR source=update-chatter.lib.sh
source "$(dirname "$0")/update-chatter.lib.sh"

CHATTER_OLD="ghcr.io/toolpath/chatter:$OLD_VERSION"
CHATTER_NEW="ghcr.io/toolpath/chatter:$NEW_VERSION"
# The docker calls that hang in each phase of an install
HANG_IN_BACKING_UP="--entrypoint sh --volume chatter_chatterbox-data:/app/data:ro"
HANG_IN_LOADING="load --input"
HANG_IN_SWAPPED="{{.State.Health.Status}}"

set_up_ready() {
  set_up
  put_update_file > /dev/null
  send_request check
}

old_version_runs() {
  [ "$(cat "$fake/running-tag")" = "$CHATTER_OLD" ] \
    && grep -q "chatter:$OLD_VERSION" "$root/opt/chatter/docker-compose.yml" \
    && [ "$(cat "$state_dir/installed-version")" = "$OLD_VERSION" ]
}

nothing_of_the_run_stays() {
  [ ! -e "$state_dir/state" ] && work_files_are_gone
}

# Starts an install, and kills it with SIGKILL (as Linux does when it has no free memory) while it hangs in a phase.
# A trap cannot catch SIGKILL, so the helper leaves the phase in its state file.
kill_install_in_phase() {
  local phase="$1" hang_on="$2"
  printf 'install' > "$inbox/request.json"
  start_helper_in_own_group "$hang_on" request
  check "the install hangs in the phase $phase" test "$(state_value phase)" = "$phase"
  kill -KILL -- "-$(cat "$sandbox/helper.pid")"
  stop_hung_docker
  wait_until helper_has_ended
  check "after the kill, the phase $phase stays in the state file" test "$(state_value phase)" = "$phase"
}

test_recover_writes_helper_json() {
  local dpkg_arch arch
  for dpkg_arch in armhf arm64 amd64; do
    set_up
    FAKE_ARCH="$dpkg_arch" run_helper recover
    case "$dpkg_arch" in armhf) arch=armv7 ;; *) arch="$dpkg_arch" ;; esac
    check "dpkg says $dpkg_arch: helper.json says $arch" \
      test "$(cat "$root/opt/chatter/update/helper.json")" = "{\"arch\":\"$arch\"}"
  done
  check "Chatter can read helper.json" test "$(stat --format %a "$root/opt/chatter/update/helper.json")" = 644

  set_up
  FAKE_ARCH=i386 run_helper recover
  check "an unknown processor type: no helper.json" test ! -e "$root/opt/chatter/update/helper.json"
}

test_recover_deletes_temporary_files_of_a_power_cut() {
  set_up
  local folder
  for folder in opt/chatter opt/chatter/vmalert opt/chatter/update var/lib/chatter-update; do
    echo "half" > "$root/$folder/.temp.abc123"
  done
  run_helper recover
  check "recover deletes each half-written temporary file" \
    test -z "$(find "$root" -name '.temp.*')"
}

test_recover_after_a_normal_run_changes_nothing() {
  set_up_ready
  local before
  before="$(cat "$(status_file)")"
  : > "$fake/calls.log"
  run_helper recover
  check "after a check: the ready file stays" test "$(state_value phase)" = ready
  check "after a check: the status stays" test "$(cat "$(status_file)")" = "$before"
  check "after a check: recover does not call compose" bash -c "! grep -q compose '$fake/calls.log'"
}

test_a_hard_kill_while_backing_up() {
  set_up_ready
  kill_install_in_phase backing-up "$HANG_IN_BACKING_UP"
  run_helper recover
  check "killed while backing up: failed" status_is failed
  check "killed while backing up: the old version runs again" old_version_runs
  check "killed while backing up: the data is not changed" test "$(cat "$(data_file chatter.db)")" = "old-db"
  check "killed while backing up: the half backup is deleted" test ! -e "$root/opt/chatter/backups/$OLD_VERSION.tmp"
  check "killed while backing up: the state and the work files are gone" nothing_of_the_run_stays
}

test_a_hard_kill_while_loading() {
  set_up_ready
  kill_install_in_phase loading "$HANG_IN_LOADING"
  run_helper recover
  check "killed while loading: failed" status_is failed
  check "killed while loading: the old version runs again" old_version_runs
  check "killed while loading: the new images are deleted" bash -c "! grep -q '$CHATTER_NEW ' '$fake/images.txt'"
  check "killed while loading: the state and the work files are gone" nothing_of_the_run_stays
}

test_a_hard_kill_after_the_swap() {
  set_up_ready
  kill_install_in_phase swapped "$HANG_IN_SWAPPED"
  check "the new version changed the database before the kill" test "$(cat "$(data_file chatter.db)")" = "new-db"
  run_helper recover
  check "killed after the swap: rolled back" status_is rolled-back
  check "killed after the swap: the old version runs again" old_version_runs
  check "killed after the swap: the old database comes back" test "$(cat "$(data_file chatter.db)")" = "old-db"
  check "killed after the swap: the WAL of the new version is gone" test ! -e "$(data_file chatter.db-wal)"
  check "killed after the swap: the state and the work files are gone" nothing_of_the_run_stays
}

test_a_power_cut_between_installed_version_and_done() {
  set_up_ready
  kill_install_in_phase swapped "$HANG_IN_SWAPPED"
  echo "$NEW_VERSION" > "$state_dir/installed-version"
  run_helper recover
  check "a power cut after installed-version was written: rolled back" status_is rolled-back
  check "a power cut after installed-version was written: installed-version is the old one again" \
    test "$(cat "$state_dir/installed-version")" = "$OLD_VERSION"

  set_up
  echo "$NEW_VERSION" > "$state_dir/installed-version"
  echo "{\"state\":\"installing\",\"version\":\"$NEW_VERSION\",\"heartbeat\":\"2026-11-10T10:00:00Z\",\"freeBytes\":1}" \
    > "$(status_file)"
  run_helper recover
  check "a power cut after the phase was cleared, before done: done" status_is "done"
  check "a power cut after the phase was cleared, before done: the version stays" \
    test "$(status_field version)" = "$NEW_VERSION"
}

test_a_backup_with_no_complete_mark_is_not_put_back() {
  set_up_ready
  kill_install_in_phase swapped "$HANG_IN_SWAPPED"
  rm "$root/opt/chatter/backups/$OLD_VERSION/complete"
  run_helper recover
  check "no complete mark: failed" status_is failed
  check "no complete mark: the reason says there is no complete backup" reason_has "no complete backup"
  check "no complete mark: the backup is not put back" test "$(cat "$(data_file chatter.db)")" = "new-db"
  check "no complete mark: the incomplete backup is deleted" test ! -e "$root/opt/chatter/backups/$OLD_VERSION"
}

test_a_hung_docker_step_leads_to_a_roll_back() {
  set_up_ready
  printf 'install' > "$inbox/request.json"
  FAKE_DOCKER_HANGS_ON="up --detach --force-recreate" UPDATE_DOCKER_TIMEOUT=2s run_helper request
  check "a hung compose up: the timeout leads to a roll back" status_is rolled-back
  check "a hung compose up: the old version runs again" old_version_runs

  set_up_ready
  printf 'install' > "$inbox/request.json"
  FAKE_DOCKER_HANGS_ON="load --input" UPDATE_LOAD_TIMEOUT=2s run_helper request
  check "a hung docker load: the timeout leads to failed" status_is failed
  check "a hung docker load: the old version runs again" old_version_runs
}

test_a_ready_file_from_an_earlier_start_is_deleted() {
  set_up_ready
  echo "boot-2" > "$root/proc/sys/kernel/random/boot_id"
  run_helper recover
  check "a ready file from an earlier start of the Pi: deleted" nothing_of_the_run_stays
  check "a ready file from an earlier start of the Pi: the status says to check again" reason_has "again"
}

test_a_kill_during_a_check_gives_failed() {
  set_up
  put_update_file > /dev/null
  printf 'check' > "$inbox/request.json"
  start_helper_in_own_group "du" request
  kill -KILL -- "-$(cat "$sandbox/helper.pid")"
  stop_hung_docker
  wait_until helper_has_ended
  check "killed during a check: the status still says checking" status_is checking
  run_helper recover
  check "killed during a check: recover writes failed" status_is failed
  check "killed during a check: the work files are gone" nothing_of_the_run_stays
}

test_an_install_killed_before_it_changed_anything_stays_ready() {
  set_up_ready
  echo "{\"state\":\"installing\",\"version\":\"$NEW_VERSION\",\"heartbeat\":\"2026-11-10T10:00:00Z\",\"freeBytes\":1}" \
    > "$(status_file)"
  run_helper recover
  check "an install killed before the backup: ready again" status_is ready
}

test_recover_always_succeeds() {
  set_up_ready
  kill_install_in_phase swapped "$HANG_IN_SWAPPED"
  FAKE_DOCKER_FAILS_ON="compose" run_helper recover
  local status=$?
  check "recover ends with success also when Docker fails, so Chatter still starts" test "$status" -eq 0
  check "recover when Docker fails: it still writes a result" status_is failed
  check "recover when Docker fails: the data backup is kept" reason_has "The data backup is kept"
}

test_the_backup_of_a_failed_restore_is_never_deleted() {
  set_up_ready
  kill_install_in_phase swapped "$HANG_IN_SWAPPED"
  local backups="$root/opt/chatter/backups" version
  for version in 9.9.8 9.9.9; do
    mkdir -p "$backups/$version"
    touch "$backups/$version/complete"
  done
  FAKE_CP_FAILS_ON="chatter.db.restore" run_helper recover
  check "a failed restore: failed" status_is failed
  check "a failed restore: its backup stays, also with 2 newer backups" test -f "$backups/$OLD_VERSION/complete"
}

# An install whose roll back could not put the old data back. The phase stays, with the start of the Pi.
fail_a_restore() {
  set_up_ready
  FAKE_HEALTH=unhealthy FAKE_CP_FAILS_ON="focas.restore" send_request install
  check "the restore fails: failed" status_is failed
  check "the restore fails: the phase stays, so the restore is tried again" test "$(state_value phase)" = restore-failed
}

add_two_newer_backups() {
  local version
  for version in 9.9.8 9.9.9; do
    mkdir -p "$root/opt/chatter/backups/$version"
    touch "$root/opt/chatter/backups/$version/complete"
  done
}

old_backup_is_kept() {
  [ -f "$root/opt/chatter/backups/$OLD_VERSION/complete" ] && [ -f "$root/opt/chatter/backups/$OLD_VERSION/data/chatter.db" ]
}

test_a_failed_restore_is_tried_again_at_the_next_start() {
  fail_a_restore
  run_helper recover
  check "recover in the same start of the Pi (after the helper run): no new try" \
    test "$(cat "$(data_file chatter.db)")" = "new-db"
  check "recover in the same start of the Pi: the phase stays" test "$(state_value phase)" = restore-failed

  echo "boot-2" > "$root/proc/sys/kernel/random/boot_id"
  run_helper recover
  check "the next start of the Pi, the restore works: rolled back" status_is rolled-back
  check "the next start of the Pi, the restore works: the reason says the old data is back" reason_has "old data was put back"
  check "the next start of the Pi, the restore works: the old database is back" \
    test "$(cat "$(data_file chatter.db)")" = "old-db"
  check "the next start of the Pi, the restore works: the old version runs" old_version_runs
  check "the next start of the Pi, the restore works: the state and the work files are gone" nothing_of_the_run_stays
}

test_a_restore_that_fails_again_keeps_the_phase_and_the_backup() {
  fail_a_restore
  add_two_newer_backups
  echo "boot-2" > "$root/proc/sys/kernel/random/boot_id"
  FAKE_CP_FAILS_ON="focas.restore" run_helper recover
  local status=$?
  check "the restore fails again: recover still ends with success, so Chatter starts" test "$status" -eq 0
  check "the restore fails again: failed" status_is failed
  check "the restore fails again: the reason says that the data backup is kept" reason_has "The data backup is kept"
  check "the restore fails again: the phase stays" test "$(state_value phase)" = restore-failed
  check "the restore fails again: the next try is at the next start" test "$(state_value boot_id)" = boot-2
  check "the restore fails again: the backup stays, also with 2 newer backups" old_backup_is_kept
}

test_no_check_or_install_while_the_old_data_waits() {
  fail_a_restore
  add_two_newer_backups
  put_update_file > /dev/null
  send_request check
  check "a check while the old data waits: refused" status_is refused
  check "a check while the old data waits: the reason says why" reason_has "waits to be put back"
  check "a check while the old data waits: the phase stays" test "$(state_value phase)" = restore-failed
  check "a check while the old data waits: the update file stays in the inbox" test -f "$inbox/chatter-update.tar"

  send_request install
  check "an install while the old data waits: refused" status_is refused
  check "an install while the old data waits: the reason says why" reason_has "waits to be put back"
  check "an install while the old data waits: the phase stays" test "$(state_value phase)" = restore-failed
  check "while the old data waits: its backup stays" old_backup_is_kept
}

test_a_request_after_a_hard_kill_recovers_first() {
  set_up_ready
  kill_install_in_phase loading "$HANG_IN_LOADING"
  put_update_file > /dev/null
  send_request check
  check "a check after a hard kill: the old version runs again first" old_version_runs
  check "a check after a hard kill: then the new file is ready" status_is ready
}

test_the_lock() {
  set_up_ready
  echo "boot-2" > "$root/proc/sys/kernel/random/boot_id"
  flock "$state_dir/lock" sleep 3 &
  local holder=$!
  sleep 0.5
  run_helper recover &
  local recover=$!
  sleep 1
  check "recover waits while another run holds the lock" kill -0 "$recover"
  check "recover does nothing while it waits" test "$(state_value phase)" = ready
  wait "$holder"
  wait "$recover"
  check "recover runs when the lock is free" nothing_of_the_run_stays

  set_up
  put_update_file > /dev/null
  flock "$state_dir/lock" sleep 3 &
  holder=$!
  sleep 0.5
  send_request check
  check "a request while another run holds the lock: dropped" test ! -e "$inbox/request.json"
  check "a request while another run holds the lock: no status" test ! -e "$(status_file)"
  check "a request while another run holds the lock: the update file stays in the inbox" \
    test -e "$inbox/chatter-update.tar"
  wait "$holder"
}

test_recover_writes_helper_json
test_recover_deletes_temporary_files_of_a_power_cut
test_recover_after_a_normal_run_changes_nothing
test_a_hard_kill_while_backing_up
test_a_hard_kill_while_loading
test_a_hard_kill_after_the_swap
test_a_power_cut_between_installed_version_and_done
test_a_backup_with_no_complete_mark_is_not_put_back
test_a_hung_docker_step_leads_to_a_roll_back
test_a_ready_file_from_an_earlier_start_is_deleted
test_a_kill_during_a_check_gives_failed
test_an_install_killed_before_it_changed_anything_stays_ready
test_recover_always_succeeds
test_the_backup_of_a_failed_restore_is_never_deleted
test_a_failed_restore_is_tried_again_at_the_next_start
test_a_restore_that_fails_again_keeps_the_phase_and_the_backup
test_no_check_or_install_while_the_old_data_waits
test_a_request_after_a_hard_kill_recovers_first
test_the_lock
finish_tests
