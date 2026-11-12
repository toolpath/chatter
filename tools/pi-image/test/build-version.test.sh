#!/usr/bin/env bash
# Tests for the version parts of build.sh: CHATTER_VERSION goes into the Chatter image and into installed-version.
# It loads build.sh without running the build. A fake "docker" records the build command.
# Runs on macOS and Linux.  Run:  tools/pi-image/test/build-version.test.sh
set -uo pipefail

BUILD_SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/build.sh"
failures=0

sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
mkdir -p "$sandbox/bin"
cat > "$sandbox/bin/docker" << 'EOF'
#!/usr/bin/env bash
echo "$*" >> "$(dirname "$0")/../docker.log"
EOF
chmod +x "$sandbox/bin/docker"

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

# Loads build.sh in a new shell with a CHATTER_VERSION (empty: not set), and runs the given build.sh functions.
# TEST_IMAGE_URL (environment): the CHATTER_IMAGE_URL of a release build. Without it, CHATTER_IMAGE_URL is not set.
# TEST_USE_RELEASE_IMAGE (environment): the CHATTER_USE_RELEASE_IMAGE of the build. Without it, it is not set.
# The payload goes to the sandbox, not to tools/pi-image/.work.
run_build_functions() {
  local version="$1"
  shift
  (
    if [ -n "$version" ]; then export CHATTER_VERSION="$version"; else unset CHATTER_VERSION; fi
    if [ -n "${TEST_IMAGE_URL:-}" ]; then export CHATTER_IMAGE_URL="$TEST_IMAGE_URL"; else unset CHATTER_IMAGE_URL; fi
    if [ -n "${TEST_USE_RELEASE_IMAGE:-}" ]; then
      export CHATTER_USE_RELEASE_IMAGE="$TEST_USE_RELEASE_IMAGE"
    else
      unset CHATTER_USE_RELEASE_IMAGE
    fi
    export PATH="$sandbox/bin:$PATH"
    # shellcheck source-path=SCRIPTDIR source=../build.sh
    source "$BUILD_SCRIPT"
    WORK="$sandbox/work"
    PAYLOAD="$WORK/payload"
    for function_name in "$@"; do
      "$function_name"
    done
  ) > "$sandbox/output.log" 2>&1
}

test_the_version_goes_into_the_image_and_the_card() {
  rm -f "$sandbox/docker.log"
  run_build_functions 1.4.0 check_chatter_version prepare_payload save_chatter_image
  check "a release version is accepted" test "$?" -eq 0
  check "the Chatter image gets the version as a build argument" grep -q -- "--build-arg CHATTER_VERSION=1.4.0" "$sandbox/docker.log"
  check "installed-version on the card has the version" test "$(cat "$sandbox/work/payload/installed-version")" = "1.4.0"
}

test_a_local_build_is_version_0_0_0() {
  run_build_functions "" check_chatter_version prepare_payload
  check "no CHATTER_VERSION: the card is 0.0.0, older than any release" \
    test "$(cat "$sandbox/work/payload/installed-version")" = "0.0.0"
}

# A release card with 0.0.0 would accept any older signed update file.
test_a_release_build_needs_a_version() {
  TEST_IMAGE_URL="https://example.com/chatter.img.xz" run_build_functions "" check_chatter_version
  check "a release build with no CHATTER_VERSION: the build stops" test "$?" -ne 0
  check "a release build with no CHATTER_VERSION: it says why" grep -q "needs CHATTER_VERSION" "$sandbox/output.log"

  TEST_IMAGE_URL="https://example.com/chatter.img.xz" run_build_functions 1.4.0 check_chatter_version
  check "a release build with CHATTER_VERSION: accepted" test "$?" -eq 0
}

test_a_version_that_is_not_a_release_stops_the_build() {
  local version
  for version in "edge-1a2b3c" "1.4" "v1.4.0"; do
    run_build_functions "$version" check_chatter_version
    check "CHATTER_VERSION=$version: the build stops" test "$?" -ne 0
    check "CHATTER_VERSION=$version: it says why" grep -q "release version" "$sandbox/output.log"
  done
}

test_no_public_update_key_gives_a_warning() {
  run_build_functions 1.4.0 warn_if_no_update_key
  check "no public update key: the build goes on" test "$?" -eq 0
  if ls "$(dirname "$BUILD_SCRIPT")"/in-pi/update-keys/*.pub > /dev/null 2>&1; then
    check "a public update key: no warning" bash -c "! grep -q Warning '$sandbox/output.log'"
  else
    check "no public update key: a clear warning" grep -q "Warning: there is no public update key" "$sandbox/output.log"
  fi
}

# The release job makes the card with the Chatter image that the release published, so it builds nothing.
test_a_release_image_is_pulled_not_built() {
  rm -f "$sandbox/docker.log"
  TEST_USE_RELEASE_IMAGE=1 run_build_functions 1.4.0 check_chatter_version prepare_payload save_chatter_image
  check "the release image: accepted" test "$?" -eq 0
  check "the release image: Docker pulls the release version for the Pi" \
    grep -qx -- "pull --quiet --platform linux/arm/v7 ghcr.io/toolpath/chatter:1.4.0" "$sandbox/docker.log"
  check "the release image: it gets the name that docker-compose.yml starts" \
    grep -qx -- "tag ghcr.io/toolpath/chatter:1.4.0 ghcr.io/toolpath/chatter:latest" "$sandbox/docker.log"
  check "the release image: Docker saves it for the Pi" \
    grep -qx -- "save --platform linux/arm/v7 --output $sandbox/work/payload/images/chatter.tar ghcr.io/toolpath/chatter:latest" \
    "$sandbox/docker.log"
  check "the release image: nothing is built" bash -c "! grep -q buildx '$sandbox/docker.log'"
}

# Without a version, the build would pull ghcr.io/toolpath/chatter:0.0.0, which no release has.
test_the_release_image_needs_a_version() {
  TEST_USE_RELEASE_IMAGE=1 run_build_functions "" check_chatter_version
  check "the release image with no CHATTER_VERSION: the build stops" test "$?" -ne 0
  check "the release image with no CHATTER_VERSION: it says why" grep -q "needs CHATTER_VERSION" "$sandbox/output.log"
}

test_the_version_goes_into_the_image_and_the_card
test_a_release_image_is_pulled_not_built
test_the_release_image_needs_a_version
test_a_local_build_is_version_0_0_0
test_a_release_build_needs_a_version
test_a_version_that_is_not_a_release_stops_the_build
test_no_public_update_key_gives_a_warning

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
