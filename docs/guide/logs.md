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

On the Pi card, first run `cd /opt/chatter`, and put `sudo` before `docker` (see [Chatter on the Pi](../install/raspberry-pi.md#chatter-on-the-pi)).
The update helper of the Pi writes its own log: `sudo journalctl -u chatter-update`.

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

## Change the level or the format

Set these in the `environment:` of the `chatterbox` service in `docker-compose.yml`, then run `docker compose up -d`:

| Setting | Values |
|---------|--------|
| `LOG_LEVEL` | `info` (the default), `debug` for more detail (for example each Haas alarm, and the stack of each error), `warn` or `error` for less |
| `LOG_FORMAT` | `text` (the default), or `json` for one JSON object on each line, for a log collector such as Loki or Elasticsearch |

## Size

`docker-compose.yml` limits the log of each container to 3 files of 10 MB. When the newest file is full, Docker deletes the oldest one.
So the logs of Chatter, VictoriaMetrics and vmalert use 90 MB at most, also on the SD card of a Pi.
An update of Chatter brings this limit to a Pi that has an older `docker-compose.yml`.
