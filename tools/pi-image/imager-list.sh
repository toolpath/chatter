#!/usr/bin/env bash
# Prints chatter-imager.json: a Raspberry Pi Imager list file (a "content repository") with only Chatter in it.
#
# Imager skips its Customisation pages (user, WiFi, SSH) for an image picked with "Use custom".
# For an image from a list file, it shows them when the entry has "init_format": "cloudinit-rpi",
# as the official Raspberry Pi OS Lite entry has. Chatter's image starts from that Lite image.
# See https://www.raspberrypi.com/news/how-to-add-your-own-images-to-imager/
set -euo pipefail

USAGE="Usage: imager-list.sh <chatter.img.xz> <unpacked size in bytes> <unpacked SHA-256> <image URL> <release date YYYY-MM-DD>"

# The Device page of Imager. The tags and icons are the ones in the official Imager list.
# The Pi 1 and Pi Zero are not here: their chip is older than ARMv7, and Docker does not run on it.
DEVICES='[
      { "name": "Raspberry Pi 5", "tags": ["pi5-64bit", "pi5-32bit"], "matching_type": "exclusive",
        "description": "Raspberry Pi 5, 500 / 500+, and Compute Module 5",
        "icon": "https://downloads.raspberrypi.com/imager/icons/RPi_5.png" },
      { "name": "Raspberry Pi 4", "tags": ["pi4-64bit", "pi4-32bit"], "matching_type": "inclusive",
        "description": "Raspberry Pi 4 Model B, 400, and Compute Module 4 / 4S",
        "icon": "https://downloads.raspberrypi.com/imager/icons/RPi_4.png" },
      { "name": "Raspberry Pi 3", "tags": ["pi3-64bit", "pi3-32bit"], "matching_type": "inclusive",
        "description": "Raspberry Pi 3 Model A+ / B / B+ and Compute Module 3 / 3+",
        "icon": "https://downloads.raspberrypi.com/imager/icons/RPi_3.png" },
      { "name": "Raspberry Pi Zero 2 W", "tags": ["pi3-64bit", "pi3-32bit"], "matching_type": "inclusive",
        "description": "Raspberry Pi Zero 2 W",
        "icon": "https://downloads.raspberrypi.com/imager/icons/RPi_Zero_2_W.png" },
      { "name": "Raspberry Pi 2", "tags": ["pi2-32bit"], "matching_type": "inclusive",
        "description": "Raspberry Pi 2 Model B",
        "icon": "https://downloads.raspberrypi.com/imager/icons/RPi_2.png" }
    ]'
# The device tags that the Chatter image runs on: every 32-bit tag on the Device page.
IMAGE_DEVICES='["pi5-32bit", "pi4-32bit", "pi3-32bit", "pi2-32bit"]'

main() {
  [ "$#" -eq 5 ] || fail "$USAGE"
  local image="$1" extract_size="$2" extract_sha256="$3" image_url="$4" release_date="$5"
  check_values "$image" "$extract_size" "$extract_sha256" "$image_url" "$release_date"
  local download_size download_sha256
  download_size="$(file_size "$image")"
  download_sha256="$(file_sha256 "$image")"

  cat << EOF
{
  "imager": {
    "devices": $DEVICES
  },
  "os_list": [
    {
      "name": "Chatter (Raspberry Pi OS Lite, 32-bit)",
      "description": "Raspberry Pi OS Lite with Docker and Chatter. Shows your CNC machines on your shop network.",
      "url": "$image_url",
      "extract_size": $extract_size,
      "extract_sha256": "$extract_sha256",
      "image_download_size": $download_size,
      "image_download_sha256": "$download_sha256",
      "release_date": "$release_date",
      "init_format": "cloudinit-rpi",
      "devices": $IMAGE_DEVICES,
      "capabilities": []
    }
  ]
}
EOF
}

# The values go into the JSON as they are. A bad value would make a file that Imager cannot read.
check_values() {
  local image="$1" extract_size="$2" extract_sha256="$3" image_url="$4" release_date="$5"
  [ -f "$image" ] || fail "The image file $image is not there."
  [[ "$extract_size" =~ ^[0-9]+$ ]] || fail "The unpacked size must be a whole number of bytes, not '$extract_size'."
  [[ "$extract_sha256" =~ ^[0-9a-f]{64}$ ]] || fail "The unpacked SHA-256 must be 64 hex digits, not '$extract_sha256'."
  [[ "$image_url" =~ ^[a-z]+://[^[:space:]\"\\]+$ ]] \
    || fail "The image URL must start with a scheme such as https://, and have no space, quote mark or backslash: '$image_url'."
  [[ "$release_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "The release date must be YYYY-MM-DD, not '$release_date'."
}

file_size() {
  wc -c < "$1" | tr -d ' '
}

# macOS has shasum. The Debian container of customize.sh has only sha256sum.
file_sha256() {
  if command -v shasum > /dev/null; then
    shasum --algorithm 256 "$1"
  else
    sha256sum "$1"
  fi | cut -d ' ' -f 1
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

main "$@"
