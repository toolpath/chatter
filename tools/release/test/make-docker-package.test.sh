#!/usr/bin/env bash
# Tests for make-docker-package.sh.
# A fake "docker" records each call, so the tests need no Docker.
#
# Needs zip and unzip.  Run:  tools/release/test/make-docker-package.test.sh
# On a Mac, it also runs in Docker:
#   docker run --rm -v "$PWD:/repo" -w /repo debian:trixie-slim bash -c \
#     'apt-get update -qq && apt-get install -y -qq zip unzip > /dev/null && tools/release/test/make-docker-package.test.sh'
set -uo pipefail

RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$RELEASE_DIR/../.." && pwd)"
SCRIPT="$RELEASE_DIR/make-docker-package.sh"
EXPECTED_MEMBERS="chatter/
chatter/README.txt
chatter/docker-compose.yml
chatter/images.tar
chatter/vmalert/
chatter/vmalert/rules.yml"
failures=0

sandboxes=()
trap 'rm -rf "${sandboxes[@]}"' EXIT

# Makes a temporary folder with a fake docker.
# The fake docker remembers the platform of each pull. "docker save" writes each image and its platform as text.
# FAKE_CONTAINERD_STORE=1 makes "docker info" say the containerd image store.
# FAKE_PULLED_PLATFORM makes each pull give this platform, not the one asked for.
set_up() {
  sandbox="$(mktemp -d)"
  sandboxes+=("$sandbox")
  mkdir -p "$sandbox/bin" "$sandbox/pulled" "$sandbox/tmp" "$sandbox/out"
  touch "$sandbox/docker-calls.log"
  cat > "$sandbox/bin/docker" <<'EOF'
#!/usr/bin/env bash
sandbox="$(dirname "$0")/.."
echo "$*" >> "$sandbox/docker-calls.log"
pulled_file() {
  echo "$sandbox/pulled/$(echo "$1" | tr '/:' '__')"
}
case "$1" in
  info)
    if [ "${FAKE_CONTAINERD_STORE:-0}" = "1" ]; then echo "[[driver-type io.containerd.snapshotter.v1]]"
    else echo "[[Backing Filesystem extfs]]"; fi ;;
  pull)
    echo "${FAKE_PULLED_PLATFORM:-$4}" > "$(pulled_file "$5")" ;;
  image)
    cat "$(pulled_file "${*: -1}")" ;;
  save)
    shift
    platform=""
    if [ "$1" = "--platform" ]; then platform="$2"; shift 2; fi
    for image in "$@"; do
      echo "image $image platform ${platform:-$(cat "$(pulled_file "$image")")}"
    done ;;
esac
EOF
  chmod +x "$sandbox/bin/docker"
}

# Runs make-docker-package.sh. Extra environment settings come before the arguments.
make_package() {
  local version="$1" arch="$2"
  shift 2
  env PATH="$sandbox/bin:$PATH" TMPDIR="$sandbox/tmp" "$@" "$SCRIPT" "$version" "$arch" "$sandbox/out" \
    > "$sandbox/output.log" 2>&1
}

# Unzips the package into a new folder, and prints the folder
extract() {
  local folder="$sandbox/extracted"
  mkdir -p "$folder"
  unzip -q "$1" -d "$folder"
  echo "$folder"
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

same_text() {
  [ "$1" = "$2" ]
}

repo_image() {
  grep -E "^ *image: *$1:" "$REPO_ROOT/docker-compose.yml" | sed -E 's/^ *image: *//'
}

test_makes_a_package_for_a_computer() {
  set_up
  make_package 1.2.0 amd64
  check "the script ends with success" test "$?" -eq 0
  local package="$sandbox/out/chatter-1.2.0-docker-amd64.zip"
  check "the package has the release name" test -f "$package"

  local members folder
  members="$(unzip -Z1 "$package" | sort)"
  check "the package has only the chatter folder, its files, and vmalert/rules.yml" \
    same_text "$members" "$(echo "$EXPECTED_MEMBERS" | sort)"

  folder="$(extract "$package")/chatter"
  check "images.tar has the 3 images, for Intel/AMD, in one file" same_text "$(cat "$folder/images.tar")" \
    "image ghcr.io/toolpath/chatter:1.2.0 platform linux/amd64
image $(repo_image victoriametrics/victoria-metrics) platform linux/amd64
image $(repo_image victoriametrics/vmalert) platform linux/amd64"
  check "docker-compose.yml starts the exact Chatter version, so Docker uses the loaded image" \
    grep -qE "^ *image: ghcr.io/toolpath/chatter:1.2.0$" "$folder/docker-compose.yml"
  check "docker-compose.yml has no other change" same_text \
    "$(sed 's|ghcr.io/toolpath/chatter:1.2.0|ghcr.io/toolpath/chatter:latest|' "$folder/docker-compose.yml")" \
    "$(cat "$REPO_ROOT/docker-compose.yml")"
  check "vmalert/rules.yml is the repo's rules file, where docker-compose.yml mounts it" \
    cmp -s "$folder/vmalert/rules.yml" "$REPO_ROOT/vmalert/rules.yml"
  check "README.txt names the version and the processor type" grep -qF "Chatter 1.2.0 for Intel/AMD computers" "$folder/README.txt"
  check "README.txt tells how to load the images" grep -qF "docker load -i images.tar" "$folder/README.txt"
  check "README.txt tells how to start Chatter" grep -qF "docker compose up -d" "$folder/README.txt"
}

test_names_64_bit_arm_in_the_readme() {
  set_up
  make_package 1.2.0 arm64
  local folder
  folder="$(extract "$sandbox/out/chatter-1.2.0-docker-arm64.zip")/chatter"
  check "arm64: README.txt says 64-bit ARM" grep -qF "Chatter 1.2.0 for 64-bit ARM computers" "$folder/README.txt"
  check "arm64: images.tar is for 64-bit ARM" grep -qF "platform linux/arm64" "$folder/images.tar"
}

test_uses_save_platform_with_the_containerd_image_store() {
  set_up
  make_package 1.2.0 arm64 FAKE_CONTAINERD_STORE=1
  check "containerd image store: one docker save --platform for the 3 images" \
    grep -qE "^save --platform linux/arm64 ghcr.io/toolpath/chatter:1.2.0 victoriametrics/victoria-metrics:[^ ]+ victoriametrics/vmalert:[^ ]+$" \
    "$sandbox/docker-calls.log"
}

test_refuses_an_image_of_the_wrong_platform() {
  set_up
  make_package 1.2.0 amd64 FAKE_PULLED_PLATFORM=linux/arm64
  check "a pulled image of the wrong platform: the script fails" test "$?" -ne 0
  check "a pulled image of the wrong platform: it says why" grep -qF "not for linux/amd64" "$sandbox/output.log"
  check "a pulled image of the wrong platform: no package" test -z "$(ls "$sandbox/out")"
}

test_refuses_bad_versions() {
  local version
  for version in "v1.2.0" "1.2" "edge-1a2b3c" "../1.2.0"; do
    set_up
    make_package "$version" amd64
    check "refuses the version $version" test "$?" -ne 0
  done
}

test_refuses_an_unknown_processor_type() {
  set_up
  make_package 1.2.0 x86
  check "refuses an unknown processor type" test "$?" -ne 0
}

test_makes_a_package_for_a_computer
test_names_64_bit_arm_in_the_readme
test_uses_save_platform_with_the_containerd_image_store
test_refuses_an_image_of_the_wrong_platform
test_refuses_bad_versions
test_refuses_an_unknown_processor_type

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
