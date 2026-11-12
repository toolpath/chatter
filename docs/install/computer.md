# Install on a computer

Chatter runs on Windows, Mac, or Linux, with Docker. It needs no internet.
For a Raspberry Pi, see [Install on a Raspberry Pi](./raspberry-pi.md).

## System requirements

| | You need |
|---|---|
| **Computer** | Windows, Mac, or Linux, with an Intel, AMD, or 64-bit ARM processor |
| **Docker** | [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows or Mac) or Docker Engine (Linux) |
| **FANUC machines** | The `amd64` package. A Mac with Apple silicon runs it with emulation. See [FANUC machines](../guide/fanuc.md). |

## Install

1. Open the newest release on the GitHub **Releases** page. Download the Docker package for your computer:

   | Your processor | Download |
   |---|---|
   | Intel or AMD (most Windows and Linux computers) | `chatter-<version>-docker-amd64.zip` |
   | 64-bit ARM, such as a Mac with Apple silicon | `chatter-<version>-docker-arm64.zip`. It cannot read FANUC machines: for FANUC, use the `amd64` package. |

   ::: info Not sure?
   The table **Which file do I need?** on the release page tells which file is for which computer.
   :::

2. Unzip it. Open a terminal in its `chatter` folder.

   ::: warning Warning:
   Keep the folder name `chatter`. Docker uses the name to find your data.
   :::

3. Load the images, then start Chatter:
   ```bash
   docker load -i images.tar
   docker compose up -d
   ```
4. Open http://localhost:3001. From another computer on your network, use `http://<this computer's IP>:3001`.
5. Do the steps in [Get started](../guide/get-started.md).

`chatter/README.txt` in the package has the same steps.

> [!WARNING]
> **Chatter runs already from a folder of this repo?** Do not install the package. It starts a new Chatter with no machines and no users.
> Update the old Chatter in its own folder: run `docker compose pull`, then `docker compose up -d`.
