#!/usr/bin/env bash
# Tests for in-pi/load-images.sh.
# A fake "docker" command records each call, so the tests need no Docker.
# Run:  tools/pi-image/test/load-images.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/in-pi/load-images.sh"
failures=0

sandboxes=()
trap 'rm -rf "${sandboxes[@]}"' EXIT

# Makes a temporary folder with a fake docker command and an images folder.
# The fake docker writes its arguments to calls.log.
# It fails when FAKE_DOCKER_FAILS=1, or when its arguments contain the text in FAKE_DOCKER_FAILS_ON.
set_up() {
  sandbox="$(mktemp -d)"
  sandboxes+=("$sandbox")
  mkdir -p "$sandbox/bin" "$sandbox/images"
  cat > "$sandbox/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$(dirname "$0")/../calls.log"
[ "${FAKE_DOCKER_FAILS:-0}" != "1" ] || exit 1
[ -z "${FAKE_DOCKER_FAILS_ON:-}" ] || [[ "$*" != *"$FAKE_DOCKER_FAILS_ON"* ]]
EOF
  chmod +x "$sandbox/bin/docker"
  touch "$sandbox/calls.log"
}

run_script() {
  PATH="$sandbox/bin:$PATH" "$SCRIPT" "$sandbox/images" > "$sandbox/output.log" 2>&1
}

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

test_loads_each_image_and_deletes_it() {
  set_up
  touch "$sandbox/images/chatter.tar.gz" "$sandbox/images/vmalert.tar.gz"

  run_script

  check "loads the first image file into Docker" \
    grep -q "load --input $sandbox/images/chatter.tar.gz" "$sandbox/calls.log"
  check "loads the second image file into Docker" \
    grep -q "load --input $sandbox/images/vmalert.tar.gz" "$sandbox/calls.log"
  check "deletes each image file after it loads, to give the card the space back" \
    test -z "$(ls -A "$sandbox/images")"
}

test_keeps_the_file_when_docker_cannot_load_it() {
  set_up
  touch "$sandbox/images/chatter.tar.gz"

  FAKE_DOCKER_FAILS=1 run_script
  local status=$?

  check "fails when Docker cannot load an image, so systemd starts it again later" test "$status" -ne 0
  check "keeps the image file, so the next start tries again" test -f "$sandbox/images/chatter.tar.gz"
}

test_keeps_only_the_files_that_did_not_load() {
  set_up
  touch "$sandbox/images/chatter.tar.gz" "$sandbox/images/vmalert.tar.gz"

  FAKE_DOCKER_FAILS_ON=vmalert run_script
  local status=$?

  check "fails when the second image does not load" test "$status" -ne 0
  check "deletes the first image file, because it loaded" test ! -e "$sandbox/images/chatter.tar.gz"
  check "keeps the second image file, so the next start tries it again" test -f "$sandbox/images/vmalert.tar.gz"
}

test_does_nothing_after_the_first_start() {
  set_up

  run_script
  local status=$?

  check "succeeds when no image files are left" test "$status" -eq 0
  check "does not call Docker when no image files are left" test ! -s "$sandbox/calls.log"
}

test_loads_each_image_and_deletes_it
test_keeps_the_file_when_docker_cannot_load_it
test_keeps_only_the_files_that_did_not_load
test_does_nothing_after_the_first_start

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
