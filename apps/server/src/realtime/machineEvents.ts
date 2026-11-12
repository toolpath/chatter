import { Hono } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { MACHINE_EVENTS, type MachineRemovedEvent } from '@local-chatter/shared';
import type { MachineChangeFeed, MachineChanges } from './MachineChangeFeed.js';

/**
 * Some proxies close a connection that is quiet for too long.
 * A comment line keeps it open. The browser ignores it.
 */
const KEEP_ALIVE_MS = 25_000;
const KEEP_ALIVE_COMMENT = ': keep-alive\n\n';

function sendEvent(stream: SSEStreamingApi, event: string, data: unknown): Promise<void> {
  return stream.writeSSE({ event, data: JSON.stringify(data) });
}

function sendChanges(stream: SSEStreamingApi, changes: MachineChanges): void {
  for (const machine of changes.changed) {
    void sendEvent(stream, MACHINE_EVENTS.changed, machine);
  }
  for (const id of changes.removedIds) {
    void sendEvent(stream, MACHINE_EVENTS.removed, { id } satisfies MachineRemovedEvent);
  }
}

/**
 * GET /events: live machine status as server-sent events (SSE).
 * First the full machine list, then only the machines that change.
 */
export function machineEventRoutes(feed: MachineChangeFeed) {
  return new Hono().get('/events', c => streamSSE(c, async stream => {
    // Subscribe before the first wait, so no change is lost while the list is sent.
    // The writes go out in the order they are made, so the list is still first.
    const listSent = sendEvent(stream, MACHINE_EVENTS.list, feed.currentMachines());
    const unsubscribe = feed.subscribe(changes => sendChanges(stream, changes));
    stream.onAbort(unsubscribe);
    await listSent;

    while (!stream.aborted) {
      await stream.sleep(KEEP_ALIVE_MS);
      if (!stream.aborted) await stream.write(KEEP_ALIVE_COMMENT);
    }
  }));
}
