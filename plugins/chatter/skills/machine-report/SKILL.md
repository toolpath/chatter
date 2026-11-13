---
name: machine-report
description: Answers questions about CNC machine history from Chatter, such as parts made, run time, idle time, alarms and which programs ran, for one machine or the whole shop. Use when the user asks how a machine or the shop did over a time, or wants a shift, day or week report.
---

# Report on machine history

Chatter keeps the history of each machine for 1 year. You read it through the API and answer in plain words. You only read: a **Viewer** account is enough, and it is the safest login to use.

## Connect to Chatter

Chatter has an HTTP API that takes HTTP Basic logins (docs: https://toolpath.github.io/chatter/api/). Ask the user to make a Viewer account for you in **Settings > Users and roles**, then set these in the terminal, so the password does not go in the chat:

```bash
export CHATTER_URL=http://<chatter address>:3001
export CHATTER_USERNAME=<the Viewer account>
read -rs CHATTER_PASSWORD && export CHATTER_PASSWORD
```

Each request: `curl -s -u "$CHATTER_USERNAME:$CHATTER_PASSWORD" "$CHATTER_URL/api/..."`. Stop after the first `401` and ask the user: after 10 wrong passwords, the address must wait 15 minutes.

## 1. Pick the machines and the time

Get the machine ids and names from `GET /api/machines`. A `range` always counts back from now, for example `-8h`, `-7d` or `-30d`. For a period that ended before now (for example "last Monday"), read periods or history over a range that includes it, and use only the part that you need.

## 2. Read the data

Pick the endpoint that answers the question (docs: https://toolpath.github.io/chatter/api/history):

| Question | Endpoint |
| --- | --- |
| Totals: run time, online time, parts made, alarms | `GET /api/machine/<id>/report?range=-7d` (at most 366 days) |
| When something happened: programs, alarms, mode, run state, tool | `GET /api/machine/<id>/periods?range=-1d&kind=program` |
| A value over time, for example run time for each day | `GET /api/machine/<id>/history/running?range=-7d&window=1d` |
| Alerts | `GET /api/alerts?range=-7d&machine=<id>` |

What the report values mean:
- Times are in milliseconds. `watchedMs` is the time that Chatter watched the machine. Time when Chatter did not run is not offline time.
- **Run time %** is `runningMs / watchedMs`. `runningMs` is `null` when the machine does not tell if a program runs.
- `partsMade` is how much the part counter went up. A counter reset does not lose parts.
- A `history/running` average is the part of each window that a program ran: `0.75` is 75%.
- Windows start at whole multiples of the window in UTC, so a `1d` window starts at midnight UTC, not at the shop's midnight. For days in the shop's time, use a `1h` window and add up the hours.

When `periods` or `alerts` has `more: true`, the reply left out older items. Ask for a shorter range, one range at a time.

## 3. Answer

- Start with the answer to the question, in one sentence.
- Then a short table, one row for each machine, with hours (not milliseconds) and percent.
- Say the exact time range that you used.
- Say each value that a machine does not send (a `null`), and that this is a limit of the machine, not zero.
- Keep each number as the API gives it. Do not guess values that are missing.
