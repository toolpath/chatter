# History and alerts

When you remove a machine, Chatter also removes its history, its periods, and its alerts.
An unknown machine id gets `404`.

## Values over time

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/:id/history/:value` | One machine value over time, as one average for each window |

`:value` is one of these:
- Numbers: `spindle-speed`, `spindle-load`, `feedrate`, `part-count`, `part-goal`, `tool-number`
- `spindle-load` is in percent of the spindle motor's rating. A Haas needs its query port (Setting 143) and a vector drive (macro #1098). A FANUC needs a FANUC digital (serial) spindle. An MTConnect agent needs a LOAD item on the spindle. A Brother does not send it. The Haas, FANUC and MTConnect spindle loads are not tested on real machines yet.
- States: `connected`, `running`, `alarm`, `emergency`. A state is 1 (on) or 0 (off), so its average is the part of the window that it was on. For example, `running` 0.75 means that a program ran for 75% of the window. All four machine types tell if a program runs: Haas needs its query port (Setting 143), and Brother needs a C00 or D00 control. The Haas, Brother and FANUC run states are not tested on real machines yet.

Query parameters:
- `range`: how far back, for example `-10m`, `-1h`, `-7d`, or `-2w` (default `-1h`)
- `window`: the time that each average covers, in seconds, minutes, hours, or days, for example `10s` or `5m`. Without it, Chatter chooses a window that gives at most 1000 points. One reply has at most 5000 points. A range and window that give more points get `400`.

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

The reply is `{ range, data: [{ name, machineId, labels, annotations, start, end, firing }], more }`. An alert that fires now has `end: null`. One reply has at most 500 alerts; `more` is true when older ones were left out.
Chatter keeps the alerts for 1 year.

## Alert rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/machine/:id/alert-rules` | The alert rules of one machine |
| PUT | `/api/machine/:id/alert-rules` | Put a new list in place of the rules of one machine. Needs `manage-machines`. |
| POST | `/api/machine/:id/alert-rules/copy` | Copy the rules of one machine to other machines. Needs `manage-machines`. |
| POST | `/api/alert-rules/test` | Run a custom query one time, now. Needs `manage-machines`. |

A rule is one of these:
- A simple rule: `{ id, kind: "simple", enabled, subject, check, limit, forMinutes, severity }`.
  `subject` is `spindle-speed`, `spindle-load`, `part-count`, `not-connected`, `in-alarm` or `emergency-stop`. `check` is `above` or `below`. A state subject (the last 3) does not use `check` and `limit`.
- A custom query: `{ id, kind: "query", enabled, name, query, forMinutes, severity }`. The query must have `$machine` in it. See [Custom alert queries](../guide/custom-alert-queries.md).

`forMinutes` is a whole number from 0 to 1440. `severity` is `warning` or `critical`.

**GET** replies `{ rules }`.

**PUT** takes `{ rules }`, with at most 50 rules. Send the `id` of a rule that is already saved, so its alert goes on. A new rule has no `id`. Chatter checks each custom query on VictoriaMetrics first. The reply is `{ rules, vmalertReloaded }`. `vmalertReloaded` is false when vmalert did not answer; it then reads the rules within 30 seconds. A rule that cannot be saved gives `400` with `{ error, ruleIndex }`, and nothing is saved.

**Copy** takes `{ machineIds }`. Each machine gets a copy of each saved rule, but not a rule that it already has. A machine gets no more than 50 rules. The reply is `{ copied, notCopied, vmalertReloaded }`, where `notCopied` is the number of rules left out because of that limit. An unknown machine id gives `400`.

**Test** takes `{ machineId, query }`. The reply is `{ ok: true, resultCount, firstValue }`, or `{ ok: false, error }` for a query with an error.
