# Pi card image

The files are in `tools/pi-image/`. `build.sh` makes `deploy/chatter.img.xz` and `deploy/chatter-imager.json`. Load the JSON file in Raspberry Pi Imager, flash the card, put it in a Pi, and turn the Pi on.
Chatter then starts by itself. The Pi needs no internet for this.

The image is the official [Raspberry Pi OS Lite](https://www.raspberrypi.com/software/operating-systems/) (32-bit, Debian 13 "trixie"), with these additions:
- Docker, from Docker's Debian armhf packages (Docker's Raspbian packages stop at Docker 28)
- The three Chatter containers (`linux/arm/v7`): Chatter, VictoriaMetrics, and vmalert
- `chatter.service`, which starts Chatter each time the Pi starts

Because the image starts from the official one, Raspberry Pi Imager can still set the user, password, WiFi, and SSH.

It runs on each Pi with an ARMv7 or newer chip (Pi 2, Pi 3, Pi 3A+, Pi 4, Pi 5, Pi Zero 2 W). It does not run on a Pi 1, Pi Zero, or Pi Zero W (ARMv6).

**Tested only on a Pi Zero 2 W.** It has 512 MB of memory, the smallest of these Pis.

## Build the image

You need:
- Docker 28 or newer, with buildx and the containerd image store (Docker Desktop uses it). `build.sh` uses `docker save --platform`, which needs both.
- On Linux: QEMU emulation for ARM in Docker. Docker Desktop has it.
- curl, gzip, and tar
- About 10 GB of free disk space

Then run:

```bash
tools/pi-image/build.sh
```

The steps:
1. Download Raspberry Pi OS Lite to `tools/pi-image/.work/` (one time only), and check its SHA-256 checksum.
2. Build the Chatter container for `linux/arm/v7` (a release card downloads the published Chatter container instead: see below), and download VictoriaMetrics and vmalert for `linux/arm/v7`.
3. In a privileged Debian container, run `customize.sh`. It makes the card image bigger, copies Chatter and the update helper onto it, and installs Docker with `in-pi/install-docker.sh`. QEMU emulates the Pi's chip for that install.
4. Write `tools/pi-image/deploy/chatter.img.xz` and `chatter.img.xz.sha256`. A release does not use the `.sha256` file: `chatter-imager.json` has the checksum.
5. Write `tools/pi-image/deploy/chatter-imager.json` with `imager-list.sh` (see below).

To use a newer Raspberry Pi OS, change `BASE_VERSION`, `BASE_URL`, and `BASE_SHA256` at the top of `build.sh`.

### The list file for Raspberry Pi Imager

Raspberry Pi Imager 2 skips its Customisation pages (user, WiFi, SSH) for an image picked with **Use custom**.
Without them, a Pi Zero 2 W has no WiFi and no user. Imager shows the pages only for an image from a list file (a "content repository") whose entry has `"init_format": "cloudinit-rpi"`, as the official Raspberry Pi OS Lite has.
So the build also writes `chatter-imager.json`: a list with only Chatter in it, with the size and SHA-256 checksum of the image.

To flash the card, see [Install on a Raspberry Pi](../install/raspberry-pi.md#flash-the-card).

By default, the list file points at the card image on this computer (`file://.../deploy/chatter.img.xz`). For a release, set the download link of the image:

```bash
CHATTER_VERSION=1.0.0 CHATTER_IMAGE_URL=https://github.com/toolpath/chatter/releases/download/v1.0.0/chatter.img.xz tools/pi-image/build.sh
```

### The card of a release

You do not build the card of a release by hand. For a release tag, `.github/workflows/docker.yml` adds the update file to the GitHub Release, and then runs `.github/workflows/card.yml`. That workflow builds the card and adds `chatter.img.xz` and `chatter-imager.json` to the release. A pre-release tag, such as `v1.2.0-rc1`, gets no card. To make the card again, or for an older release, run it by hand: **Actions > Pi card > Run workflow**, with the tag (for example `v1.0.0`).

The workflow sets `CHATTER_VERSION` from the tag, and `CHATTER_IMAGE_URL` to the download link of `chatter.img.xz` in the release of its own repo. It also sets `CHATTER_USE_RELEASE_IMAGE=1`. Then `build.sh` builds no Chatter container: it downloads the published `ghcr.io/toolpath/chatter:<CHATTER_VERSION>` for `linux/arm/v7`. So the card has the same Chatter as the update file of the release.

### The version and the update key

For a release, also set the version of Chatter. It goes into `/var/lib/chatter-update/installed-version` on the card, and into the Chatter container that `build.sh` builds. The update helper uses it to refuse an update file that is not newer.

```bash
CHATTER_VERSION=1.4.0 tools/pi-image/build.sh
```

A release build (with `CHATTER_IMAGE_URL` or `CHATTER_USE_RELEASE_IMAGE`) stops without `CHATTER_VERSION`. A local build without it makes a card of version `0.0.0`. That is older than every release, so the card can install any signed update file. The build stops if `CHATTER_VERSION` is not a release version such as `1.4.0`.

The update helper accepts only an update file signed with a key that it knows. Put the public key (`<keyId>.pub`, never the private key) in `in-pi/update-keys/`. `customize.sh` copies each `.pub` file to `/etc/chatter/update-keys/` on the card. Without a public key, the build shows a warning and the card refuses every update file.

### FANUC files

FANUC owns its FOCAS2 files, and we must not share them in an image. The build stops:
- if `apps/server/native` has any file other than a `README.md`, and
- if any file in the built Chatter container has "fwlib" in its name.

## What the Pi does at the first start

1. Raspberry Pi OS makes the user, WiFi, and SSH settings that you set in Raspberry Pi Imager, and grows the partition to fill the card.
2. `chatter.service` runs `update-chatter.sh recover`. If a power cut stopped an install of an update, this puts the old version back. If an earlier roll back could not put the old data back, it tries again. Until that works, the helper refuses each new check and install.
3. `chatter.service` loads the three containers from `/opt/chatter/images` into Docker, then deletes the files. This takes some minutes. If a load fails, the service tries again after 30 seconds.
4. `chatter.service` runs `docker compose up --detach` in `/opt/chatter`.

Later starts skip step 3.

When an Admin checks or installs an update file in Chatter, Chatter writes `request.json` into `/opt/chatter/update/inbox/`. `chatter-update.path` sees it and starts `chatter-update.service`, which runs `update-chatter.sh` as root. To see what the helper did: `journalctl -u chatter-update`.

## Files

All paths are in `tools/pi-image/`.

- `build.sh`: runs on your computer, and does the steps above
- `customize.sh`: runs in the privileged container, and changes the card image
- `imager-list.sh`: prints `chatter-imager.json`, the list file for Raspberry Pi Imager
- `in-pi/`: the files that go onto the Pi, and the Docker install script that runs on the emulated Pi
- `in-pi/update-chatter.sh`: the update helper. It checks and installs signed update files, and rolls back when an install fails
- `in-pi/chatter-update.path`, `in-pi/chatter-update.service`: start the update helper when Chatter writes a request
- `in-pi/docker-compose.override.yml`: gives the Chatter container the update folder (card only)
- `in-pi/update-keys/`: the public keys for update files (`<keyId>.pub`). `chatter-2026.pub` is the release key.
- `test/load-images.test.sh`: tests for `in-pi/load-images.sh`. Run it with `tools/pi-image/test/load-images.test.sh`.
- `test/imager-list.test.sh`: tests for `imager-list.sh` (needs python3). Run it with `tools/pi-image/test/imager-list.test.sh`.
- `test/update-chatter-check.test.sh`, `test/update-chatter-install.test.sh`, `test/update-chatter-recover.test.sh`: tests for `in-pi/update-chatter.sh`, with a fake Docker. They run in a Debian 13 container (`test/in-linux.sh`), because they need Linux tools and OpenSSL 3 for Ed25519 signatures. macOS does not have these. Each test makes its own throwaway keys.
- `test/update-file-round-trip.test.sh`: makes an update file with the real `tools/release/make-update-file.sh`, and checks that the real `in-pi/update-chatter.sh check` says ready, and refuses the file when one byte of an image changes. It runs in the Debian 13 container, with a fake Docker and a throwaway key.
- `test/customize-update.test.sh`: tests for the update folders, owners, and keys that `customize.sh` puts on the card. It also runs in the Debian 13 container.
- `test/build-version.test.sh`: tests for `CHATTER_VERSION`, `CHATTER_USE_RELEASE_IMAGE`, and the key warning in `build.sh`.
- `test/update-mounts.test.sh`: tests that the Chatter container can write only into the inbox (needs Docker).
