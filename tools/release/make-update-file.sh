#!/usr/bin/env bash
# Makes one signed update file for one processor type. Settings > Updates installs it on the Pi card.
# The release job in .github/workflows/docker.yml runs it only for armv7: only the Pi card has the update helper.
# The script can also make amd64 and arm64 update files, for a helper on other computers later.
#
# Run:   UPDATE_SIGNING_KEY="$(cat signing-key.pem)" tools/release/make-update-file.sh 1.2.0 armv7 update-files
# Gives: update-files/chatter-update-1.2.0-armv7.tar
#
# Needs: docker, gzip, GNU tar, sha256sum, and OpenSSL 3 (for Ed25519).
#
# Settings (environment variables):
#   UPDATE_SIGNING_KEY     the Ed25519 private key (PEM text). Required.
#   UPDATE_KEY_ID          the name of the key (default chatter-2026). The Pi finds the public key by this name.
#   UPDATE_PUBLIC_KEY_DIR  the folder with <key name>.pub (default tools/pi-image/in-pi/update-keys).
#                          The script checks the signature with this key, so a wrong secret cannot make a file
#                          that each Pi refuses.
#
# The update file is a plain tar with only these files, and no folders:
#   manifest.txt        what is in the update file (see below)
#   manifest.txt.sig    the Ed25519 signature of manifest.txt
#   chatter.tar.gz, victoria-metrics.tar.gz, vmalert.tar.gz
#                       the images for this processor type (docker save, then gzip)
#   docker-compose.yml  the compose file, with the exact version of each image
#   rules.yml           the vmalert rules
#
# manifest.txt has LF line ends and one space between fields:
#   format 1
#   version 1.2.0
#   arch armv7
#   keyId chatter-2026
#   file <name> <sha256> <size in bytes>    (one line for each file except manifest.txt and manifest.txt.sig)
#
# Later, to make the update file smaller: leave out an image that did not change, and write
# "unchanged <name> <tag> <image id>" in its place. The Pi then checks that it has that image.
# For now, each update file holds all 3 images.
set -euo pipefail
shopt -s inherit_errexit

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"
RULES_FILE="$REPO_ROOT/vmalert/rules.yml"
CHATTER_IMAGE_NAME="ghcr.io/toolpath/chatter"
VICTORIA_METRICS_IMAGE_NAME="victoriametrics/victoria-metrics"
VMALERT_IMAGE_NAME="victoriametrics/vmalert"
# 600 MiB. The same limit as UPDATE_FILE_LIMIT_BYTES in packages/shared/src/updates.ts, and in the Pi helper.
SIZE_LIMIT_BYTES=629145600
# The files that manifest.txt lists, in this order
PAYLOAD_FILES=(chatter.tar.gz victoria-metrics.tar.gz vmalert.tar.gz docker-compose.yml rules.yml)
# shellcheck source-path=SCRIPTDIR source=release-images.sh
source "$REPO_ROOT/tools/release/release-images.sh"

main() {
  [ "$#" -eq 3 ] || fail "Usage: make-update-file.sh <version, such as 1.2.0> <amd64|arm64|armv7> <output folder>"
  local version="$1" arch="$2" output_dir="$3"
  local key_id="${UPDATE_KEY_ID:-chatter-2026}"
  local public_key="${UPDATE_PUBLIC_KEY_DIR:-$REPO_ROOT/tools/pi-image/in-pi/update-keys}/$key_id.pub"
  local platform

  check_version "$version"
  check_key_id "$key_id"
  platform="$(platform_of "$arch")"
  [ -n "${UPDATE_SIGNING_KEY:-}" ] || fail "Set UPDATE_SIGNING_KEY to the private signing key."
  # Keep the key in a shell variable only, so that docker, gzip, and tar do not get it in their environment
  signing_key="$UPDATE_SIGNING_KEY"
  unset UPDATE_SIGNING_KEY
  [ -f "$public_key" ] || fail "The public key $public_key is missing. The Pi needs it to check the update file."

  # The work folder is only for this user (mktemp gives 0700). The trap deletes it, and the key file in it.
  # It is global, because the trap and the helper functions use it.
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT

  local chatter_image="$CHATTER_IMAGE_NAME:$version" victoria_metrics_image vmalert_image
  victoria_metrics_image="$(exact_image_in_compose_file "$VICTORIA_METRICS_IMAGE_NAME")"
  vmalert_image="$(exact_image_in_compose_file "$VMALERT_IMAGE_NAME")"

  echo "Making the update file for Chatter $version on $arch ($platform)"
  save_image "$chatter_image" "$platform" "$work_dir/chatter.tar.gz"
  save_image "$victoria_metrics_image" "$platform" "$work_dir/victoria-metrics.tar.gz"
  save_image "$vmalert_image" "$platform" "$work_dir/vmalert.tar.gz"
  write_compose_file "$chatter_image" "$work_dir/docker-compose.yml"
  cp "$RULES_FILE" "$work_dir/rules.yml"

  write_manifest "$version" "$arch" "$key_id" > "$work_dir/manifest.txt"
  sign_manifest "$public_key"

  mkdir -p "$output_dir"
  local update_file="$output_dir/chatter-update-$version-$arch.tar"
  make_tar "$update_file"
  check_size_limit "$update_file"
  echo "Made $update_file ($(file_size "$update_file") bytes)"
}

fail() {
  echo "make-update-file: $*" >&2
  exit 1
}

check_key_id() {
  [[ "$1" =~ ^[a-z0-9-]+$ ]] || fail "The key name may have only a-z, 0-9, and -, not: $1"
}

# The update file has each image in its own gzip file
save_image() {
  local image="$1" platform="$2" output_file="$3"
  save_images "$platform" "$image" | gzip -n > "$output_file"
}

write_manifest() {
  local version="$1" arch="$2" key_id="$3" name sha size
  printf 'format 1\n'
  printf 'version %s\n' "$version"
  printf 'arch %s\n' "$arch"
  printf 'keyId %s\n' "$key_id"
  for name in "${PAYLOAD_FILES[@]}"; do
    # On their own lines, so that set -e stops the script if a command fails
    sha="$(file_sha256 "$work_dir/$name")"
    size="$(file_size "$work_dir/$name")"
    printf 'file %s %s %s\n' "$name" "$sha" "$size"
  done
}

# Signs manifest.txt with Ed25519, then checks the signature with the public key that the Pi has.
# The private key is only in a 0600 file in the work folder, and only for this step. It is never printed.
sign_manifest() {
  local public_key="$1" key_file="$work_dir/signing-key.pem"
  (umask 077 && printf '%s\n' "$signing_key" > "$key_file")
  openssl pkeyutl -sign -inkey "$key_file" -rawin \
    -in "$work_dir/manifest.txt" -out "$work_dir/manifest.txt.sig" \
    || fail "Could not sign manifest.txt. UPDATE_SIGNING_KEY must be an Ed25519 private key."
  rm -f "$key_file"
  openssl pkeyutl -verify -pubin -inkey "$public_key" -rawin \
    -in "$work_dir/manifest.txt" -sigfile "$work_dir/manifest.txt.sig" > /dev/null \
    || fail "The signature does not match $public_key. UPDATE_SIGNING_KEY is not the key that the Pi trusts."
}

# A plain tar with flat names, no folders, and root as the owner. The manifest is first.
make_tar() {
  tar --create --file "$1" --format=ustar --owner=0 --group=0 --numeric-owner --mode=0644 \
    --directory "$work_dir" manifest.txt manifest.txt.sig "${PAYLOAD_FILES[@]}"
}

check_size_limit() {
  local size
  size="$(file_size "$1")"
  [ "$size" -le "$SIZE_LIMIT_BYTES" ] || fail "$1 is $size bytes. The Pi takes at most $SIZE_LIMIT_BYTES bytes."
}

file_sha256() {
  sha256sum "$1" | cut -d ' ' -f 1
}

# The tests load the functions without running main
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
