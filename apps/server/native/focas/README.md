# FANUC FOCAS2 library

Chatter reads FANUC machines with FOCAS2, a library that FANUC owns.
This repo does not include the FOCAS2 files, because FANUC owns them and the MIT license of this repo cannot cover them.
Without these files, Chatter still runs, but it skips FANUC machines.

An Admin can upload the file in Chatter, in **Settings > FANUC library**.
When you run Chatter from source, you can copy the file into this folder instead:

| Computer | Path |
|----------|------|
| Linux x64 | `apps/server/native/focas/linux-x64/libfwlib32-linux-x64.so.1.0.5` |
| Linux ARM, 32-bit | `apps/server/native/focas/linux-arm/libfwlib32-linux-armv7.so.1.0.5` |
| Windows x64 | `apps/server/native/focas/win32-x64/Fwlib64.dll` |

For where to get the files, which file each computer needs, and how to check them, see [docs/guide/fanuc.md](../../../../docs/guide/fanuc.md).
