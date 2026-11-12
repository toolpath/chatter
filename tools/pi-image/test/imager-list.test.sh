#!/usr/bin/env bash
# Tests for imager-list.sh, which writes chatter-imager.json for Raspberry Pi Imager.
# python3 reads the JSON, so the tests check real JSON and not only text.
# Run:  tools/pi-image/test/imager-list.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/imager-list.sh"
IMAGE_URL="https://github.com/toolpath/chatter/releases/download/v1.0.0/chatter.img.xz"
EXTRACT_SIZE=4010803200
EXTRACT_SHA256="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
RELEASE_DATE="2026-11-09"
failures=0

sandbox="$(mktemp -d)"
trap 'rm -rf "$sandbox"' EXIT
printf 'not a real image, only some bytes' > "$sandbox/chatter.img.xz"

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

# Prints one value from the list file. The argument is Python code that starts at the JSON object, named "d".
value() {
  python3 -c "import json, sys; d = json.load(open(sys.argv[1])); print($1)" "$sandbox/list.json"
}

is_json() {
  python3 -m json.tool "$1" > /dev/null
}

# The same code as in imager-list.sh, on purpose: the test computes the checksum by itself.
file_sha256() {
  if command -v shasum > /dev/null; then shasum --algorithm 256 "$1"; else sha256sum "$1"; fi | cut -d ' ' -f 1
}

test_writes_the_chatter_entry() {
  "$SCRIPT" "$sandbox/chatter.img.xz" "$EXTRACT_SIZE" "$EXTRACT_SHA256" "$IMAGE_URL" "$RELEASE_DATE" > "$sandbox/list.json"
  local status=$?

  check "succeeds" test "$status" -eq 0
  check "writes JSON that Python can read" is_json "$sandbox/list.json"
  check "has one OS in the list" test "$(value 'len(d["os_list"])')" = 1
  check "names the OS Chatter" test "$(value 'd["os_list"][0]["name"]')" = "Chatter (Raspberry Pi OS Lite, 32-bit)"
  check "points at the image URL" test "$(value 'd["os_list"][0]["url"]')" = "$IMAGE_URL"
  check "gives the size of the compressed image" \
    test "$(value 'd["os_list"][0]["image_download_size"]')" = "$(wc -c < "$sandbox/chatter.img.xz" | tr -d ' ')"
  check "gives the checksum of the compressed image" \
    test "$(value 'd["os_list"][0]["image_download_sha256"]')" = "$(file_sha256 "$sandbox/chatter.img.xz")"
  check "gives the size of the unpacked image" test "$(value 'd["os_list"][0]["extract_size"]')" = "$EXTRACT_SIZE"
  check "gives the checksum of the unpacked image" test "$(value 'd["os_list"][0]["extract_sha256"]')" = "$EXTRACT_SHA256"
  check "gives the release date" test "$(value 'd["os_list"][0]["release_date"]')" = "$RELEASE_DATE"
  check "asks Imager for the user, WiFi and SSH settings, as the official Pi OS Lite does" \
    test "$(value 'd["os_list"][0]["init_format"]')" = "cloudinit-rpi"
  check "offers the image only for Pis with an ARMv7 or newer chip" \
    test "$(value '",".join(d["os_list"][0]["devices"])')" = "pi5-32bit,pi4-32bit,pi3-32bit,pi2-32bit"
  check "lists the Pi Zero 2 W on the Device page" \
    test "$(value '"Raspberry Pi Zero 2 W" in [device["name"] for device in d["imager"]["devices"]]')" = True
  check "does not list the Pi 1 or Pi Zero on the Device page" \
    test "$(value 'any("pi1-32bit" in device["tags"] for device in d["imager"]["devices"])')" = False
}

test_stops_when_an_argument_is_missing() {
  "$SCRIPT" "$sandbox/chatter.img.xz" "$EXTRACT_SIZE" > "$sandbox/output.log" 2>&1
  local status=$?

  check "fails when an argument is missing" test "$status" -ne 0
  check "tells how to run it" grep -q "Usage:" "$sandbox/output.log"
}

test_stops_when_the_image_is_missing() {
  "$SCRIPT" "$sandbox/no-such.img.xz" "$EXTRACT_SIZE" "$EXTRACT_SHA256" "$IMAGE_URL" "$RELEASE_DATE" > "$sandbox/output.log" 2>&1
  local status=$?

  check "fails when the image file is not there" test "$status" -ne 0
}

# Runs the script with one argument changed. The arguments are: position (1 to 5), new value.
run_with() {
  local args=("$sandbox/chatter.img.xz" "$EXTRACT_SIZE" "$EXTRACT_SHA256" "$IMAGE_URL" "$RELEASE_DATE")
  args[$1 - 1]="$2"
  "$SCRIPT" "${args[@]}" > "$sandbox/output.log" 2>&1
}

# A bad value would make JSON that Imager cannot read, so the script must stop.
test_stops_on_a_bad_value() {
  local position="$1" value="$2" description="$3"
  run_with "$position" "$value"
  local status=$?
  check "fails when $description" test "$status" -ne 0
}

test_writes_the_chatter_entry
test_stops_when_an_argument_is_missing
test_stops_when_the_image_is_missing
test_stops_on_a_bad_value 2 "" "the unpacked size is empty"
test_stops_on_a_bad_value 2 "12x" "the unpacked size is not a whole number"
test_stops_on_a_bad_value 3 "abc" "the unpacked checksum is not 64 hex digits"
test_stops_on_a_bad_value 4 "" "the image URL is empty"
test_stops_on_a_bad_value 4 'https://example.com/a"b.img.xz' "the image URL has a quote mark"
test_stops_on_a_bad_value 4 'https://example.com/a\b.img.xz' "the image URL has a backslash"
test_stops_on_a_bad_value 4 "file:///my folder/chatter.img.xz" "the image URL has a space"
test_stops_on_a_bad_value 5 "9 Nov 2026" "the release date is not YYYY-MM-DD"

if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
