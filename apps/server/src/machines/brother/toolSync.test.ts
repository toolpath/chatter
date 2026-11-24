import { describe, expect, it } from 'vitest';
import { TOOL_SYNC_MIN_GAP_MS, ToolSyncTracker } from './toolSync.js';

const START = Date.parse('2026-11-21T08:00:00Z');
const MINUTE = 60_000;

/** A tracker whose last poll found the machine READY */
function readyTracker(): ToolSyncTracker {
  const tracker = new ToolSyncTracker();
  tracker.polled('READY');
  return tracker;
}

describe('ToolSyncTracker: a Sync only when no program runs', () => {
  it('is ready for a Sync only when the last poll is READY', () => {
    const tracker = new ToolSyncTracker();
    expect(tracker.lastPollReady).toBe(false);

    tracker.polled('READY');
    expect(tracker.lastPollReady).toBe(true);

    for (const execution of ['ACTIVE', 'FEED_HOLD', 'INTERRUPTED', '', undefined, null]) {
      tracker.polled('READY');
      tracker.polled(execution);
      expect(tracker.lastPollReady).toBe(false);
    }
  });

  it('forgets the run state of the last poll with the last read, so a new address needs a READY poll', () => {
    const tracker = readyTracker();
    tracker.started(START);
    tracker.ended(START + 1000, null);

    tracker.forgetLastRead();

    expect(tracker.lastPollReady).toBe(false);
    expect(tracker.state()).toEqual({ lastSyncAt: null, lastAttemptAt: null, error: null, running: false });
  });
});

describe('ToolSyncTracker', () => {
  it('is not synced at the start', () => {
    expect(new ToolSyncTracker().state()).toEqual({ lastSyncAt: null, lastAttemptAt: null, error: null, running: false });
  });

  it('keeps no result of an abandoned read: only the read stops running', () => {
    const tracker = readyTracker();
    tracker.started(START);
    tracker.ended(START, null);
    tracker.started(START + 20 * MINUTE);

    tracker.abandoned();

    expect(tracker.state()).toEqual({ lastSyncAt: new Date(START).toISOString(), lastAttemptAt: new Date(START).toISOString(), error: null, running: false });
  });

  it('accepts a Sync at once after a Sync whose read was abandoned, so the user can press Sync again', () => {
    const tracker = readyTracker();
    tracker.started(START);

    tracker.abandoned();

    expect(tracker.manualRefusal(START + 1000)).toBeNull();
  });

  it('runs from started() until ended() or abandoned()', () => {
    const tracker = readyTracker();
    expect(tracker.running).toBe(false);

    tracker.started(START);
    expect(tracker.running).toBe(true);
    tracker.ended(START + 1000, null);
    expect(tracker.running).toBe(false);

    tracker.started(START + 2000);
    tracker.abandoned();
    expect(tracker.running).toBe(false);
  });

  it('keeps the time of the last good read and the error of the last read', () => {
    const tracker = readyTracker();
    tracker.started(START);
    tracker.ended(START + 1000, null);
    tracker.started(START + 20 * MINUTE);
    tracker.ended(START + 20 * MINUTE + 500, 'No reply');

    expect(tracker.state()).toEqual({
      lastSyncAt: new Date(START + 1000).toISOString(),
      lastAttemptAt: new Date(START + 20 * MINUTE + 500).toISOString(),
      error: 'No reply',
      running: false,
    });
  });

  it('refuses a Sync request while a read runs, and a second request within 30 seconds', () => {
    const tracker = readyTracker();
    expect(tracker.manualRefusal(START)).toBeNull();
    tracker.started(START);

    expect(tracker.manualRefusal(START + 1000)).toEqual({ outcome: 'busy' });
    tracker.ended(START + 2000, null);
    expect(tracker.manualRefusal(START + 10_000)).toEqual({ outcome: 'too-soon', retryAfterSeconds: 20 });
    expect(tracker.manualRefusal(START + TOOL_SYNC_MIN_GAP_MS)).toBeNull();
    expect(TOOL_SYNC_MIN_GAP_MS).toBe(30_000);
  });
});
