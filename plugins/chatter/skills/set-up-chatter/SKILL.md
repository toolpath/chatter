---
name: set-up-chatter
description: Guides a shop through installing Chatter on a computer with Docker or on a Raspberry Pi card, then the first Admin, the machines and the user accounts. Use when the user wants to install, set up or start using Chatter, or move it to a new computer.
---

# Set up Chatter

Chatter shows the live status of the CNC machines on a shop network, in a browser. It runs on a computer with Docker, or on a Raspberry Pi card. The full steps are in the docs: https://toolpath.github.io/chatter/install/computer and https://toolpath.github.io/chatter/install/raspberry-pi. Read the page for the user's choice before you start, and follow it.

## 1. Pick where Chatter runs

Ask the user, then recommend:
- **A computer that stays on** (Windows, Mac or Linux, with Docker): the easiest when the shop has one.
- **A Raspberry Pi card**: a small box only for Chatter. Pi 2, 3, 3A+, 4, 5 or Zero 2 W, with 512 MB or more and a 16 GB card.

Also ask which machines the shop has. For **FANUC**, the shop needs the FOCAS2 library from FANUC or its dealer, and Chatter must not run on 64-bit ARM. Use the `amd64` package on a computer (also on a Mac with Apple silicon), or the Pi card, which is 32-bit (https://toolpath.github.io/chatter/guide/fanuc).

Make sure that Chatter does not run already on this computer: `docker ps` must not show `chatterbox`. A second install starts with no machines and no users. To update Chatter instead, see https://toolpath.github.io/chatter/guide/update.

## 2. Install

**On a computer:**
1. Check Docker: `docker compose version`. If it fails, the user installs Docker Desktop (Windows, Mac) or Docker Engine (Linux) first.
2. Find the processor: `uname -m` (`x86_64` is `amd64`, `arm64` or `aarch64` is `arm64`), or `$env:PROCESSOR_ARCHITECTURE` in PowerShell.
3. Download the Docker package `chatter-<version>-docker-<amd64 or arm64>.zip` of the newest release from https://github.com/toolpath/chatter/releases/latest, and unzip it.
4. In its `chatter` folder, run `docker load -i images.tar`, then `docker compose up -d`. Keep the folder name `chatter`: Docker uses it to find the data.

**On a Raspberry Pi:** the user flashes the card with Raspberry Pi Imager and `chatter-imager.json` from the newest release. Guide them through each step of the docs page, and stress these:
- Pick the OS **Chatter (Raspberry Pi OS Lite, 32-bit)**, not **Use custom**.
- Set the hostname, a user and password, the WiFi (if there is no network cable), and SSH in **Customisation**.
- The first start takes about 10 minutes.

Done when `curl -s http://<address>:3001/api/health` gives `{ status, uptime, version }`. The address is `localhost` on the same computer, or `chatter.local` (the hostname) for a Pi.

## 3. Make the first Admin at once

The user opens `http://<address>:3001` and makes the first account, which is the Admin. Until then, anyone on the network can make the Admin, so do this at once. The user types this password in the browser, not in the chat.

## 4. Add the machines

**Find machines** opens by itself on the first start, and scans the network. If the browser uses a name such as `chatter.local`, the user types the address range, for example `192.168.1`. A machine that it does not find can be added with **Add machine** (type, name, IP address).

Then, for each machine, help with what it needs:
- The FTP login, for the program files: **Machine settings > FTP login**.
- A Haas: Setting 143 on, for the run state and the spindle load.
- A FANUC: upload the library in **Settings > FANUC library**.
- A Siemens: OPC UA on the control (https://toolpath.github.io/chatter/guide/siemens).

A machine that stays **Offline**: use the `debug-machine-connection` skill.

## 5. Add the people

In **Settings > Users and roles**, the Admin adds one account for each person, with the smallest role that they need:
- **Viewer:** looks only. Also the right role for an AI agent that reads reports.
- **Operator:** also sends and deletes program files.
- **Admin:** also adds machines, users and settings, and updates Chatter.

## Done

Tell the user:
- The address to open Chatter from other computers: `http://<IP address or hostname>:3001`.
- Keep Chatter on the shop network only. Do not open it to the internet (https://toolpath.github.io/chatter/security).
- The starter alert rules are on, and the `alert-query` skill can add more.
