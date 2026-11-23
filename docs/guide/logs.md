# Server logs

The Chatter server writes a log: when it starts, when a machine connects, goes offline or comes back, and when something fails.
Read it when a machine does not show up, or before you ask for help.

## Read the log

Chatter runs in Docker, so Docker keeps the log:

```sh
docker logs chatterbox               # the whole log
docker logs --since 1h chatterbox    # the last hour
docker logs -f chatterbox            # follow it: new lines come as they are written
```

With no command line, an Admin can download the log and see it live in **Settings > Diagnostics** (see [Diagnostics](./diagnostics.md#server-log)).

On the Pi card, first run `cd /opt/chatter`, and put `sudo` before `docker` (see [Chatter on the Pi](../install/raspberry-pi.md#chatter-on-the-pi)).
The update helper of the Pi writes its own log: `sudo journalctl -u chatter-update`. With a new card image, it also writes `/opt/chatter/update/helper.log`, which **Settings > Diagnostics** shows.

When you run Chatter from source (`npm run dev`), the log is in the terminal.

## What a line says

Each line has the time (UTC), the level, the part of Chatter that wrote it, the message, and the details:

```
2026-11-12T10:00:00.000Z WARN  [machines] Machine went offline machine=siemens_1 name="DNM 6700" type=siemens host=192.168.1.60 reason="Unable to connect: BadUserAccessDenied"
2026-11-12T13:05:00.000Z INFO  [machines] Machine is online again machine=siemens_1 name="DNM 6700" type=siemens host=192.168.1.60 offlineFor="3h 5m"
```

Chatter polls each machine every few seconds, but the log has a line only when something changes:

| Message | When |
|---------|------|
| `Machine connected` | The first poll after Chatter starts, or after the machine is added, works |
| `Machine cannot be reached` | The first poll fails. `reason` tells why |
| `Machine went offline` | A machine that answered stops answering |
| `Machine is still offline, for another reason` | The reason changes while the machine is offline |
| `Machine is online again` | The machine answers again. `offlineFor` tells how long it did not |
| `Machine reports a problem` | The machine answers, but something is wrong, for example a Siemens control that sends no alarms |
| `Machine problem is gone` | The machine answers with no problem again |

A machine that is off for a weekend gives two lines, not one for each poll.

### A slow Brother

Each poll of a machine must end in 10 seconds. A Brother answers each request in turn, so a busy Brother can come near this limit.

- When a poll of a Brother uses more than 6 seconds, the log has a warning: `[poll-times] A poll used most of its time limit`. `slowest` names the slowest requests. You get this warning at most one time in 10 minutes for each machine.
- With `LOG_LEVEL=debug`, the `Poll times` line of each poll shows the time of each request.
- A poll of a Brother does not read the tool table. Chatter reads the tool table in a separate step, with a limit of 20 seconds (see [The tool table of a Brother](get-started.md#the-tool-table-of-a-brother)). During this step, the polls show the last values, and the machine stays online.
- Every 60 seconds, Chatter closes the connection to a Brother and opens it again. This gives the control a new session. During this step, the machine stays online on each screen, and the log has no `info` or `warn` line for it. With `LOG_LEVEL=debug`, the log has a `Planned reconnect` line. If the new connection fails, the machine shows offline with the reason, as after other connection problems.

## Audit log

The audit log tells who changed what, and each try to log in. Chatter writes it in a separate file, so busy machines cannot push old lines out of it.

- **Where:** `logs/audit.log` in the data volume, next to `chatter.db`. With Docker, the volume is `chatter_chatterbox-data`.
- **How long Chatter keeps it:** at most 2 files of 5 MB (`audit.log` and the old file `audit.log.1`). When `audit.log` is full, it becomes `audit.log.1`, and Chatter deletes the old `audit.log.1`. The two files keep about 50,000 lines. In a small shop, this is many months. But a logged-in user who sends many requests can push old lines out in some minutes (see [Security](../security.md#audit)).
- **Who can read it:** only an Admin. The [support bundle](./diagnostics.md#support-bundle) in **Settings > Diagnostics** has the two files. A Viewer and an Operator cannot read the server log, the login log, or the audit log. The connection health of a machine is machine status, not a log. Each logged-in user can read it.
- **Format:** always text, as in the example below. `LOG_FORMAT=json` does not change the audit file, so a log collector that reads JSON cannot read it.

The audit log has a line for each of these:

| Message | When |
|---------|------|
| `Change` | A logged-in user sends a request that can change something: each method except `GET`. For example, an upload, a delete, a new machine, or a new setting. The line is there also when Chatter refuses the request. |
| `Password try` | Each try to log in or to change a password. For tries with unknown usernames, see the next two lines. |
| `More password tries with unknown usernames from this address are not logged one by one` | One address sent more than 20 tries with unknown usernames in 15 minutes. The audit log and the server log write only the first 20. |
| `Password tries with unknown usernames that had no line` | The 15 minutes of that address ended. The line has the count of the tries that had no line, so the log counts each try. The next password try writes this line. If Chatter stops before, the count is lost. |
| `Logged out` | A user logged out |
| `Logged out the other browsers` | A user logged out each other browser of the account |
| `First-run setup made a new Admin` | The first visitor made the Admin account |
| `First-run setup refused` | A person tried the setup when an Admin existed. The line has the address only. |
| `reset-password made a new Admin` | A person ran `npm run reset-password` on the server |
| `Chatter started` | Chatter started. A gap in the lines before it is the time when Chatter did not run. |

A `Change` line has the user, the role, the method, the route, the status of the reply, the address of the computer, and the IDs in the route. The line of a program delete also has the file name:

```
2026-11-23T10:00:00.000Z INFO  [audit] Change user=sam role=operator method=DELETE route=/api/machine/:id/files status=200 address=192.168.1.20 id=brother_1 file=O1000.NC
2026-11-23T10:02:00.000Z INFO  [audit] Password try username=bob address=192.168.1.66 result=no-such-user
```

- The route is the pattern, for example `/api/machine/:id/files`, and the IDs come after it.
- The line of a program delete has the name of the file after the IDs (`file=`), without the folder. Chatter adds the name before it deletes the file, so the line of a failed delete has it too. A send has no file name in its line: the upload history of the machine tells who sent each file.
- A person can type any text in the place of an ID or a file name. So Chatter cuts each ID and each file name to 64 characters, and puts `…` at the end. A long username in a `Password try` line is cut the same way. A value with a space, a quote or `=` gets quotes, so it stays one value.
- The line never has a value from the body of the request, a password, a token, or a cookie. From the query, it has only the file name of a delete. Chatter hides secrets as in the server log.
- A request that failed with an unexpected error has the status `500`. Other errors keep their status, for example `413` for a body that is too large.
- A request with no login does not get a `Change` line. Chatter refuses it before it can change something.
- The server log also gets each `Change` line.
- `LOG_LEVEL` does not change the audit log. `LOG_FILE=off` turns off the audit file too. Then the `Change` lines are only in the server log.

## Change the level or the format

Set these in the `environment:` of the `chatterbox` service in `docker-compose.yml`, then run `docker compose up -d`:

| Setting | Values |
|---------|--------|
| `LOG_LEVEL` | `info` (the default), `debug` for more detail (for example each Haas alarm, and the stack of each error), `warn` or `error` for less |
| `LOG_FORMAT` | `text` (the default), or `json` for one JSON object on each line, for a log collector such as Loki or Elasticsearch |

## Size

`docker-compose.yml` limits the log of each container to 3 files of 10 MB. When the newest file is full, Docker deletes the oldest one.
So the logs of Chatter, VictoriaMetrics and vmalert use 90 MB at most, also on the SD card of a Pi.
The files in the data volume add at most 12 MB: the server log (2 files of 1 MB) and the audit log (2 files of 5 MB).
An update of Chatter brings this limit to a Pi that has an older `docker-compose.yml`.
