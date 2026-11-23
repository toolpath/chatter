# History and alerts

When you remove a machine, Chatter also removes its history, its periods, and its alerts.
An unknown machine id gets `404`.

## Values over time

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/:id/history/:value` | One machine value over time, as one value for each window |

`:value` is one of these:
- Numbers: `spindle-speed`, `spindle-load`, `feedrate`, `part-count`, `part-goal`, `tool-number`. Each window gives the average, but `part-count`, `part-goal` and `tool-number` give the last value in the window. An average such as T7.4 is not a value that the machine sent.
- `spindle-load` is in percent of the spindle motor's rating. A Haas needs its query port (Setting 143) and a vector drive (macro #1098). A FANUC needs a FANUC digital (serial) spindle. An MTConnect agent needs a LOAD item on the spindle. A Brother does not send it. The Haas, FANUC and MTConnect spindle loads are not tested on real machines yet.
- States: `connected`, `running`, `alarm`, `emergency`, `program-ended`. A state is 1 (on) or 0 (off), so its average is the part of the window that it was on. For example, `running` 0.75 means that a program ran for 75% of the window. All five machine types tell if a program runs: Haas needs its query port (Setting 143), and Brother needs a C00 or D00 control. The Haas, Brother and FANUC run states are not tested on real machines yet.

Query parameters:
- `range`: how far back, for example `-10m`, `-1h`, `-7d`, or `-2w` (default `-1h`)
- `window`: the time that each average covers, in seconds, minutes, hours, or days, for example `10s` or `5m`. Without it, Chatter chooses a window that gives at most 1000 points. One reply has at most 5000 points. A range and window that give more points get `400`.
- `end`: the end of the time, to look back in time, for example `2026-11-19T15:00:00Z` (default: now). The range goes back from it. An end after now is the same as now. Give the zone: `Z` or an offset such as `+01:00`. A time with no zone gets `400`.

The reply is `{ machineId, value, range, window, data: [{ time, value }] }`. When the history database does not answer, the reply is 503. A window with no data is left out, so a gap in `data` means that the machine sent no data then.

## Periods

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/:id/periods` | When the program, alarm, mode, run state, and tool changed |

Each period is one value with a start and an end, for example "program O1234 from 9:00 to 9:42". A period that still runs has `end: null`.

Query parameters:
- `range`: how far back, for example `-8h` or `-7d` (default `-1d`)
- `kind`: only one kind: `program`, `alarm`, `mode`, `run-state`, or `tool`

The reply is `{ machineId, range, data: [{ kind, value, start, end }], more }`, newest first. One reply has at most 1000 periods; `more` is true when older ones were left out.
The periods are kept in `chatter.db` for 1 year. When the machine stops answering, its periods end.

## State timeline

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/:id/state-timeline` | What the machine did over a range: running, idle, alarm, or offline |

Query parameters:
- `range`: how far back, for example `-1h` or `-7d` (default `-24h`). It can go back at most 31 days.
- `end`: the end of the time, for example `2026-11-19T15:00:00Z` (default: now). The range goes back from it. An end after now is the same as now. Give the zone: `Z` or an offset such as `+01:00`. A time with no zone gets `400`.

The reply is `{ machineId, range, from, to, data: [{ state, start, end, detail, program }], more }`, oldest first. The segments cover the full time from `from` to `to`, with no gaps. Chatter makes them from the periods, with the same rule as the dashboard:
- `alarm`: an alarm is on. An alarm shows over running. `detail` is the alarm code and text.
- `running`: a program runs.
- `idle`: the machine answers, but no program runs. A machine that does not tell if a program runs (for example a Haas with no query port) shows `idle`.
- `offline`: the machine did not answer, or Chatter did not run. A machine that answers but sends no program, mode, tool, alarm, or run state also shows `offline`, because Chatter saves no period for it. The dashboard shows that machine as Idle.

A segment has `detail` only for an alarm. `program` is the program that was open, when the machine sent one. A new program starts a new segment, also when the state stays the same. When a range has more than 50,000 periods, `from` moves to the oldest period that Chatter read, and `more` is true.

## Report

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/:id/report` | A summary of one machine over a range |

Query parameter `range`: how far back, in minutes, hours, days, or weeks, for example `-8h` or `-30d` (default `-1d`). It can go back at most 366 days.

The reply is `{ machineId, range, from, to, watchedMs, onlineMs, runningMs, partsMade, alarms: { count, totalMs, values: [{ value, count, totalMs }] } }`. Times are in milliseconds:
- `watchedMs`: the time that Chatter watched the machine. When Chatter does not run, it cannot watch, so that time does not count as offline.
- `onlineMs`: the part of the watched time that the machine answered.
- `runningMs`: the part of the watched time that a program ran. It is `null` when the machine does not tell if a program runs (for example a Haas with no query port).
- `partsMade`: how much the part counter went up, from the first value that Chatter saved in the range. A reset to 0 does not lose parts.
- `alarms`: how many alarms came, their time, and the 10 alarms with the most time. Only the part of an alarm in the range counts.

A value that the machine does not send is `null`. The times are rounded to whole minutes, and the newest minute is not in the report yet. When the history database does not answer, the reply is 503.

## Alerts

To set the alert rules in the app, see [Alerts](../guide/alerts.md).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/alerts` | The alerts of the last week, newest first |

Query parameters:
- `range`: how far back, for example `-1d` or `-30d` (default `-7d`). An alert that fires now is always in the reply.
- `state`: `firing` (only the alerts that fire now) or `all` (the default)
- `machine`: only the alerts of this machine id

The reply is `{ range, data: [{ name, machineId, labels, annotations, start, end, firing }], more }`. An alert that fires now has `end: null`. An alert that vmalert did not send for up to 4 minutes still fires (see [When an alert ends](../guide/alerts.md#when-an-alert-ends)). One reply has at most 500 alerts; `more` is true when older ones were left out.
Chatter keeps the alerts for 1 year.

## Alert rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/:id/alert-rules` | The alert rules of one machine. Needs `manage-machines`. |
| PUT | `/api/machine/:id/alert-rules` | Put a new list in place of the rules of one machine. Needs `manage-machines`. |
| POST | `/api/machine/:id/alert-rules/copy` | Copy the rules of one machine to other machines. Needs `manage-machines`. |
| POST | `/api/alert-rules/test` | Run a custom query one time, now. Needs `manage-machines`. |

A rule is one of these:
- A simple rule: `{ id, kind: "simple", enabled, subject, check, limit, forMinutes, severity }`.
  `subject` is `spindle-speed`, `spindle-load`, `part-count`, `not-connected`, `in-alarm`, `emergency-stop` or `program-ended`. `check` is `above` or `below`. A state subject (`not-connected`, `in-alarm` and `emergency-stop`) does not use `check` and `limit`.
  `program-ended` is an event. It does not use `check`, `limit` or `forMinutes`: its alert fires at the first true check. Its alert has the label `event="true"`, and Chatter sends no end message for it.
- A custom query: `{ id, kind: "query", enabled, name, query, forMinutes, severity }`. The query must have `$machine` in it. See [Custom alert queries](../guide/custom-alert-queries.md).

`forMinutes` is a whole number from 0 to 1440. `severity` is `warning` or `critical`.

**GET** replies `{ rules }`.

**PUT** takes `{ rules }`, with at most 50 rules. Send the `id` of a rule that is already saved, so its alert goes on. A new rule has no `id`. Chatter checks each custom query on VictoriaMetrics first. The reply is `{ rules, vmalertReloaded }`. `vmalertReloaded` is false when vmalert did not answer; it then reads the rules within 30 seconds. A rule that cannot be saved gives `400` with `{ error, ruleIndex }`, and nothing is saved.

**Copy** takes `{ machineIds }`. Each machine gets a copy of each saved rule, but not a rule that it already has. A machine gets no more than 50 rules. The reply is `{ copied, notCopied, vmalertReloaded }`, where `notCopied` is the number of rules left out because of that limit. An unknown machine id gives `400`.

**Test** takes `{ machineId, query }`. The reply is `{ ok: true, resultCount, firstValue }`, or `{ ok: false, error }` for a query with an error.

## Back up and restore the history of a machine

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/machine/:id/history-backup` | Read the history of the machine into a file. Needs `manage-machines`. |
| GET | `/api/machine/:id/history-backup/:backupId` | Download the file (`.tar.gz`). Needs `manage-machines`. |
| POST | `/api/machine/:id/history-restore` | Send a file and check it. Nothing is written yet. Needs `manage-chatter` (Admin). |
| POST | `/api/machine/:id/history-restore/:restoreId` | Write the checked file into the machine. Needs `manage-chatter`. |
| DELETE | `/api/machine/:id/history-restore/:restoreId` | Delete the checked file without a restore. Needs `manage-chatter`. |

See [Back up and restore the history of a machine](../guide/get-started.md#back-up-and-restore-the-history-of-a-machine).

**Back up** takes `{ from, to, averagesOnly }`. Each one is optional. `from` and `to` are milliseconds since 1970. With no `from`, the file has all the history. With no `to`, it ends now. With `averagesOnly: true`, the file has only the 1-minute and 1-hour averages. The reply is `{ id, fileName, parts, data }`. `parts` gives the size, sha256 and count of each part, and `data` gives the first and last time in the file.
Then **GET** the file with the `id`, one time. Chatter deletes the file after the download, or after 30 minutes.
A new backup of the same machine replaces a file that no download has started yet. When the request stops (for example a proxy time limit), the backup stops and Chatter deletes its files. The backup can use only the free space of the disk, less 256 MB.

The file is a `.tar.gz` with these entries:
- `manifest.json`: `{ format: "chatter-machine-history", formatVersion, chatterVersion, createdAt, machine: { id, name, type }, range, averagesOnly, data, parts }`. Each part has `{ bytes, sha256, count }`.
- `history/raw.jsonl.gz`: the values of each poll, as the lines of the VictoriaMetrics `/api/v1/export` (one series block on each line). A series can be on more than one line, and the lines are not always in time order. The file has no staleness markers of vmalert (`null` values).
- `history/averages.jsonl.gz`: the series `chatter_*:avg1m` and `chatter_*:avg1h`
- `state-periods.jsonl.gz`: one period on each line, `{ kind, value, start, end }`
- `alert-rules.json`: `{ rules }`, with no `id`

**Restore** takes the file as the raw body, with `Content-Type: application/octet-stream` and a `Content-Length`. Chatter checks all of the file before it writes anything:
- The file has only the entries above, each one time. The format is known, and it is not newer than this Chatter.
- The size, sha256 and count of each part are the ones in `manifest.json`.
- The file is at most 2 GB. One line is at most 1 MB.
- Each series is a `chatter_*` value of the same machine type as this machine.
- Each series has only the labels `__name__`, `machine` and `type`. Its `machine` label is the machine id of `manifest.json`.
- Chatter leaves out a staleness marker of vmalert (a `null` value). The counts do not include them.
- No time is in the future. Chatter leaves out the history that is older than 1 year.

The reply is the preview: `{ id, source, chatterVersion, createdAt, range, data, averagesOnly, counts, tooOld, sameMachine, targetHasHistory }`. `counts` is `{ rawSamples, averageSamples, periods, alertRules }`. `tooOld` is `{ samples, periods }`: the history that Chatter leaves out. `targetHasHistory` is true when this machine has values or state periods in the time of the file (`data.first` to `data.last`) already. The restore then adds the file to that history.
Then **POST** `{ alertRules }` to `/api/machine/:id/history-restore/:restoreId`, with the `id` of the preview. Chatter changes only the `machine` label of each series to this machine. It adds each state period of the file that the machine does not have yet (the same kind and start). You cannot undo a restore. With `alertRules: true`, the rules of the file replace the rules of the machine. Chatter writes the periods and the rules in one transaction. The reply is `{ samples, periodsAdded, periodsKnown, alertRules }`. `alertRules` is null when Chatter did not restore the rules.

A restore of the same file two times does not add a value or a period two times. VictoriaMetrics keeps one sample for each time (`-dedup.minScrapeInterval=1ms` in `docker-compose.yml`).
Chatter keeps one received file. A new upload replaces it. Chatter deletes it after the restore, or after 30 minutes.

**DELETE** works only for the machine of the file. It gives `409` while the restore of the file runs.

A refused file gives `400` with `{ error }`. A backup or a restore file that is not there, or that is for another machine, gives `404`. Another backup or restore that runs gives `409`. A file that is too large gives `413`. A disk that is too full gives `507`. A history database (VictoriaMetrics) that does not answer gives `503`. An error that Chatter does not expect gives `500`, and the log of Chatter tells more.
