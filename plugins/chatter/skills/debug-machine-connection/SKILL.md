---
name: debug-machine-connection
description: Finds why a CNC machine in Chatter shows Offline or Connecting, or shows no program files, and tells the user how to fix it. Use when a machine does not connect, drops out, or shows no values in Chatter.
---

# Debug a machine connection

Find the **cause**, then tell the user the fix. The user makes each change on the machine control. You only look: do not change machines, settings or files in Chatter.

## Connect to Chatter

Chatter has an HTTP API that takes HTTP Basic logins (docs: https://toolpath.github.io/chatter/api/). Ask the user to set these in the terminal, so the password does not go in the chat:

```bash
export CHATTER_URL=http://<chatter address>:3001
export CHATTER_USERNAME=<a Viewer account>
read -rs CHATTER_PASSWORD && export CHATTER_PASSWORD
```

Then check the login: `curl -s -u "$CHATTER_USERNAME:$CHATTER_PASSWORD" "$CHATTER_URL/api/status"`. A `401` is a wrong login. After 10 wrong passwords, the address must wait 15 minutes (`429`), so stop after the first `401` and ask the user.

## 1. Read what Chatter says

`GET /api/status` gives each machine with `id`, `type`, `host`, `connected`, `connecting`, `lastPollTime` and `errors`. The text in `errors` is the best clue. `connecting: true` is normal for the first 30 seconds after a machine is added.

## 2. Read the log

If you can run commands on the computer that runs Chatter, read its log (docs: https://toolpath.github.io/chatter/guide/logs):

```bash
docker logs --since 24h chatterbox 2>&1 | grep "machine=<id> "
```

On the Raspberry Pi card, run `cd /opt/chatter` first, and put `sudo` before `docker`. The `reason=` on a `Machine cannot be reached` or `Machine went offline` line tells why. Many offline and online lines show a bad network or a machine that is turned off at night.

## 3. Check the network

From the computer that runs Chatter, test the data port of the machine:

```bash
timeout 3 bash -c "</dev/tcp/<host>/<port>" && echo open || echo closed
```

On Windows, in PowerShell: `Test-NetConnection <host> -Port <port>`.

| Type | Data port (the default) | What else it needs |
| --- | --- | --- |
| Brother | 10000 | A C00 or D00 control sends the run state. A B00 control does not. |
| Haas | 9998, and 5051 for queries | Setting 143 on, for the query port. Without it, Chatter gets no run state and no spindle load. |
| MTConnect | 5000 | An MTConnect agent. Open `http://<host>:<port>/probe`: it must give XML. |
| FANUC | 8193 | The FOCAS2 library, uploaded in **Settings > FANUC library**, and the `amd64` package (the `arm64` package cannot read FANUC). If the log says `FANUC machines skipped`, the library is missing. |
| Siemens | 4840 (OPC UA) | See the **Check** table in https://toolpath.github.io/chatter/guide/siemens |

A machine can use a port other than the default. The machine's port is in `/api/status` (`dataPort`, `queryPort`, `mtConnectPort`, `focasPort` or `opcuaPort`).

- **Closed:** the machine is off, the IP address is wrong, the protocol is off on the control, or a firewall or a different network is between them. Ask the user to compare the IP address on the control with `host`.
- **Open, but Chatter is offline:** the protocol, the port or the login does not match. Read `errors` and the log again.

## 4. No program files

The files use FTP, with the port, username and password in **Machine settings > FTP login** (docs: https://toolpath.github.io/chatter/guide/get-started). Test the FTP port (usually 21) as in step 3. `hasFtpPassword: false` in `/api/status` means that no password is saved.

## Done

Tell the user, in short sentences:
- The cause, and the facts that show it (the error text, the log line, the port test).
- The fix, step by step, on the control or in Chatter.
- How to check it: the machine shows **Online** on the **Machines** page within a minute.

If you cannot find the cause, give the user the version (`GET /api/health`), the machine type, the error text and the log lines, for a GitHub issue at https://github.com/toolpath/chatter/issues.
