#!/usr/bin/env bash
# Adds files to the GitHub Release of a tag. Makes the release first, if there is none yet.
# A file that is already in the release is replaced, so the release job can run again.
# The release job in .github/workflows/docker.yml runs it with the update file and the Docker packages.
#
# Run:   GH_TOKEN=<token> tools/release/add-to-release.sh v1.2.0 update-files/*.tar
# Needs: gh (the GitHub command line tool)
set -euo pipefail

main() {
  [ "$#" -ge 2 ] || fail "Usage: add-to-release.sh <tag, such as v1.2.0> <file>..."
  local tag="$1"
  shift

  if release_exists "$tag"; then
    echo "Adding the files to the release $tag"
    gh release upload "$tag" "$@" --clobber
  else
    echo "Making the release $tag with the files"
    gh release create "$tag" "$@" --verify-tag --title "$tag" --generate-notes
  fi
}

fail() {
  echo "add-to-release: $*" >&2
  exit 1
}

release_exists() {
  gh release view "$1" > /dev/null 2>&1
}

main "$@"
