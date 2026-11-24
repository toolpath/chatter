#!/bin/sh
# Start a real VictoriaMetrics and vmalert for the history backup tests, with the versions of docker-compose.yml.
#   tools/victoria-test/start.sh
#   CHATTER_TEST_VICTORIA_URL=http://127.0.0.1:18429 npm run test:run -w apps/server -- src/history-backup src/routes/historyBackup
#   tools/victoria-test/stop.sh
# VictoriaMetrics has the deduplication and the container rights of docker-compose.yml (no capabilities, no new
# privileges, a process limit). The time offsets are 0, so the tests do not wait 30 seconds for vmalert.
# The CI runs the same script.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
PORT=${CHATTER_TEST_VICTORIA_PORT:-18429}

docker network create chatter-victoria-test >/dev/null
docker run -d --rm --name chatter-test-victoriametrics --network chatter-victoria-test -p "127.0.0.1:$PORT:8428" \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 512 \
  victoriametrics/victoria-metrics:v1.155.0 -dedup.minScrapeInterval=1ms -search.latencyOffset=0s >/dev/null
docker run -d --rm --name chatter-test-vmalert --network chatter-victoria-test -v "$HERE:/etc/vmalert:ro" \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 256 \
  victoriametrics/vmalert:v1.155.0 -rule=/etc/vmalert/rules.yml -datasource.url=http://chatter-test-victoriametrics:8428 \
  -remoteWrite.url=http://chatter-test-victoriametrics:8428 -evaluationInterval=2s -rule.evalDelay=0s >/dev/null

tries=0
until curl -fs "http://127.0.0.1:$PORT/health" >/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -gt 60 ]; then
    echo "VictoriaMetrics did not start" >&2
    exit 1
  fi
  sleep 1
done
echo "VictoriaMetrics: http://127.0.0.1:$PORT"
