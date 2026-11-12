# shellcheck shell=bash
# The functions that make-update-file.sh and make-docker-package.sh share: the release version, the processor
# types, the images in docker-compose.yml, and "docker save" for one platform.
# The script that loads this file must have a fail function, and set CHATTER_IMAGE_NAME and COMPOSE_FILE.

# Only a release version such as 1.2.0. So the version can never become a strange file name on the Pi.
check_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "The version must look like 1.2.0, not: $1"
}

# The Docker platform for each processor type of an update file
platform_of() {
  case "$1" in
    amd64) echo "linux/amd64" ;;
    arm64) echo "linux/arm64" ;;
    armv7) echo "linux/arm/v7" ;;
    *) fail "The processor type must be amd64, arm64, or armv7, not: $1" ;;
  esac
}

# Each image with this name in the repo's docker-compose.yml, one on each line, with its tag
images_in_compose_file() {
  grep -E "^ *image: *$1:" "$COMPOSE_FILE" | sed -E 's/^ *image: *//; s/ *$//' || true
}

# The image with its exact tag, as the repo's docker-compose.yml names it (for example v1.155.0)
exact_image_in_compose_file() {
  local name="$1" image
  check_named_one_time "$name"
  image="$(images_in_compose_file "$name")"
  [[ "$image" != *:latest ]] || fail "docker-compose.yml must name an exact version of $name, not latest."
  echo "$image"
}

check_named_one_time() {
  [ "$(images_in_compose_file "$1" | grep -c .)" -eq 1 ] || fail "docker-compose.yml must name $1 exactly one time."
}

# Prints a "docker save" tar of the images, for one platform only, so that "docker load" gives the exact tags.
# With the classic image store (GitHub's runners use it), a tag holds only the platform that was pulled last,
# and "docker save" saves that one. So this checks the pulled platform first.
# With the containerd image store (Docker Desktop), a tag can hold many platforms, so "docker save --platform" picks one.
save_images() {
  local platform="$1" image containerd_store=false
  shift
  uses_containerd_image_store && containerd_store=true
  for image in "$@"; do
    echo "Saving $image for $platform" >&2
    docker pull --quiet --platform "$platform" "$image" > /dev/null
    $containerd_store || check_pulled_platform "$image" "$platform"
  done
  if $containerd_store; then
    docker save --platform "$platform" "$@"
  else
    docker save "$@"
  fi
}

uses_containerd_image_store() {
  [[ "$(docker info --format '{{.DriverStatus}}')" == *io.containerd.snapshotter* ]]
}

check_pulled_platform() {
  local image="$1" platform="$2" pulled
  pulled="$(docker image inspect --format '{{.Os}}/{{.Architecture}}{{with .Variant}}/{{.}}{{end}}' "$image")"
  # 64-bit ARM images often say linux/arm64/v8. That is the same as linux/arm64.
  [ "${pulled%/v8}" = "$platform" ] || fail "Docker pulled $image for $pulled, not for $platform."
}

# The repo's compose file, with the exact Chatter version in place of :latest
write_compose_file() {
  local chatter_image="$1" output_file="$2"
  check_named_one_time "$CHATTER_IMAGE_NAME"
  sed -E "s|^( *image: *)$CHATTER_IMAGE_NAME:[^ ]*|\1$chatter_image|" "$COMPOSE_FILE" > "$output_file"
  grep -qE "^ *image: *$chatter_image *$" "$output_file" || fail "Could not put $chatter_image in docker-compose.yml."
}

file_size() {
  wc -c < "$1" | tr -d ' '
}
