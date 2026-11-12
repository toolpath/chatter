#!/usr/bin/env bash
# Builds the Chatter card image for a Raspberry Pi:
# the official 32-bit Raspberry Pi OS Lite, with Docker and the three Chatter containers added.
#
# Run:  tools/pi-image/build.sh
# Needs: Docker 28 or newer (with buildx and the containerd image store), curl, and about 10 GB of free disk space.
# The image goes to tools/pi-image/deploy/chatter.img.xz, with chatter-imager.json, the list file for Raspberry Pi Imager.
# For a release, set CHATTER_IMAGE_URL to the download link of chatter.img.xz. The list file then points there.
# A release must also set CHATTER_VERSION (for example 1.4.0): the build stops without it.
# With CHATTER_USE_RELEASE_IMAGE=1, the card gets the published image ghcr.io/toolpath/chatter:<CHATTER_VERSION>
# Without it, the build makes the image from this repo.
# A local build without it makes a card of version 0.0.0, which is older than every release,
# so that card can install any signed update file.
set -euo pipefail

# The official Raspberry Pi OS Lite (32-bit) that the card image starts from.
# To use a newer one, change these three lines. The checksum is in the .sha256 file next to the image.
BASE_VERSION="2026-10-06"
BASE_URL="https://downloads.raspberrypi.com/raspios_lite_armhf/images/raspios_lite_armhf-$BASE_VERSION/$BASE_VERSION-raspios-trixie-armhf-lite.img.xz"
BASE_SHA256="2c302771f34c67a0b7ae7aa2e0dcdd3eac660504be59193c011ba79d412e1632"

PI_PLATFORM="linux/arm/v7"
# docker-compose.yml starts this image. The card has it already, so the Pi does not download it.
CHATTER_IMAGE_NAME="ghcr.io/toolpath/chatter"
CHATTER_IMAGE="$CHATTER_IMAGE_NAME:latest"
# The version of Chatter on the card. It goes into the Chatter image and into installed-version,
# which the update helper uses to refuse an older update file. check_chatter_version sets the default.
CHATTER_VERSION="${CHATTER_VERSION:-}"
CHATTER_USE_RELEASE_IMAGE="${CHATTER_USE_RELEASE_IMAGE:-}"
RELEASE_VERSION='^[0-9]+\.[0-9]+\.[0-9]+$'

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$HERE/.work"
BASE_IMAGE="$WORK/raspios-lite.img.xz"
# Without CHATTER_IMAGE_URL, the list file points at the card image on this computer.
# A space in a URL must be %20. Only spaces are changed: a folder name with % # or ? gives a bad link.
IMAGE_URL="${CHATTER_IMAGE_URL:-file://${HERE// /%20}/deploy/chatter.img.xz}"
PAYLOAD="$WORK/payload"

main() {
  check_chatter_version
  check_tools
  warn_if_no_update_key
  check_no_fanuc_files
  remove_old_card_image
  get_base_image
  prepare_payload
  save_chatter_image
  check_saved_image_has_no_fanuc_files
  compress_chatter_image
  save_history_images
  make_card_image
}

check_tools() {
  local tool
  for tool in docker curl gzip tar; do
    command -v "$tool" > /dev/null || fail "$tool is not installed."
  done
  docker buildx version > /dev/null || fail "Docker buildx is not installed."
  docker info --format '{{.DriverStatus}}' | grep -q 'io.containerd.snapshotter' \
    || fail "Turn on the containerd image store in Docker. docker save --platform needs it."
}

# The update helper on the Pi accepts only a release version, such as 1.4.0.
# A release card must know its version: with 0.0.0 it would install an older signed update file.
check_chatter_version() {
  if [ -n "${CHATTER_IMAGE_URL:-}" ] && [ -z "$CHATTER_VERSION" ]; then
    fail "A release build (CHATTER_IMAGE_URL is set) needs CHATTER_VERSION, such as 1.4.0."
  fi
  if [ -n "$CHATTER_USE_RELEASE_IMAGE" ] && [ -z "$CHATTER_VERSION" ]; then
    fail "CHATTER_USE_RELEASE_IMAGE needs CHATTER_VERSION, such as 1.4.0: the version of the release image."
  fi
  CHATTER_VERSION="${CHATTER_VERSION:-0.0.0}"
  [[ $CHATTER_VERSION =~ $RELEASE_VERSION ]] \
    || fail "CHATTER_VERSION must be a release version, such as 1.4.0. It is \"$CHATTER_VERSION\"."
}

# Without a public key, the card cannot check the signature of an update file, so it refuses every update.
warn_if_no_update_key() {
  local key
  for key in "$HERE"/in-pi/update-keys/*.pub; do
    [ -f "$key" ] && return 0
  done
  echo "Warning: there is no public update key in in-pi/update-keys/. This card cannot install update files." >&2
}

# FANUC owns its FOCAS2 files. They must never go into an image that we give to other people.
# The Dockerfile copies apps/server/native, so that folder must hold only the README.
check_no_fanuc_files() {
  local extra_files
  extra_files="$(find "$REPO_ROOT/apps/server/native" -type f ! -name README.md)"
  [ -z "$extra_files" ] || fail "Remove these files before you build. FANUC does not let us share them:
$extra_files"
}

# If this build fails, no old image or list file stays, with a size and checksum that are not correct.
remove_old_card_image() {
  rm -rf "$HERE/deploy"
}

# Downloads Raspberry Pi OS Lite one time. Later builds use the saved file, after the checksum check.
get_base_image() {
  mkdir -p "$WORK"
  if ! base_image_is_good; then
    step "Downloading Raspberry Pi OS Lite $BASE_VERSION"
    curl --fail --location --progress-bar --output "$BASE_IMAGE" "$BASE_URL"
    base_image_is_good || fail "The Raspberry Pi OS download does not match its checksum."
  fi
}

base_image_is_good() {
  [ -f "$BASE_IMAGE" ] && [ "$(file_sha256 "$BASE_IMAGE")" = "$BASE_SHA256" ]
}

# macOS and Linux both have shasum. The sha256sum of macOS takes other options than the Linux one.
file_sha256() {
  if command -v shasum > /dev/null; then
    shasum --algorithm 256 "$1"
  else
    sha256sum "$1"
  fi | cut -d ' ' -f 1
}

prepare_payload() {
  rm -rf "$PAYLOAD"
  mkdir -p "$PAYLOAD/images"
  cp "$REPO_ROOT/docker-compose.yml" "$PAYLOAD/docker-compose.yml"
  cp "$REPO_ROOT/vmalert/rules.yml" "$PAYLOAD/rules.yml"
  echo "$CHATTER_VERSION" > "$PAYLOAD/installed-version"
}

save_chatter_image() {
  if [ -n "$CHATTER_USE_RELEASE_IMAGE" ]; then
    save_release_chatter_image
  else
    build_chatter_image
  fi
}

# The exact image of the release, so the card and the release update file have the same Chatter.
save_release_chatter_image() {
  local release_image="$CHATTER_IMAGE_NAME:$CHATTER_VERSION"
  step "Saving the release image $release_image for $PI_PLATFORM"
  docker pull --quiet --platform "$PI_PLATFORM" "$release_image"
  docker tag "$release_image" "$CHATTER_IMAGE"
  docker save --platform "$PI_PLATFORM" --output "$PAYLOAD/images/chatter.tar" "$CHATTER_IMAGE"
}

# Builds straight to a file, so the image on this computer with the same name does not change.
build_chatter_image() {
  step "Building the Chatter image for $PI_PLATFORM"
  docker buildx build \
    --platform "$PI_PLATFORM" \
    --tag "$CHATTER_IMAGE" \
    --build-arg "CHATTER_VERSION=$CHATTER_VERSION" \
    --output "type=docker,dest=$PAYLOAD/images/chatter.tar" \
    "$REPO_ROOT"
}

# A second FANUC check, on the image itself: no file in any layer may have "fwlib" in its name.
# If tar cannot read a layer, the check fails, so a new layer format cannot turn the check off.
check_saved_image_has_no_fanuc_files() {
  local layers_dir="$WORK/chatter-layers" layer file_list fanuc_files
  rm -rf "$layers_dir"
  mkdir -p "$layers_dir"
  tar -xf "$PAYLOAD/images/chatter.tar" -C "$layers_dir"
  file_list="$layers_dir.list"
  : > "$file_list"
  for layer in $(image_layers "$layers_dir/manifest.json"); do
    tar -tf "$layers_dir/$layer" >> "$file_list" || fail "Cannot read the image layer $layer for the FANUC check."
  done
  [ -s "$file_list" ] || fail "The FANUC check found no files in the Chatter image."
  fanuc_files="$(grep -i 'fwlib' "$file_list" || true)"
  rm -rf "$layers_dir" "$file_list"
  [ -z "$fanuc_files" ] || fail "The Chatter image has FANUC files. FANUC does not let us share them:
$fanuc_files"
}

# Prints the layer files that manifest.json lists, for example blobs/sha256/1a2b...
image_layers() {
  sed 's/.*"Layers":\[\([^]]*\)\].*/\1/' "$1" | tr ',' '\n' | tr -d '"'
}

compress_chatter_image() {
  gzip --force "$PAYLOAD/images/chatter.tar"
}

# VictoriaMetrics and vmalert keep the machine history. Their names and versions come from docker-compose.yml.
save_history_images() {
  local image file_name
  for image in $(history_images); do
    step "Saving $image for $PI_PLATFORM"
    docker pull --quiet --platform "$PI_PLATFORM" "$image"
    file_name="$(basename "${image%%:*}").tar.gz"
    docker save --platform "$PI_PLATFORM" "$image" | gzip > "$PAYLOAD/images/$file_name"
  done
}

history_images() {
  grep -oE 'victoriametrics/[a-z-]+:v[0-9.]+' "$REPO_ROOT/docker-compose.yml" | sort -u
}

# customize.sh needs Linux loop devices and mount, so it runs in a privileged Debian container.
make_card_image() {
  step "Making the card image"
  docker run --rm --privileged --volume "$HERE:/pi-image" --env IMAGE_URL="$IMAGE_URL" debian:trixie /pi-image/customize.sh
  step "Done. The card image is in $HERE/deploy:"
  ls -lh "$HERE/deploy"
}

step() {
  echo
  echo "==> $*"
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

# The tests load this file to run single functions. Then main does not run.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
