#!/bin/bash
# Makes the Chatter card image from the official Raspberry Pi OS Lite image.
# build.sh runs this inside a privileged Debian container, because it needs Linux loop devices and mount.
# The container sees tools/pi-image at /pi-image.
set -euo pipefail

WORK=/pi-image/.work
BASE_IMAGE="$WORK/raspios-lite.img.xz"
CARD_IMAGE="$WORK/chatter.img"
DEPLOY=/pi-image/deploy
PAYLOAD="$WORK/payload"
IN_PI=/pi-image/in-pi
ROOT=/mnt/pi
# The node user in the Chatter container. It owns the inbox, where Chatter puts update files.
CHATTER_UID=1000
# Space for Docker (about 400 MB) and its package downloads, on top of the Chatter files.
# At the first start, Raspberry Pi OS grows the partition to fill the whole card.
EXTRA_SPACE_MB=1024
# Where Raspberry Pi Imager downloads the card image from. build.sh sets it.
IMAGE_URL="${IMAGE_URL:?build.sh must set IMAGE_URL}"
# The size and checksum of the unpacked card image, for the Imager list file. measure_card_image sets them.
extract_size=""
extract_sha256=""
# The loop devices of the root and boot partitions. mount_partitions sets them, and the unmount functions use them.
root_loop=""
boot_loop=""

main() {
  install_tools
  unpack_base_image
  grow_root_partition
  trap clean_up EXIT
  mount_partitions
  copy_chatter
  run_in_pi install-docker.sh
  unmount_all
  trap - EXIT
  check_root_file_system
  measure_card_image
  compress_card_image
  write_imager_list
  give_files_to_host_user
}

install_tools() {
  apt-get update -qq
  apt-get install -y -qq parted e2fsprogs xz-utils > /dev/null
  make_loop_device_files
}

# The container gets a copy of /dev when it starts. If the kernel gives a loop device that is not in
# that copy, losetup fails. So make the files for the first 64 loop devices.
make_loop_device_files() {
  local number
  for number in $(seq 0 63); do
    [ -e "/dev/loop$number" ] || mknod "/dev/loop$number" b 7 "$number"
  done
}

unpack_base_image() {
  step "Unpacking Raspberry Pi OS Lite"
  xz --decompress --stdout "$BASE_IMAGE" > "$CARD_IMAGE"
}

grow_root_partition() {
  local payload_mb
  payload_mb="$(du -sm "$PAYLOAD" | cut -f1)"
  step "Adding $((payload_mb + EXTRA_SPACE_MB)) MB to the card image"
  truncate --size "+$((payload_mb + EXTRA_SPACE_MB))M" "$CARD_IMAGE"
  parted --script "$CARD_IMAGE" resizepart 2 100%
}

# Docker's /dev does not show new partition devices, so each partition gets its own loop device at its offset.
mount_partitions() {
  root_loop="$(partition_loop 2)"
  e2fsck -fy "$root_loop" > /dev/null || [ $? -le 1 ]
  resize2fs "$root_loop" > /dev/null
  boot_loop="$(partition_loop 1)"

  mkdir -p "$ROOT"
  mount "$root_loop" "$ROOT"
  mount "$boot_loop" "$ROOT/boot/firmware"
  local dir
  for dir in dev dev/pts proc sys; do
    mount --bind "/$dir" "$ROOT/$dir"
  done
}

# Prints a new loop device for one partition of the card image.
partition_loop() {
  local number="$1" start end
  read -r start end < <(parted --script --machine "$CARD_IMAGE" unit B print \
    | awk -F: -v n="$number" '$1 == n { print $2, $3 }' | tr -d B)
  losetup --find --show --offset "$start" --sizelimit "$((end - start + 1))" "$CARD_IMAGE"
}

copy_chatter() {
  step "Copying Chatter onto the card"
  local chatter_dir="$ROOT/opt/chatter"
  install -d "$chatter_dir/vmalert" "$chatter_dir/images"
  install -m 644 "$PAYLOAD/docker-compose.yml" "$chatter_dir/"
  install -m 644 "$PAYLOAD/rules.yml" "$chatter_dir/vmalert/"
  install -m 644 "$PAYLOAD"/images/*.tar.gz "$chatter_dir/images/"
  install -m 755 "$IN_PI/load-images.sh" "$chatter_dir/"
  install -m 644 "$IN_PI/chatter.service" "$ROOT/etc/systemd/system/"
  copy_update_helper
}

# The update helper runs as root, outside Docker. Chatter can write only into update/inbox/.
# The helper's own folders are root only, so a broken-into Chatter cannot change them.
copy_update_helper() {
  local chatter_dir="$ROOT/opt/chatter" state_dir="$ROOT/var/lib/chatter-update"
  install -m 755 "$IN_PI/update-chatter.sh" "$chatter_dir/"
  install -m 644 "$IN_PI/docker-compose.override.yml" "$chatter_dir/"
  install -m 644 "$IN_PI/chatter-update.path" "$IN_PI/chatter-update.service" "$ROOT/etc/systemd/system/"
  install -d -m 755 "$chatter_dir/update"
  install -d -o "$CHATTER_UID" -g "$CHATTER_UID" "$chatter_dir/update/inbox"
  install -d -m 700 "$chatter_dir/backups" "$state_dir"
  install -m 600 "$PAYLOAD/installed-version" "$state_dir/"
  copy_update_keys
}

# Copies the public keys that the helper uses to check the signature of an update file.
copy_update_keys() {
  local keys_dir="$ROOT/etc/chatter/update-keys" key found=no
  install -d -m 755 "$keys_dir"
  for key in "$IN_PI"/update-keys/*.pub; do
    [ -f "$key" ] || continue
    install -m 644 "$key" "$keys_dir/"
    found=yes
  done
  if [ "$found" = no ]; then
    echo "Warning: there is no public update key in in-pi/update-keys/. This card cannot install update files." >&2
  fi
}

# Runs a script from in-pi/ with the Pi's files as the root folder. QEMU emulates the Pi's 32-bit ARM chip.
run_in_pi() {
  local script="$1"
  step "Running $script on the emulated Pi"
  install -d "$ROOT/chatter-setup"
  cp "$IN_PI/$script" "$ROOT/chatter-setup/"
  prepare_for_chroot
  chroot "$ROOT" /bin/bash "/chatter-setup/$script"
  restore_after_chroot
  rm -rf "$ROOT/chatter-setup"
}

# For apt in the chroot: use the container's DNS, do not start services,
# and do not preload the Pi's memory library, which QEMU cannot load.
prepare_for_chroot() {
  if [ -e "$ROOT/etc/resolv.conf" ] || [ -L "$ROOT/etc/resolv.conf" ]; then
    mv "$ROOT/etc/resolv.conf" "$ROOT/etc/resolv.conf.chatter-original"
  fi
  cp /etc/resolv.conf "$ROOT/etc/resolv.conf"
  printf '#!/bin/sh\nexit 101\n' > "$ROOT/usr/sbin/policy-rc.d"
  chmod +x "$ROOT/usr/sbin/policy-rc.d"
  if [ -f "$ROOT/etc/ld.so.preload" ]; then
    mv "$ROOT/etc/ld.so.preload" "$ROOT/etc/ld.so.preload.chatter-original"
  fi
}

restore_after_chroot() {
  rm -f "$ROOT/etc/resolv.conf" "$ROOT/usr/sbin/policy-rc.d"
  if [ -e "$ROOT/etc/resolv.conf.chatter-original" ] || [ -L "$ROOT/etc/resolv.conf.chatter-original" ]; then
    mv "$ROOT/etc/resolv.conf.chatter-original" "$ROOT/etc/resolv.conf"
  fi
  if [ -f "$ROOT/etc/ld.so.preload.chatter-original" ]; then
    mv "$ROOT/etc/ld.so.preload.chatter-original" "$ROOT/etc/ld.so.preload"
  fi
}

# After a success: every unmount must work. Else the card image can have lost files.
unmount_all() {
  sync
  local dir
  for dir in sys proc dev/pts dev boot/firmware ""; do
    umount "$ROOT/$dir"
  done
  losetup --detach "$boot_loop"
  losetup --detach "$root_loop"
}

# After an error: unmount what is still mounted. The card image is not used.
clean_up() {
  local dir
  for dir in sys proc dev/pts dev boot/firmware ""; do
    umount "$ROOT/$dir" 2> /dev/null || true
  done
  [ -z "$boot_loop" ] || losetup --detach "$boot_loop" 2> /dev/null || true
  [ -z "$root_loop" ] || losetup --detach "$root_loop" 2> /dev/null || true
}

# A last check that the root file system has no errors. -n only reads, it changes nothing.
check_root_file_system() {
  local loop
  loop="$(partition_loop 2)"
  e2fsck -fn "$loop" > /dev/null || { losetup --detach "$loop"; echo "The root file system has errors." >&2; exit 1; }
  losetup --detach "$loop"
}

measure_card_image() {
  step "Measuring the card image"
  extract_size="$(stat --format %s "$CARD_IMAGE")"
  extract_sha256="$(sha256sum "$CARD_IMAGE" | cut -d ' ' -f 1)"
}

compress_card_image() {
  step "Compressing the card image"
  mkdir -p "$DEPLOY"
  xz --threads=0 --stdout "$CARD_IMAGE" > "$DEPLOY/chatter.img.xz"
  rm "$CARD_IMAGE"
  (cd "$DEPLOY" && sha256sum chatter.img.xz > chatter.img.xz.sha256)
}

# Raspberry Pi Imager shows its Customisation pages (user, WiFi, SSH) only for an image from a list file.
write_imager_list() {
  /pi-image/imager-list.sh "$DEPLOY/chatter.img.xz" "$extract_size" "$extract_sha256" "$IMAGE_URL" \
    "$(date --utc +%Y-%m-%d)" > "$DEPLOY/chatter-imager.json"
}

# The container runs as root. On Linux, give the files to the user who owns build.sh, so they can delete them.
give_files_to_host_user() {
  chown --recursive --reference=/pi-image/build.sh "$DEPLOY" "$WORK"
}

step() {
  echo
  echo "==> $*"
}

# The tests load this file to run single functions. Then main does not run.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
