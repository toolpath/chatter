#!/usr/bin/env bash
# Makes the Docker package of a release for one processor type: Chatter for a computer, with no download from ghcr.io.
# The release job in .github/workflows/docker.yml runs it for amd64 and arm64.
#
# Run:   tools/release/make-docker-package.sh 1.2.0 amd64 docker-packages
# Gives: docker-packages/chatter-1.2.0-docker-amd64.zip
# Needs: docker and zip.
#
# The zip has one folder, "chatter", so that Docker Compose always calls the project "chatter" and finds its data:
#   README.txt            how to install and update
#   images.tar            the 3 images for this processor type, for "docker load"
#   docker-compose.yml    the compose file, with the exact Chatter version, so Docker uses the loaded image
#   vmalert/rules.yml     the vmalert rules, where docker-compose.yml mounts them
set -euo pipefail
shopt -s inherit_errexit

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"
RULES_FILE="$REPO_ROOT/vmalert/rules.yml"
CHATTER_IMAGE_NAME="ghcr.io/toolpath/chatter"
VICTORIA_METRICS_IMAGE_NAME="victoriametrics/victoria-metrics"
VMALERT_IMAGE_NAME="victoriametrics/vmalert"
# shellcheck source-path=SCRIPTDIR source=release-images.sh
source "$REPO_ROOT/tools/release/release-images.sh"

main() {
  [ "$#" -eq 3 ] || fail "Usage: make-docker-package.sh <version, such as 1.2.0> <amd64|arm64|armv7> <output folder>"
  local version="$1" arch="$2" output_dir="$3"
  local platform chatter_image="$CHATTER_IMAGE_NAME:$version" victoria_metrics_image vmalert_image

  check_version "$version"
  platform="$(platform_of "$arch")"
  victoria_metrics_image="$(exact_image_in_compose_file "$VICTORIA_METRICS_IMAGE_NAME")"
  vmalert_image="$(exact_image_in_compose_file "$VMALERT_IMAGE_NAME")"

  # The trap and the helper functions use it, so it is global
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"' EXIT
  local package_dir="$work_dir/chatter"
  mkdir -p "$package_dir/vmalert"

  echo "Making the Docker package for Chatter $version on $arch ($platform)"
  save_images "$platform" "$chatter_image" "$victoria_metrics_image" "$vmalert_image" > "$package_dir/images.tar"
  write_compose_file "$chatter_image" "$package_dir/docker-compose.yml"
  cp "$RULES_FILE" "$package_dir/vmalert/rules.yml"
  write_readme "$version" "$(computer_kind "$arch")" > "$package_dir/README.txt"

  mkdir -p "$output_dir"
  local package
  package="$(cd "$output_dir" && pwd)/chatter-$version-docker-$arch.zip"
  rm -f "$package"
  (cd "$work_dir" && zip -q -r -X "$package" chatter)
  echo "Made $package ($(file_size "$package") bytes)"
}

fail() {
  echo "make-docker-package: $*" >&2
  exit 1
}

# The kind of computer for each processor type, in words that people know
computer_kind() {
  case "$1" in
    amd64) echo "Intel/AMD" ;;
    arm64) echo "64-bit ARM" ;;
    armv7) echo "32-bit ARM" ;;
  esac
}

write_readme() {
  local version="$1" kind="$2"
  cat << EOF
Chatter $version for $kind computers

INSTALL
Chatter runs already on this computer, from a folder with another name? Then do not install this package:
it starts a new Chatter with no machines and no users. Update the old Chatter in its own folder.

1. Install Docker Desktop (Windows or Mac) or Docker Engine (Linux).
2. Open a terminal in this "chatter" folder.
3. Load the images. This needs no internet:
     docker load -i images.tar
4. Start Chatter:
     docker compose up -d
5. Open http://localhost:3001. From another computer, use http://<this computer's IP>:3001.

UPDATE
1. Back up your data first: see "Back up" on the "Update Chatter" page of the Chatter docs.
2. Did you change docker-compose.yml or vmalert/rules.yml? Then keep a copy of them.
3. Unzip the new package to the same place, so that its "chatter" folder replaces this one.
   Chatter keeps its data in Docker volumes, not in this folder. Keep the folder name "chatter":
   Docker uses this name to find your data.
4. Make your changes again in the new files.
5. In the "chatter" folder, load the new images and start them:
     docker load -i images.tar
     docker compose up -d

STOP
     docker compose down
EOF
}

# The tests load the functions without running main
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
