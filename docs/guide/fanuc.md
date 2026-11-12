# FANUC machines

Chatter reads FANUC machines with FOCAS2, a library that FANUC owns.
This repo and the Chatter images do not include the FOCAS2 files, because FANUC owns them and the MIT license of this repo cannot cover them. You must supply them.
Without these files, Chatter still runs, but it skips FANUC machines.

## Get the files

Get the FOCAS2 library from FANUC or from your FANUC dealer.
It comes with the FOCAS2 developer kit (FANUC Open CNC API Specifications).

## Upload the file in Chatter

An Admin uploads the file in the web app: in **Settings > FANUC library**, or when they add a FANUC machine.
The page names the file that this computer needs.
Upload only the file that you got from FANUC or your dealer, because Chatter runs the code in it.

Chatter checks that the file is a library for the operating system and the processor of this computer. It keeps the file in the data folder (with `chatter.db`), so the file stays after an update.
Chatter uses a new file at once, and starts the saved FANUC machines.
To replace or remove a file that Chatter already uses, restart Chatter after the change (with Docker, `docker compose restart`). The page tells you when a restart is necessary.

These are the files for each computer:

| Computer | File |
|----------|------|
| Linux x64 (and the `linux/amd64` Docker image) | `libfwlib32-linux-x64.so.1.0.5` |
| Linux ARM, 32-bit (32-bit Raspberry Pi OS, and the `linux/arm/v7` Docker image) | `libfwlib32-linux-armv7.so.1.0.5` |
| Windows x64 | `Fwlib64.dll` |

FANUC supplies only a 32-bit file for ARM. A 64-bit program cannot load a 32-bit library. So on 64-bit ARM (for example 64-bit Raspberry Pi OS, or the `linux/arm64` Docker image), Chatter cannot read FANUC machines.
- On a Mac with Apple silicon, use the `amd64` Docker package (see [Install on a computer](../install/computer.md)). If you use this repo's `docker-compose.yml`, remove the `#` before the line `platform: linux/amd64` of the `chatterbox` service. The Mac emulates an Intel processor, so Chatter runs slower.
- On 64-bit Raspberry Pi OS, remove the `#` before the line `platform: linux/arm/v7` in `docker-compose.yml`. Docker then downloads the 32-bit image, so the Pi needs internet. This is not tested on a real Pi yet.

macOS itself is not supported. On a Mac, run Chatter in Docker.

On Windows, the upload does not copy the control-specific DLLs (for example `fwlib0iD64.dll` and `fwlib30i64.dll`). Use the folder below.

## Or put the files in a folder (source installs)

When you run Chatter from source, you can copy the file into `apps/server/native/focas/` instead:

| Computer | Path |
|----------|------|
| Linux x64 | `apps/server/native/focas/linux-x64/libfwlib32-linux-x64.so.1.0.5` |
| Linux ARM, 32-bit | `apps/server/native/focas/linux-arm/libfwlib32-linux-armv7.so.1.0.5` |
| Windows x64 | `apps/server/native/focas/win32-x64/Fwlib64.dll` |

On Windows, also copy the control-specific DLLs from the kit into `win32-x64/`.
A file that an Admin uploads wins over a file in this folder.
A Docker image that you build yourself also copies this folder (`docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`).

## Check

**Settings > FANUC library** shows the file that Chatter uses, where it came from, and its SHA-256 fingerprint.
If there is no file when the server starts, the server log shows:
`INFO  [poller] FANUC machines skipped reason="FOCAS library not found at ..."`
