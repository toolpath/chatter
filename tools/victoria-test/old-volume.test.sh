#!/usr/bin/env bash
# Tests that VictoriaMetrics with the container rights of docker-compose.yml (no capabilities, no new privileges,
# a process limit) can still use the history of an older Chatter, with real Docker (not a fake).
# 1. An old volume: VictoriaMetrics without these rights writes a sample. Then VictoriaMetrics with the rights
#    reads that sample and writes a new one.
# 2. A restored backup: the backup and restore commands of docs/guide/update.md copy the volume to a new volume.
#    VictoriaMetrics with the rights reads both samples and writes a third one.
# The test makes its own volumes and container, with the process ID in the names, and removes them at the end.
# Needs Docker and curl. It pulls the images if needed.
# Run:  tools/victoria-test/old-volume.test.sh
set -uo pipefail

VM_IMAGE="victoriametrics/victoria-metrics:v1.155.0"
ALPINE_IMAGE="alpine:3.22"
PORT="${CHATTER_TEST_OLD_VOLUME_PORT:-18430}"
URL="http://127.0.0.1:$PORT"
OLD_VOLUME="chatter-test-old-volume-$$"
RESTORED_VOLUME="chatter-test-restored-volume-$$"
BACKUP_VOLUME="chatter-test-backup-$$"
CONTAINER="chatter-test-old-volume-vm-$$"
METRIC="chatter_old_volume_test"
failures=0

cleanup() {
  docker rm --force "$CONTAINER" > /dev/null 2>&1
  docker volume rm "$OLD_VOLUME" "$RESTORED_VOLUME" "$BACKUP_VOLUME" > /dev/null 2>&1
}
trap cleanup EXIT

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

# Starts VictoriaMetrics on the volume $1, as docker-compose.yml does. The other arguments go to "docker run",
# for example the container rights.
start_vm() {
  local volume="$1"
  shift
  docker run -d --name "$CONTAINER" -p "127.0.0.1:$PORT:8428" --volume "$volume:/storage" "$@" \
    "$VM_IMAGE" -storageDataPath=/storage -dedup.minScrapeInterval=1ms -search.latencyOffset=0s > /dev/null
}

# Waits up to 60 seconds until VictoriaMetrics answers. False when it does not, for example when it stopped
# because it could not open a file of the volume.
wait_until_healthy() {
  local tries=0
  until curl -fs "$URL/health" > /dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      return 1
    fi
    sleep 1
  done
}

# Stops VictoriaMetrics. On SIGTERM, it writes its data to the volume. Docker waits up to 30 seconds.
stop_vm() {
  docker stop --time 30 "$CONTAINER" > /dev/null && docker rm "$CONTAINER" > /dev/null
}

# Writes one sample with the label step=$1, one minute in the past, and makes it searchable.
write_sample() {
  local timestamp
  timestamp="$(( ($(date +%s) - 60) * 1000 ))"
  curl -fs --data-binary "$METRIC{step=\"$1\"} 1 $timestamp" "$URL/api/v1/import/prometheus" \
    && curl -fs "$URL/internal/force_flush" > /dev/null
}

# True when VictoriaMetrics has a sample with the label step=$1. Waits up to 30 seconds.
has_sample() {
  local tries=0 samples
  until samples="$(curl -fs -G --data-urlencode "match[]=$METRIC{step=\"$1\"}" "$URL/api/v1/export")" \
    && grep -q "\"step\":\"$1\"" <<< "$samples"; do
    tries=$((tries + 1))
    if [ "$tries" -gt 30 ]; then
      return 1
    fi
    sleep 1
  done
}

# True when the log of VictoriaMetrics has no "permission denied" (a file of the volume that it cannot open).
no_permission_error() {
  ! docker logs "$CONTAINER" 2>&1 | grep -qi 'permission denied'
}

# Shows the log of VictoriaMetrics after a failed check, then stops it.
show_log_and_stop() {
  if [ "$failures" -ne 0 ]; then
    docker logs "$CONTAINER" 2>&1 | tail -n 50
  fi
  stop_vm
}

# The same options as docker-compose.yml
WITH_RIGHTS=(--cap-drop ALL --security-opt no-new-privileges:true --pids-limit 512)

test_old_volume() {
  docker volume create "$OLD_VOLUME" > /dev/null
  start_vm "$OLD_VOLUME"
  check "VictoriaMetrics without the container rights starts on a new volume" wait_until_healthy
  check "VictoriaMetrics without the container rights writes a sample" write_sample before
  check "VictoriaMetrics without the container rights reads the sample" has_sample before
  show_log_and_stop

  start_vm "$OLD_VOLUME" "${WITH_RIGHTS[@]}"
  check "VictoriaMetrics with the container rights starts on the old volume" wait_until_healthy
  check "VictoriaMetrics with the container rights reads the old sample" has_sample before
  check "VictoriaMetrics with the container rights writes a new sample" write_sample after
  check "VictoriaMetrics with the container rights reads the new sample" has_sample after
  check "VictoriaMetrics with the container rights logs no permission error" no_permission_error
  show_log_and_stop
}

# The commands of docs/guide/update.md ("Back up and restore"), with a volume in place of the folder "$PWD"
test_restored_backup() {
  docker volume create "$BACKUP_VOLUME" > /dev/null
  docker volume create "$RESTORED_VOLUME" > /dev/null
  check "the backup command copies the old volume to a file" \
    docker run --rm -v "$OLD_VOLUME:/data" -v "$BACKUP_VOLUME:/backup" "$ALPINE_IMAGE" \
    tar czf /backup/victoriametrics-data.tar.gz -C /data .
  check "the restore command puts the file into a new volume" \
    docker run --rm -v "$RESTORED_VOLUME:/data" -v "$BACKUP_VOLUME:/backup" "$ALPINE_IMAGE" \
    sh -c 'rm -rf /data/* /data/.[!.]* && tar xzf /backup/victoriametrics-data.tar.gz -C /data'

  start_vm "$RESTORED_VOLUME" "${WITH_RIGHTS[@]}"
  check "VictoriaMetrics with the container rights starts on the restored volume" wait_until_healthy
  check "VictoriaMetrics reads the first sample from the restored volume" has_sample before
  check "VictoriaMetrics reads the second sample from the restored volume" has_sample after
  check "VictoriaMetrics with the container rights writes into the restored volume" write_sample restored
  check "VictoriaMetrics reads the new sample from the restored volume" has_sample restored
  check "VictoriaMetrics on the restored volume logs no permission error" no_permission_error
  show_log_and_stop
}

docker image inspect "$VM_IMAGE" > /dev/null 2>&1 || docker pull --quiet "$VM_IMAGE" > /dev/null
docker image inspect "$ALPINE_IMAGE" > /dev/null 2>&1 || docker pull --quiet "$ALPINE_IMAGE" > /dev/null
test_old_volume
test_restored_backup

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
