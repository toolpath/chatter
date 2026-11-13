---
name: alert-query
description: Turns an alert that the user describes in plain words into a Chatter alert rule, as a simple rule or a custom MetricsQL query, tested on the machine's real history. Use when the user wants Chatter to warn them about a machine, for example "the spindle load stays high" or "no parts for 30 minutes".
---

# Write a Chatter alert rule

Chatter checks each alert rule on one machine every 15 seconds (docs: https://toolpath.github.io/chatter/guide/alerts). You write the rule. The user adds it in the app, because only an Admin can save rules.

## Connect to Chatter

Chatter has an HTTP API that takes HTTP Basic logins (docs: https://toolpath.github.io/chatter/api/). Ask the user to set these in the terminal, so the password does not go in the chat:

```bash
export CHATTER_URL=http://<chatter address>:3001
export CHATTER_USERNAME=<username>
read -rs CHATTER_PASSWORD && export CHATTER_PASSWORD
```

Each request: `curl -s -u "$CHATTER_USERNAME:$CHATTER_PASSWORD" "$CHATTER_URL/api/..."`. A Viewer account can do steps 1 to 3. Step 4 needs an Admin account. Stop after the first `401` and ask the user: after 10 wrong passwords, the address must wait 15 minutes.

## 1. Get the check in plain words

Get from the user: the machine (or machines), what to check, the limit, how long it must stay true, and the level (`warning` or `critical`). Find the machine id with `GET /api/machines`.

## 2. Use a simple rule when one fits

A simple rule needs no query. It checks one of: `spindle-speed`, `spindle-load` or `part-count` (above or below a limit), or `not-connected`, `in-alarm` or `emergency-stop` (a state). If the check is one of these, give the user the simple rule and go to step 5.

## 3. Write the query

Write MetricsQL, the query language of VictoriaMetrics. Put `{machine="$machine"}` after **each** metric name: Chatter puts the machine id there, and it does not save a query without `$machine`.

| Metric | What it is | History value |
| --- | --- | --- |
| `chatter_connected` | Chatter can reach the machine (1 or 0) | `connected` |
| `chatter_running` | A program runs (1 or 0) | `running` |
| `chatter_alarm` | The machine has an alarm (1 or 0) | `alarm` |
| `chatter_emergency` | The emergency stop is pushed (1 or 0) | `emergency` |
| `chatter_spindle_speed` | RPM | `spindle-speed` |
| `chatter_spindle_load` | % | `spindle-load` |
| `chatter_feedrate` | the machine's unit | `feedrate` |
| `chatter_part_count` | parts | `part-count` |
| `chatter_part_goal` | parts | `part-goal` |
| `chatter_tool_number` | tool number | `tool-number` |

How a query alerts: the check is true when the query gives **a result**. A compare such as `> 90` keeps a value only while it is true. Join two checks with `and`, `or` or `unless`. For a time, use `avg_over_time(...[10m])`, `max_over_time`, `min_over_time`, or `increase(...[30m])` for a counter. A query that looks back with `[10m]` often needs 0 minutes in the rule. More examples: https://toolpath.github.io/chatter/guide/custom-alert-queries

Make sure that the machine sends each value in the query: `GET /api/machine/<id>/history/<history value>?range=-1d`. An empty `data` list means that the machine does not send it, so the query never gives a result. Tell the user, and find another value.

## 4. Test the query

With an Admin login, run the query one time:

```bash
curl -s -u "$CHATTER_USERNAME:$CHATTER_PASSWORD" -H 'Content-Type: application/json' \
  -d '{"machineId":"<id>","query":"<query>"}' "$CHATTER_URL/api/alert-rules/test"
```

`{ ok: true, resultCount: 0 }` is a correct query that is not true now. `{ ok: false, error }` is a query with an error: fix it and test again. Without an Admin login, the user clicks **Test** in the app in step 5.

Do not save rules through the API: `PUT /api/machine/<id>/alert-rules` puts the new list in place of all the rules of the machine.

## 5. Give the rule to the user

Give the user:
- **Name**, short, for example `Slow spindle while running`.
- **Query**, in a code block, or the words of the simple rule.
- **Minutes** (0 to 1440) and **level**.
- In one sentence, what makes it fire.
- The steps: open the machine, click the **Alert rules** tab, click **+ Add rule**, then **Custom query** (or **Simple rule**). Paste the name and the query, click **Test**, set the minutes and the level, and click **Save changes**.
- For more machines: **Copy rules to other machines** on the same tab. Because of `$machine`, each copy checks its own machine.
