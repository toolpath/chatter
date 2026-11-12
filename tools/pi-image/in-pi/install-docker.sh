#!/bin/bash
# Runs inside the Pi's files (with chroot), while customize.sh makes the card image.
# Installs Docker from Docker's Debian armhf packages (https://docs.docker.com/engine/install/debian/),
# and turns on chatter.service, so Chatter starts each time the Pi starts,
# and chatter-update.path, so the update helper runs when Chatter asks for it.
# Docker's Raspbian packages stop at Docker 28. The Debian armhf packages keep getting new versions,
# and they run on the ARMv7 chips of the Pi 2, Pi 3, and Pi Zero 2 W (not on the Pi 1 or Pi Zero W).
set -euo pipefail

apt-get update
apt-get install -y ca-certificates curl

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# shellcheck disable=SC1091 # /etc/os-release is on the Pi, not on the build computer
cat > /etc/apt/sources.list.d/docker.sources << EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
# The downloaded package files are not needed on the card.
apt-get clean

systemctl enable docker.service chatter.service chatter-update.path
