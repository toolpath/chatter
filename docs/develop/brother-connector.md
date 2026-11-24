# Brother connector: structure and refactor plan

This page tells how the Brother connector works after PR #37, what is good in its structure, and what to clean up.
It is a plan for developers. Users do not need it.

**Progress:** steps 1 to 5 of [the plan](#the-plan) are done. Steps 6 and 7 are the remaining work.

The Brother connector got many changes in a short time (PRs #35, #37 and #42):

- a hint when the control does not answer, and a time limit for each poll
- ATC detection by the reply status
- the alarm from all the slots of the alarm list
- a tool read out of the state poll, with a **Sync** button
- a planned reconnect every 60 seconds
- poll timings
- a new detection when the address changes

A review of the whole connector found that the design is still clear. The plan below keeps it clear.

The files are in `apps/server/src/machines/brother/`:

- `BrotherConnector.ts`: the connection, the state poll, the tool read and the planned reconnect
- `brotherProtocol.ts`: the pure protocol code (the commands, the reply parser, the values and the tool table)
- `toolSync.ts`: when to read the tools (`ToolSyncTracker`)
- `testSupport.ts`: the replies of a real control, one fake Brother on a TCP port, and one fake connection with no socket
- the tests, one file for each behavior: `brotherProtocol`, `brotherPoll`, `brotherToolRead`, `brotherConnection` and `toolSync`

## How it works

The connector has one TCP connection to the control. A Brother control serves only one program at a time.
Two jobs share the connection, and they never run at the same time:

- **The state poll** runs every 2 seconds. It reads PANEL, MEM, WKCNTR, PDSP, ALARM and the macros.
- **The tool read** reads the ATC table and the tool data (about 13 KB). It runs only between two polls.

The rules between the two jobs:

- A tool read waits for the state poll that runs now.
- While a tool read runs, a state poll does not use the connection. It gives the last values at once, and it counts as a good poll.
- The tool read has its own limit of 20 seconds. After that, Chatter disconnects, and the next poll connects again.
- An automatic tool read starts only after each poll of 2 minutes said READY (`TOOL_SYNC_READY_HOLD_MS`). Another run state, an unknown run state, a failed poll or a new connection starts the 2 minutes again. A **Sync** needs only a last poll that said READY (the `program-running` outcome).
  Why: at a shop, a tool read at the time when an open door stopped the program kept a C00 from going into feed hold. The spindle had stopped, so the old rule "no run state and spindle 0" started the read.

The life of the connection:

```
poll():
  tool read runs?            -> give the last status (a good poll)
  no connection?             -> connect
  connection is 60 s old?    -> planned reconnect: close in order (2 s at most), then connect
  read the machine state     -> no reply or error: disconnect, keep the reason
  READY for 2 minutes and the last tool read is old? -> start a tool read (the poll does not wait for it)

Sync (a user) -> refused (too soon, busy, not connected, program running), or start a tool read
tool read:  wait for the poll -> read ATC and tools -> record the result
address change: forget the control (new generation), then disconnect
disconnect or remove: destroy the socket
```

During the planned reconnect, the status says that the machine is connected (the `reconnecting` flag).
So no screen shows the machine offline for those few milliseconds.

## Keep these as they are

- **The rule between the poll and the tool read:** a poll skips while a tool read runs, and a tool read waits for the poll. `runningPoll` and the `running` value of `ToolSyncTracker` record different facts. Keep both.
- **The control generation** (`controlGeneration`). It tells which control is at the address, not which connection. It gives the `address-changed` outcome. Keep it apart from the disconnect counter.
- **`ToolSyncTracker`** (`toolSync.ts`). It is small and pure, and it has its own tests.
- **The poll timings** (`PollTimingRecorder`), and the poll time limit for the 60 % warning.
- **The socket check in the `close` handler** (`this.socket === socket`). A close from an old socket does not change the new connection.
- **A disconnect after a reply timeout.** A late reply cannot then come as the reply to the next command.
- **The planned reconnect only at the start of a poll**, never during a tool read.
- **The keepalive code** that Brother and Haas share (`machineSocket.ts`).
- **The token and the stuck-poll limit** in `PollScheduler`.
- **The texts of the Sync route.** Each text is in one place, in clear STE.

## Problems to fix

The sections below tell the problems that the review found, and what steps 1 to 5 changed.

### Different checks for stale work

The connector had five ways to know that a result is stale. Step 1 removed the `timedOut` flag of the tool read. Now there are four:

1. the socket check in the `close` handler
2. the `disconnects` counter. The planned reconnect uses it to open no new connection after a disconnect during its orderly close. The tool read uses it to not start after a disconnect during its wait for the poll, for example after its 20 s limit.
3. `reconnecting`, which `disconnect()` clears
4. the control generation

There is also the token in `PollScheduler`.

PR #37 added the `disconnects` counter, as the FANUC and Siemens connectors have. It fixed a bug in the space between these checks: a disconnect during the planned reconnect left a connection open.
Keep the socket check, the generation and the scheduler token. They mean different things.

### The tests were hard to read (fixed in step 3)

The review found these problems:

- The tests set or read private state (`socket`, `connected`, `reconnecting`) in about 10 places.
- There were about 6 fake Brother servers and about 6 ways to hold back a reply.
- The fakes did not agree. A fake answered an unknown command with status `00`, `01` or `08`. The real control sends `08`. A fake that sends `00` makes each ATC command look known.
- `BrotherConnector.test.ts` had 27 top-level `describe` blocks in the order in which they were added. The detection tests and the tool table tests were each in two places.

Now `testSupport.ts` has one fake Brother on a TCP port (`replies`, `hold`, `allowHalfOpen`, `onCommand`) and one fake connection (`FakeConnection`).
Each fake answers an unknown command with status `08`, also `tools/fake-machines/brother.ts`.
Only `FakeConnection` sets the private state of the connector.
Three TCP tests still read a private value with `Reflect.get`: two read the socket, and one reads the registry of the poller. They test the real socket and the real poller, so a fake cannot replace them.
The tests of an address change moved from `machineSettings.test.ts` to `brotherToolRead.test.ts`.

### Leftovers

Steps 2 and 5 did these:

- The class comment said "telnet". It now says raw TCP with LOD frames.
- The comment of `TOOL_SYNC_TIMEOUT_MS` counted only the replies. It now tells that the limit includes the wait for the poll, and that the worst case (a slow poll, then 3 slow replies) is about 25 seconds. The value stays at 20 seconds: usually only a Sync waits for a poll, a read that fails can be tried again, and a longer read holds the one connection of the control for longer.
- `MANUAL_SYNC_EVERY_MS` is now `TOOL_SYNC_MIN_GAP_MS`, because it also limits the automatic tries again.
- `ToolSyncTracker.running` is the one "running" value of the tool read. The connector keeps only the promise of the last tool read, for `toolSyncEnded()`.
- `parseResponse`, `TRANSFORMS` and `parseValue` are in `brotherProtocol.ts`. The connector does not export them.

These are still open:

- `checkConnection()` has no caller outside the tests, in every connector. The Brother version writes `\n` to the control (step 6).
- `sendCommand` and `toolSyncEnded()` are still public only for the tests. `FakeConnection` replaces `sendCommand`, and the TCP tests send a command with it. `toolSyncEnded()` is a test seam with a comment. A `BrotherLink` class (step 7) can make `sendCommand` private.

### One failed connect gave two error lines (fixed in step 4)

A failed connect wrote `Connection timeout` or `Socket error: ...`, and then `Unable to connect: ...`. The connection log wrote both lines.
The `error` listener also stayed after the connect, so an error during a poll gave two lines too.

Now `connect()` only rejects, and `ensureConnected` writes the one reason, for example `Unable to connect: Connection timeout`.
After the connect, the `error` listener writes `Socket error: ...` only when no command waits for a reply. During a command, the poll or the tool read writes the reason.

## The plan

Each step is one small pull request. Write the tests first. A step does not change what Chatter does, except where the step says so.

| Step | Pull request | What changes | Risk | Size | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | One disconnect counter for the tool read | The tool read uses the `disconnects` counter of PR #37. The `timedOut` flag goes. The 20 s tests already cover it. | Low | Small | Done |
| 2 | A protocol module | Move the pure code to `brotherProtocol.ts`: the commands, the reply parser, the reply status, the transforms, the alarm list, the ATC check, and the tool table from the replies (about 250 lines). The tests of this code then need no connector and no mocks. `parseResponse`, `TRANSFORMS` and `parseValue` are no longer public only for the tests. | Very low | Medium | Done |
| 3 | One fake Brother for the tests | One `brother/testSupport.ts` with one fake server (`replies`, `hold`, `allowHalfOpen`, `onCommand`) and one fake connection. All the fakes answer an unknown command with `08`, also `tools/fake-machines/brother.ts`. Split the tests by behavior: protocol, poll, tool read, TCP connection. Move the address tests from `machineSettings.test.ts`. | Low | Medium to large | Done |
| 4 | One error line for a failed connect | `connect()` only rejects, and `ensureConnected` writes the one reason. The text changes to `Unable to connect: Connection timeout`. Check the table in the [Get started](../guide/get-started.md) guide. | Low | Small | Done |
| 5 | Small clean-ups | The class comment, the comment or the value of the 20 s limit, the name `MANUAL_SYNC_EVERY_MS`, and one "running" value in the tracker. | Low | Small | Done |
| 6 | Remove `checkConnection()` | Remove it from all 5 connectors in its own pull request. | Low | Small | To do |
| 7 | Optional: a `BrotherLink` class | A class that owns the socket: `open`, `send`, `closeInOrder`, `destroy`, `isOpen`, `openedAt`. The connector gets it through its constructor, so the tests do not set private state. Do this step only after steps 1 to 4, and only if the tests are still hard to write. | Medium | Medium | To do, if needed |

Step 6 is the next step. Do step 7 only if a new test needs more private state than `FakeConnection` sets now.

## Do not do

- **A `ToolReader` class.** It would need 5 callbacks into the connector (send, wait for the poll, connected, last error, disconnect). These links are the logic that it would hide.
- **One socket helper for Brother and Haas.** We have no Haas to test against, and the two listen for socket events in different ways.
- **A general timeout helper.** The 3 timeouts in the connector are each a bit different.
- **One counter for all the stale-work checks.** The reason for a failure would be lost, and the planned reconnect must not stop a Sync that waits for it.
