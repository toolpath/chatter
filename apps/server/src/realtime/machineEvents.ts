import { Hono, type Context } from 'hono';
import type { SSEStreamingApi } from 'hono/streaming';
import { MACHINE_EVENTS, machineStatusFor, type MachineRemovedEvent, type Role } from '@local-chatter/shared';
import type { MachineChangeFeed, MachineChanges } from './MachineChangeFeed.js';
import type { LoggedInEnv } from '../auth/authRoutes.js';
import { StreamsPerLogin } from './StreamsPerLogin.js';
import { streamSSEWithLog } from '../routes/streamReplies.js';

/**
 * Some proxies close a connection that is quiet for too long.
 * A comment line keeps it open. The browser ignores it.
 */
export const KEEP_ALIVE_MS = 25_000;
const KEEP_ALIVE_COMMENT = ': keep-alive\n\n';

/**
 * One login can have this many live streams open. Each browser tab uses one stream.
 * A browser opens at most 6 connections to one address, so more tabs than this do not work well anyway.
 */
const MAX_STREAMS_PER_LOGIN = 5;

/**
 * A closed stream tells the browser to wait this long before it connects again.
 * Without it, a browser with too many tabs could close the stream of its other tabs every few seconds.
 */
const RECONNECT_AFTER_CLOSE = 'retry: 60000\n\n';

function sendEvent(stream: SSEStreamingApi, event: string, data: unknown): Promise<void> {
  return stream.writeSSE({ event, data: JSON.stringify(data) });
}

/** Each change, as the role of the stream may see it: a Viewer gets no connection settings (D4) */
function sendChanges(stream: SSEStreamingApi, changes: MachineChanges, role: Role): void {
  for (const machine of changes.changed) {
    void sendEvent(stream, MACHINE_EVENTS.changed, machineStatusFor(role, machine));
  }
  for (const id of changes.removedIds) {
    void sendEvent(stream, MACHINE_EVENTS.removed, { id } satisfies MachineRemovedEvent);
  }
}

/**
 * GET /events: live machine status as server-sent events (SSE).
 * First the full machine list, then only the machines that change.
 * `loginOf` gives the login of the request. When a login opens more than MAX_STREAMS_PER_LOGIN streams, its oldest stream closes.
 * At each keep-alive, `isLoggedIn` checks that the login of the stream did not end (log out, no use, a removed user).
 * When it ended, the stream ends. The browser then connects again, gets 401, and shows the login page.
 * The stream itself does not count as a use of the login: an open tab that nobody looks at must not keep a login.
 */
export function machineEventRoutes(
  feed: MachineChangeFeed,
  loginOf: (c: Context<LoggedInEnv>) => string,
  isLoggedIn: (c: Context<LoggedInEnv>) => boolean = () => true,
) {
  const openStreams = new StreamsPerLogin(MAX_STREAMS_PER_LOGIN);
  return new Hono<LoggedInEnv>().get('/events', c => streamSSEWithLog(c, 'The live machine events', async stream => {
    let stopped = false;
    let stop!: () => void;
    const whenStopped = new Promise<void>(resolve => {
      stop = () => {
        stopped = true;
        resolve();
      };
    });
    // The browser closed the stream
    stream.onAbort(stop);
    const release = openStreams.add(loginOf(c), () => {
      void stream.write(RECONNECT_AFTER_CLOSE);
      stop();
    });
    // Empty until the subscription starts. Every step after add() is in the try, so the slot is always freed.
    let unsubscribe = () => {};
    try {
      // Subscribe before the first wait, so no change is lost while the list is sent.
      // The writes go out in the order they are made, so the list is still first.
      const role = c.var.user.role;
      const listSent = sendEvent(stream, MACHINE_EVENTS.list, feed.currentMachines().map(machine => machineStatusFor(role, machine)));
      unsubscribe = feed.subscribe(changes => sendChanges(stream, changes, role));
      await listSent;
      while (!stopped) {
        await Promise.race([stream.sleep(KEEP_ALIVE_MS), whenStopped]);
        if (stopped || !isLoggedIn(c)) break;
        await stream.write(KEEP_ALIVE_COMMENT);
      }
    } finally {
      unsubscribe();
      release();
    }
    // streamSSE closes the stream when this function returns
  }));
}
