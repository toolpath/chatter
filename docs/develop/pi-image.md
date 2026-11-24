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

You do not build the card of a release by hand. For a release tag, `.github/workflows/docker.yml` adds the update file to the GitHub Release, and then runs `.github/workflows/card.yml`. That workflow builds the card and adds `chatter.img.xz` and `chatter-imager.json` to the release. A tag with a `-`, such as `v1.2.0-rc1`, gets no card and no update file. To make the card again, or for an older release, run it by hand: **Actions > Pi card > Run workflow**, with the tag (for example `v1.0.0`). In **Use workflow from**, pick `main` or a release tag. On another branch, the run starts, but the job is skipped with no error. The job has this gate because its token can change the release.

The workflow sets `CHATTER_VERSION` from the tag, and `CHATTER_IMAGE_URL` to the download link of `chatter.img.xz` in the release of its own repo. It also sets `CHATTER_USE_RELEASE_IMAGE=1`. Then `build.sh` builds no Chatter container: it downloads the published `ghcr.io/toolpath/chatter:<CHATTER_VERSION>` for `linux/arm/v7`. So the card has the same Chatter as the update file of the release.

Push `main` first, and then the tag. The jobs of a tag first check that the tag commit is on `main`, and stop if it is not. So do not tag a commit before it is on `main`. The check stops a mistake, not an attack: see [Updates on the Pi card](../security.md#updates-on-the-pi-card).

### Test a release before it is public

To test a release on a real Pi with the normal update steps, make it a GitHub pre-release first. Make the pre-release before the tag, so that the workflows see it:

```bash
gh release create v1.7.0 --target main --prerelease --title "v1.7.0 (test)" --notes "A test build. Do not install it on a machine in production."
```

This also makes the tag. The workflows then do the same work as for a release: the signed update file, the Docker packages and the card. But the image on ghcr.io gets only the tag `1.7.0`, not `1.7` or `latest`. So the users who pull `latest` do not get the test build.

A Pi does not offer a pre-release in **Settings > Updates**, because Chatter reads only the latest public release. To test, download `chatter-update-1.7.0-armv7.tar` from the pre-release, and upload it in **Settings > Updates** on the test Pi. The Pi checks its signature and its version, as for every update.

- **When the test is good:** make the same release public. `.github/workflows/release-tags.yml` then gives the tested image the tags `1.7` and `latest`. It builds nothing.

  ```bash
  gh release edit v1.7.0 --prerelease=false --latest
  ```

- **When the test finds a problem:** fix it on `main`, and make `v1.7.1` as a new pre-release. A Pi with 1.7.0 accepts 1.7.1, because it is newer. Make public only the release that passed.

Do not use a tag with a `-` for a test, such as `v1.7.0-rc1`. It gets no signed update file, and the update helper accepts only a version such as `1.7.0`.

A signed test update is a real update: each Chatter Pi accepts it. Give the file only to the test devices.

### The version and the update key

For a release, also set the version of Chatter. It goes into `/var/lib/chatter-update/installed-version` on the card, and into the Chatter container that `build.sh` builds. The update helper uses it to refuse an update file that is not newer.

```bash
CHATTER_VERSION=1.4.0 tools/pi-image/build.sh
```

A release build (with `CHATTER_IMAGE_URL` or `CHATTER_USE_RELEASE_IMAGE`) stops without `CHATTER_VERSION`. A local build without it makes a card of version `0.0.0`. That is older than every release, so the card can install any signed update file. The build stops if `CHATTER_VERSION` is not a release version such as `1.4.0`.

The update helper accepts only an update file signed with a key that it knows. Put the public key (`<keyId>.pub`, never the private key) in `in-pi/update-keys/`. `customize.sh` copies each `.pub` file to `/etc/chatter/update-keys/` on the card. Without a public key, the build shows a warning and the card refuses every update file. An update file never changes these keys. If the private key leaks, see [If the update key leaks](./update-key-leak.md).

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

When an Admin checks or installs an update file in Chatter, Chatter writes `request.json` into `/opt/chatter/update/inbox/`. `chatter-update.path` sees it and starts `chatter-update.service`, which runs `update-chatter.sh` as root. To see what the helper did: `journalctl -u chatter-update`, or the **Update helper log** in Chatter (a new card image writes `helper.log`).

## The diagnostics of the helper

A card image with this helper adds these. An update of Chatter does not bring them to an older card, because an update file never changes the helper.

| What | How |
| --- | --- |
| Request `reboot` | **Restart the Pi** in Settings > Diagnostics writes the text `reboot` into `request.json`. The helper compares the whole text, as for `check` and `install`. It runs `systemctl --no-block reboot` only while it holds the lock (so no check or install runs), when no install is incomplete, and at most once in 15 minutes (`/var/lib/chatter-update/last-reboot`). |
| `update/helper.json` | Also lists `"capabilities":["reboot","network","log"]`. Chatter shows **Restart the Pi** only when `reboot` is there. An older helper writes only `arch`. |
| `update/network.json` | The host name (from `/etc/hostname`), the `.local` name, the global addresses (`ip -o addr`, at most 8), the gateway, and if SSH runs. `recover` writes it at each start and after each run. `chatter-facts.timer` runs `update-chatter.sh facts` each 10 minutes, because a DHCP address can change. Each value must have its pattern, or the helper leaves it out. Chatter reads it strictly too (`parseNetworkInfo`). |
| `update/helper.log` | Each line that the helper writes to the journal, with the UTC time and the command, for example `2026-11-21T10:00:00Z [request] Step: copying.` At 256 KB it becomes `helper.log.1`, so the log takes at most 512 KB. |

The tests are in `test/update-chatter-diagnostics.test.sh`.

## The steps of the update helper

The helper writes each step to the log, and to `/opt/chatter/update/status.json`. Settings > Updates shows a fixed text for each step.

A check (`update-chatter.sh check`) does these steps, in this order. Each step must pass before the next step starts.

| Step | What the helper does |
| --- | --- |
| `copying` | Moves the update file out of the inbox, and copies it into `/var/lib/chatter-update/` (root only). |
| `listing` | The file must end with the two blocks of zeros that end a tar, so a file that is cut short is refused. Then the helper lists the tar one time. Each entry must be a regular file with an allowed name. Each name comes one time only. There are 7 entries or fewer, and the manifest and its signature are small. Nothing is extracted before this. |
| `signature` | Extracts only `manifest.txt` and `manifest.txt.sig` (tar stops after them). Checks the signature. Then reads the manifest, and makes sure that the tar holds the same files as the signed manifest. Checks the version and the processor type. |
| `space` | Measures the Chatter data and the free space. |
| `files` | Extracts the other files, and compares the size and the sha256 of each file with the signed manifest. |
| `images` | Makes sure that each image that the manifest calls `unchanged` is on the Pi. |

Then the helper deletes the copy of the update file, and writes `ready`. The checked files stay in `/var/lib/chatter-update/files/`. So a ready update uses about one time the size of the update file on the card, not two times.

An install (`update-chatter.sh install`) does these steps:

| Step | What the helper does |
| --- | --- |
| `verifying` | Reads the signed manifest again (its sha256 must be the one that the check kept), and compares the size and the sha256 of each checked file with it. A changed file stops the install before Chatter stops. |
| `backing-up` | Stops Chatter, and makes a backup of the data. |
| `loading` | Loads each new image. `part` and `parts` tell which image, for example 2 of 3. |
| `starting` | Puts the new `docker-compose.yml` and rules in place, and starts the new version. |
| `health` | Waits up to 5 minutes until the new version runs correctly. |

### status.json

The helper writes `status.json` in one shape (`UpdateStatus` in `packages/shared/src/updates.ts`):

- `state`, `heartbeat` (UTC, the clock of the Pi), `freeBytes`. Also `version`, `reason`, and `freedBytes` when the helper knows them.
- While the state is `checking` or `installing`: `step`, `part` and `parts` (only while images load), and `startedAt` (UTC, when the check or the install started).

The heartbeat runs in its own process. It writes `status.json` again each 30 seconds. It reads the step from `/var/lib/chatter-update/step` (root only), so it keeps the current step.

Chatter reads `step` strictly: a step that is not in `UPDATE_STEPS` is dropped. A helper of an older card writes no `step` and no `startedAt`. Then the page counts the time from the first busy status that it saw. The report of Chatter has `serverTime`, so the page counts the age of the heartbeat with the clock of the Pi, not the clock of the browser.

An update file never changes the helper. Only a new card image brings a new helper. So a Pi with an older card shows no step names.

## Files

All paths are in `tools/pi-image/`.

- `build.sh`: runs on your computer, and does the steps above
- `customize.sh`: runs in the privileged container, and changes the card image
- `imager-list.sh`: prints `chatter-imager.json`, the list file for Raspberry Pi Imager
- `in-pi/`: the files that go onto the Pi, and the Docker install script that runs on the emulated Pi
- `in-pi/update-chatter.sh`: the update helper. It checks and installs signed update files, and rolls back when an install fails
- `in-pi/chatter-update.path`, `in-pi/chatter-update.service`: start the update helper when Chatter writes a request
- `in-pi/chatter-facts.timer`, `in-pi/chatter-facts.service`: write `network.json` again each 10 minutes
- `in-pi/docker-compose.override.yml`: gives the Chatter container the update folder (card only)
- `in-pi/update-keys/`: the public keys for update files (`<keyId>.pub`). `chatter-2026.pub` is the release key.
- `test/load-images.test.sh`: tests for `in-pi/load-images.sh`. Run it with `tools/pi-image/test/load-images.test.sh`.
- `test/imager-list.test.sh`: tests for `imager-list.sh` (needs python3). Run it with `tools/pi-image/test/imager-list.test.sh`.
- `test/update-chatter-check.test.sh`, `test/update-chatter-install.test.sh`, `test/update-chatter-recover.test.sh`: tests for `in-pi/update-chatter.sh`, with a fake Docker. They run in a Debian 13 container (`test/in-linux.sh`), because they need Linux tools and OpenSSL 3 for Ed25519 signatures. macOS does not have these. Each test makes its own throwaway keys.
- `test/update-file-round-trip.test.sh`: makes an update file with the real `tools/release/make-update-file.sh`, and checks that the real `in-pi/update-chatter.sh check` says ready, and refuses the file when one byte of an image changes. It runs in the Debian 13 container, with a fake Docker and a throwaway key.
- The CI runs the three helper tests and the round trip in the workflow `.github/workflows/pi-image-tests.yml`, when a pull request changes the helper, its tests, the release script, or `packages/shared/src/updates.ts`.
- `test/customize-update.test.sh`: tests for the update folders, owners, and keys that `customize.sh` puts on the card. It also runs in the Debian 13 container.
- `test/build-version.test.sh`: tests for `CHATTER_VERSION`, `CHATTER_USE_RELEASE_IMAGE`, and the key warning in `build.sh`.
- `test/update-mounts.test.sh`: tests that the Chatter container can write only into the inbox (needs Docker).
