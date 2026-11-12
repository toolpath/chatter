#!/usr/bin/env bash
# Runs test scripts of tools/pi-image/test in a Debian 13 container, as root, as on the Pi.
# The update helper tests need Linux tools (GNU tar, flock, setpriv) and OpenSSL 3 for Ed25519.
# The Mac has none of these, so the tests run in a container. It needs Docker.
# The container gets tools/pi-image at /pi-image, and the whole repo at /repo, both read only.
# The round-trip test runs the real release script from /repo: it finds the compose file and the vmalert rules
# from its own place in the repo.
# The first run builds a small test image (Debian 13 with openssl and shellcheck). Later runs reuse it.
# Run:  tools/pi-image/test/in-linux.sh tools/pi-image/test/update-chatter-check.test.sh [more test scripts]
set -euo pipefail

TEST_IMAGE="chatter-pi-image-test"
PI_IMAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$PI_IMAGE_DIR/../.." && pwd)"

build_test_image() {
  docker build --quiet --tag "$TEST_IMAGE" - > /dev/null << 'EOF'
FROM debian:trixie
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends openssl shellcheck > /dev/null \
 && rm -rf /var/lib/apt/lists/*
EOF
}

run_in_container() {
  local test_name status=0
  for test_script in "$@"; do
    test_name="$(basename "$test_script")"
    echo "==> $test_name"
    docker run --rm --volume "$PI_IMAGE_DIR:/pi-image:ro" --volume "$REPO_ROOT:/repo:ro" \
      --env IN_TEST_CONTAINER=1 \
      "$TEST_IMAGE" "/pi-image/test/$test_name" || status=1
  done
  return "$status"
}

[ "$#" -gt 0 ] || { echo "Usage: in-linux.sh <test script>..." >&2; exit 2; }
build_test_image
run_in_container "$@"
