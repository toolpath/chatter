#!/usr/bin/env bash
# The round trip: an update file made by the real release script (tools/release/make-update-file.sh)
# must pass the real update helper's check (in-pi/update-chatter.sh). The two were built apart from the same spec,
# and each has its own tests with fake update files. This test joins them.
# It runs in a Debian 13 container (see in-linux.sh), with a fake docker on each side and a throwaway key.
# Run:  tools/pi-image/test/update-file-round-trip.test.sh
set -uo pipefail
if [ "${IN_TEST_CONTAINER:-}" != 1 ]; then exec "$(dirname "$0")/in-linux.sh" "$0"; fi
# shellcheck source-path=SCRIPTDIR source=update-chatter.lib.sh
source "$(dirname "$0")/update-chatter.lib.sh"

# in-linux.sh mounts the whole repo here (read only): the release script finds the compose file and the
# vmalert rules from its own place in the repo.
RELEASE_SCRIPT=/repo/tools/release/make-update-file.sh
RELEASE_KEY_ID="test-key"
RELEASE_VERSION="9.9.9"
RELEASE_ARCH="armv7"

# A fake docker for the release script. "docker save" writes what the helper's fake "docker load" reads:
# "<tag> <image id>". It uses the classic image store, and each pull gives the platform that was asked for.
write_release_fake_docker() {
  cat > "$1" << 'EOF'
#!/usr/bin/env bash
pulled_dir="$(dirname "$0")/pulled"
image="${*: -1}"
pulled_file="$pulled_dir/$(echo "$image" | tr '/:' '__')"
case "$1" in
  info) echo "[[Backing Filesystem extfs]]" ;;
  pull) mkdir -p "$pulled_dir" && echo "$4" > "$pulled_file" ;;
  image) cat "$pulled_file" ;;
  save) echo "$image sha256:$(printf '%s' "$image" | sha256sum | cut -c 1-64)" ;;
  *) echo "release fake docker: unknown command $1" >&2; exit 1 ;;
esac
EOF
  chmod +x "$1"
}

# Makes the update file with the real release script, signed with a new throwaway key, and returns its exit code.
# Sets $release_dir and $update_file. The public key goes where the helper looks for it.
make_release_update_file() {
  release_dir="$sandbox/release"
  update_file="$release_dir/out/chatter-update-$RELEASE_VERSION-$RELEASE_ARCH.tar"
  mkdir -p "$release_dir/bin" "$release_dir/keys" "$release_dir/tmp" "$release_dir/out"
  write_release_fake_docker "$release_dir/bin/docker"
  openssl genpkey -algorithm ed25519 -out "$release_dir/$RELEASE_KEY_ID.pem" 2> /dev/null
  openssl pkey -in "$release_dir/$RELEASE_KEY_ID.pem" -pubout -out "$release_dir/keys/$RELEASE_KEY_ID.pub"
  # Only the release key: the helper sandbox's own key ($KEY_ID) must not be what makes the check pass
  rm -f "$root/etc/chatter/update-keys/"*.pub
  cp "$release_dir/keys/$RELEASE_KEY_ID.pub" "$root/etc/chatter/update-keys/"
  env PATH="$release_dir/bin:$PATH" TMPDIR="$release_dir/tmp" UPDATE_KEY_ID="$RELEASE_KEY_ID" \
    UPDATE_PUBLIC_KEY_DIR="$release_dir/keys" UPDATE_SIGNING_KEY="$(cat "$release_dir/$RELEASE_KEY_ID.pem")" \
    "$RELEASE_SCRIPT" "$RELEASE_VERSION" "$RELEASE_ARCH" "$release_dir/out" > "$release_dir/output.log" 2>&1
}

# A Pi on version 1.0.0 with the 32-bit ARM processor type (the fake dpkg says armhf)
set_up_pi() {
  set_up
  echo "1.0.0" > "$state_dir/installed-version"
}

put_in_inbox() {
  cp "$1" "$inbox/chatter-update.tar"
  chown 1000:1000 "$inbox/chatter-update.tar"
}

# The sha256 of a member of the update file, and the sha256 that its manifest.txt signs for it
member_sha256() {
  tar --extract --to-stdout --file "$update_file" "$1" | sha256sum | cut -d ' ' -f 1
}

signed_member_sha256() {
  tar --extract --to-stdout --file "$update_file" manifest.txt | sed -n "s/^file $1 \\([0-9a-f]*\\) .*/\\1/p"
}

member_differs_from_manifest() {
  local signed
  signed="$(signed_member_sha256 "$1")"
  [ -n "$signed" ] && [ "$(member_sha256 "$1")" != "$signed" ]
}

# Changes one byte in the data of a member of a tar: the first byte after its 512-byte header.
# The update file is a plain (not compressed) tar, and GNU tar's --block-number counts 512-byte blocks.
flip_first_byte_of_member() {
  local tar_file="$1" member="$2" block offset byte
  block="$(tar --list --block-number --file "$tar_file" | sed -n "s/^block \([0-9]*\): $member$/\1/p")"
  offset=$(((block + 1) * 512))
  byte="$(od --address-radix=n --format=u1 --skip-bytes="$offset" --read-bytes=1 "$tar_file" | tr -d ' ')"
  # shellcheck disable=SC2059 # the format is the octal escape of the new byte
  printf "\\$(printf '%03o' $((byte ^ 0xff)))" |
    dd of="$tar_file" bs=1 seek="$offset" conv=notrunc status=none
}

test_the_helper_accepts_an_update_file_from_the_release_script() {
  set_up_pi
  make_release_update_file
  local status=$?
  check "the release script succeeds" test "$status" -eq 0
  check "the release script makes chatter-update-$RELEASE_VERSION-$RELEASE_ARCH.tar" test -f "$update_file"

  put_in_inbox "$update_file"
  send_request check

  check "the helper says ready" status_is ready
  check "the status has the release version" test "$(status_field version)" = "$RELEASE_VERSION"
  check "the helper checked the signature with the release key" grep -qF "key $RELEASE_KEY_ID" "$sandbox/helper.log"
}

test_the_helper_refuses_a_changed_image_in_a_release_update_file() {
  set_up_pi
  make_release_update_file
  check "the release script makes the update file" test -f "$update_file"
  flip_first_byte_of_member "$update_file" chatter.tar.gz
  check "chatter.tar.gz no longer has its signed checksum" member_differs_from_manifest chatter.tar.gz

  put_in_inbox "$update_file"
  send_request check

  check "a changed byte: refused" status_is refused
  check "a changed byte: the reason is the size or checksum" reason_has "checksum"
}

test_the_helper_accepts_an_update_file_from_the_release_script
test_the_helper_refuses_a_changed_image_in_a_release_update_file
finish_tests
