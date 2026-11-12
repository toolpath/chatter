#!/usr/bin/env bash
# Tests for make-update-file.sh and add-to-release.sh.
# A fake "docker" and a fake "gh" record each call, so the tests need no Docker and no GitHub.
# Each run makes a new throwaway signing key. Never commit a private key.
#
# Needs OpenSSL 3, GNU tar, and sha256sum (a Linux computer, or GitHub's runner).
# Run:  tools/release/test/make-update-file.test.sh
# On a Mac (its openssl cannot sign with Ed25519), run it in Docker:
#   docker run --rm -v "$PWD:/repo" -w /repo debian:trixie-slim bash -c \
#     'apt-get update -qq && apt-get install -y -qq openssl > /dev/null && tools/release/test/make-update-file.test.sh'
set -uo pipefail

RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$RELEASE_DIR/../.." && pwd)"
SCRIPT="$RELEASE_DIR/make-update-file.sh"
ADD_TO_RELEASE="$RELEASE_DIR/add-to-release.sh"
EXPECTED_MEMBERS="manifest.txt
manifest.txt.sig
chatter.tar.gz
victoria-metrics.tar.gz
vmalert.tar.gz
docker-compose.yml
rules.yml"
failures=0

sandboxes=()
trap 'rm -rf "${sandboxes[@]}"' EXIT

# Makes a temporary folder with a fake docker, a fake gh, a throwaway key pair, and a temp folder.
# The fake docker remembers the platform of each pull. "docker save" writes the image and its platform as text.
# FAKE_CONTAINERD_STORE=1 makes "docker info" say the containerd image store.
# FAKE_PULLED_PLATFORM makes each pull give this platform, not the one asked for.
set_up() {
  sandbox="$(mktemp -d)"
  sandboxes+=("$sandbox")
  mkdir -p "$sandbox/bin" "$sandbox/pulled" "$sandbox/keys" "$sandbox/tmp" "$sandbox/out"
  touch "$sandbox/docker-calls.log" "$sandbox/gh-calls.log"
  write_fake_docker
  write_fake_gh
  openssl genpkey -algorithm ed25519 -out "$sandbox/signing-key.pem" 2> /dev/null
  openssl pkey -in "$sandbox/signing-key.pem" -pubout -out "$sandbox/keys/chatter-2026.pub"
}

write_fake_docker() {
  cat > "$sandbox/bin/docker" <<'EOF'
#!/usr/bin/env bash
sandbox="$(dirname "$0")/.."
echo "$*" >> "$sandbox/docker-calls.log"
[ -z "${UPDATE_SIGNING_KEY:-}" ] || echo "docker $1" >> "$sandbox/key-leaks.log"
image="${*: -1}"
pulled_file="$sandbox/pulled/$(echo "$image" | tr '/:' '__')"
case "$1" in
  info)
    if [ "${FAKE_CONTAINERD_STORE:-0}" = "1" ]; then echo "[[driver-type io.containerd.snapshotter.v1]]"
    else echo "[[Backing Filesystem extfs]]"; fi ;;
  pull)
    echo "${FAKE_PULLED_PLATFORM:-$4}" > "$pulled_file" ;;
  image)
    platform="$(cat "$pulled_file")"
    # As real Docker, a 64-bit ARM image says its variant v8
    [ "$platform" != "linux/arm64" ] || platform="linux/arm64/v8"
    echo "$platform" ;;
  save)
    if [ "$2" = "--platform" ]; then platform="$3"; else platform="$(cat "$pulled_file")"; fi
    echo "image $image platform $platform" ;;
esac
EOF
  chmod +x "$sandbox/bin/docker"
}

# The fake gh has a release only when FAKE_RELEASE_EXISTS=1
write_fake_gh() {
  cat > "$sandbox/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$(dirname "$0")/../gh-calls.log"
[ "$1 $2" != "release view" ] || [ "${FAKE_RELEASE_EXISTS:-0}" = "1" ]
EOF
  chmod +x "$sandbox/bin/gh"
}

# Runs make-update-file.sh with the throwaway key. Extra environment settings come before the arguments.
run_script() {
  env PATH="$sandbox/bin:$PATH" TMPDIR="$sandbox/tmp" UPDATE_PUBLIC_KEY_DIR="$sandbox/keys" \
    UPDATE_SIGNING_KEY="$(cat "$sandbox/signing-key.pem")" "$@" > "$sandbox/output.log" 2>&1
}

make_update_file() {
  local version="$1" arch="$2"
  shift 2
  run_script "$@" "$SCRIPT" "$version" "$arch" "$sandbox/out"
}

# Extracts the update file into a new folder, and prints the folder
extract() {
  local folder="$sandbox/extracted"
  mkdir -p "$folder"
  tar --extract --file "$1" --directory "$folder"
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

has_line() {
  grep -qxF "$2" "$1"
}

# Each file line in the manifest has the real hash and size of that file
manifest_matches_files() {
  local folder="$1" kind name sha size
  while read -r kind name sha size; do
    [ "$kind" = "file" ] || continue
    [ "$sha" = "$(sha256sum "$folder/$name" | cut -d ' ' -f 1)" ] || return 1
    [ "$size" = "$(wc -c < "$folder/$name" | tr -d ' ')" ] || return 1
  done < "$folder/manifest.txt"
}

signature_verifies() {
  openssl pkeyutl -verify -pubin -inkey "$sandbox/keys/chatter-2026.pub" -rawin \
    -in "$1/manifest.txt" -sigfile "$1/manifest.txt.sig" > /dev/null 2>&1
}

only_regular_files_in_tar() {
  ! tar --list --verbose --file "$1" | grep -q -v '^-'
}

saved_image() {
  gzip --decompress --stdout "$1"
}

repo_image() {
  grep -E "^ *image: *$1:" "$REPO_ROOT/docker-compose.yml" | sed -E 's/^ *image: *//'
}

test_makes_a_signed_update_file() {
  set_up
  make_update_file 1.2.0 armv7
  local status=$? update_file="$sandbox/out/chatter-update-1.2.0-armv7.tar" folder
  folder="$(extract "$update_file")"

  check "succeeds" test "$status" -eq 0
  check "names the update file chatter-update-<version>-<arch>.tar" test -f "$update_file"
  check "holds only the 7 files, in order, with flat names" \
    same_text "$(tar --list --file "$update_file")" "$EXPECTED_MEMBERS"
  check "holds no folders and no links" only_regular_files_in_tar "$update_file"
  check "the manifest starts with format, version, arch, and keyId" \
    same_text "$(head -n 4 "$folder/manifest.txt")" "format 1
version 1.2.0
arch armv7
keyId chatter-2026"
  check "the manifest lists each file except itself and its signature" \
    same_text "$(tail -n +5 "$folder/manifest.txt" | cut -d ' ' -f 1,2)" "file chatter.tar.gz
file victoria-metrics.tar.gz
file vmalert.tar.gz
file docker-compose.yml
file rules.yml"
  check "the manifest has LF line ends" test -z "$(tr -d -c '\r' < "$folder/manifest.txt")"
  check "each hash and size in the manifest is right" manifest_matches_files "$folder"
  check "the signature verifies with the public key" signature_verifies "$folder"
  check "the Chatter image is the release version for 32-bit ARM" \
    same_text "$(saved_image "$folder/chatter.tar.gz")" "image ghcr.io/toolpath/chatter:1.2.0 platform linux/arm/v7"
  check "the VictoriaMetrics image is the tag from the repo's compose file" \
    same_text "$(saved_image "$folder/victoria-metrics.tar.gz")" \
    "image $(repo_image victoriametrics/victoria-metrics) platform linux/arm/v7"
  check "the vmalert image is the tag from the repo's compose file" \
    same_text "$(saved_image "$folder/vmalert.tar.gz")" "image $(repo_image victoriametrics/vmalert) platform linux/arm/v7"
  check "the compose file names the exact Chatter version" \
    grep -qE '^ *image: ghcr.io/toolpath/chatter:1.2.0$' "$folder/docker-compose.yml"
  check "the compose file no longer names latest" test -z "$(grep ':latest' "$folder/docker-compose.yml")"
  check "the compose file is the repo's file in all other lines" \
    same_text "$(diff "$REPO_ROOT/docker-compose.yml" "$folder/docker-compose.yml" | grep -c '^[<>]')" "2"
  check "rules.yml is the repo's vmalert rules" cmp -s "$REPO_ROOT/vmalert/rules.yml" "$folder/rules.yml"
  check "deletes the private key file and the work folder" test -z "$(ls -A "$sandbox/tmp")"
  check "never prints the private key" test -z "$(grep 'PRIVATE KEY' "$sandbox/output.log")"
  check "does not give the private key to docker in its environment" test ! -e "$sandbox/key-leaks.log"
}

test_saves_the_platform_of_each_processor_type() {
  set_up
  local arch folder expected=(amd64 linux/amd64 arm64 linux/arm64 armv7 linux/arm/v7) i
  for ((i = 0; i < ${#expected[@]}; i += 2)); do
    arch="${expected[i]}"
    make_update_file 1.2.0 "$arch"
    rm -rf "$sandbox/extracted"
    folder="$(extract "$sandbox/out/chatter-update-1.2.0-$arch.tar")"
    check "pulls and saves $arch as ${expected[i + 1]}" \
      same_text "$(saved_image "$folder/chatter.tar.gz")" "image ghcr.io/toolpath/chatter:1.2.0 platform ${expected[i + 1]}"
    check "writes arch $arch in the manifest" has_line "$folder/manifest.txt" "arch $arch"
  done
}

test_uses_save_platform_with_the_containerd_image_store() {
  set_up
  make_update_file 1.2.0 arm64 FAKE_CONTAINERD_STORE=1
  local status=$?

  check "succeeds with the containerd image store" test "$status" -eq 0
  check "asks docker save for one platform" \
    grep -qxF "save --platform linux/arm64 ghcr.io/toolpath/chatter:1.2.0" "$sandbox/docker-calls.log"
}

test_refuses_an_image_of_the_wrong_platform() {
  set_up
  make_update_file 1.2.0 armv7 FAKE_PULLED_PLATFORM=linux/amd64
  local status=$?

  check "fails when Docker pulled another platform" test "$status" -ne 0
  check "says which platform Docker pulled" grep -q "for linux/amd64, not for linux/arm/v7" "$sandbox/output.log"
  check "makes no update file" test -z "$(ls -A "$sandbox/out")"
}

test_refuses_bad_versions() {
  set_up
  local version
  for version in 1.2 v1.2.0 1.2.0-rc1 ../1.2.0 "1.2.0 " edge-abc1234; do
    make_update_file "$version" armv7
    check "refuses the version '$version'" test "$?" -ne 0
  done
  check "calls Docker for none of them" test ! -s "$sandbox/docker-calls.log"
}

test_refuses_bad_key_names() {
  set_up
  local key_id
  for key_id in Chatter-2026 chatter_2026 ../chatter "chatter 2026"; do
    make_update_file 1.2.0 armv7 UPDATE_KEY_ID="$key_id"
    check "refuses the key name '$key_id'" test "$?" -ne 0
  done
}

test_uses_the_key_name_setting() {
  set_up
  cp "$sandbox/keys/chatter-2026.pub" "$sandbox/keys/chatter-2027.pub"
  make_update_file 1.2.0 armv7 UPDATE_KEY_ID=chatter-2027
  local folder
  folder="$(extract "$sandbox/out/chatter-update-1.2.0-armv7.tar")"

  check "writes the key name from UPDATE_KEY_ID in the manifest" has_line "$folder/manifest.txt" "keyId chatter-2027"
}

test_refuses_an_unknown_processor_type() {
  set_up
  make_update_file 1.2.0 armhf
  check "refuses the processor type armhf" test "$?" -ne 0
}

test_refuses_to_run_without_a_key() {
  set_up
  make_update_file 1.2.0 armv7 UPDATE_SIGNING_KEY=
  check "fails without UPDATE_SIGNING_KEY" test "$?" -ne 0
}

test_refuses_a_key_that_the_pi_does_not_trust() {
  set_up
  openssl genpkey -algorithm ed25519 -out "$sandbox/other-key.pem" 2> /dev/null
  openssl pkey -in "$sandbox/other-key.pem" -pubout -out "$sandbox/keys/chatter-2026.pub"
  make_update_file 1.2.0 armv7
  local status=$?

  check "fails when the signing key does not match the Pi's public key" test "$status" -ne 0
  check "makes no update file" test -z "$(ls -A "$sandbox/out")"
  check "deletes the private key file after a failure too" test -z "$(ls -A "$sandbox/tmp")"
}

test_refuses_a_file_above_the_size_limit() {
  set_up
  truncate -s 629145600 "$sandbox/at-limit.tar"
  truncate -s 629145601 "$sandbox/above-limit.tar"
  # The inner bash loads the script's functions without running it. $1 and $2 are its own arguments.
  # shellcheck disable=SC2016
  check "takes a file of exactly 600 MiB" bash -c 'source "$1" && check_size_limit "$2"' _ "$SCRIPT" "$sandbox/at-limit.tar"
  # shellcheck disable=SC2016
  check "refuses a file of 1 byte more" \
    bash -c '! (source "$1" && check_size_limit "$2") 2> /dev/null' _ "$SCRIPT" "$sandbox/above-limit.tar"
}

test_makes_the_release_when_there_is_none() {
  set_up
  PATH="$sandbox/bin:$PATH" "$ADD_TO_RELEASE" v1.2.0 a.tar b.tar > /dev/null
  check "makes the release with the files" \
    grep -qxF "release create v1.2.0 a.tar b.tar --verify-tag --title v1.2.0 --generate-notes" "$sandbox/gh-calls.log"
}

test_adds_to_the_release_when_there_is_one() {
  set_up
  FAKE_RELEASE_EXISTS=1 PATH="$sandbox/bin:$PATH" "$ADD_TO_RELEASE" v1.2.0 a.tar > /dev/null
  check "adds the files to the release, and replaces old copies" \
    grep -qxF "release upload v1.2.0 a.tar --clobber" "$sandbox/gh-calls.log"
  check "does not make a second release" test -z "$(grep 'release create' "$sandbox/gh-calls.log")"
}

if ! openssl genpkey -algorithm ed25519 > /dev/null 2>&1; then
  echo "This openssl cannot make Ed25519 keys. Use OpenSSL 3 (see the top of this file)."
  exit 1
fi

test_makes_a_signed_update_file
test_saves_the_platform_of_each_processor_type
test_uses_save_platform_with_the_containerd_image_store
test_refuses_an_image_of_the_wrong_platform
test_refuses_bad_versions
test_refuses_bad_key_names
test_uses_the_key_name_setting
test_refuses_an_unknown_processor_type
test_refuses_to_run_without_a_key
test_refuses_a_key_that_the_pi_does_not_trust
test_refuses_a_file_above_the_size_limit
test_makes_the_release_when_there_is_none
test_adds_to_the_release_when_there_is_one

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
