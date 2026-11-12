#!/usr/bin/env bash
# Loads the Chatter container images that came on the card into Docker.
# The Pi needs no internet for this. chatter.service runs it before each start.
# Each file is deleted after it loads, so later starts skip it and the card gets the space back.
set -euo pipefail

images_dir="${1:-/opt/chatter/images}"

shopt -s nullglob
for archive in "$images_dir"/*.tar.gz; do
  echo "Loading $(basename "$archive") into Docker. On a Pi, this takes some minutes."
  docker load --input "$archive"
  rm -- "$archive"
done
