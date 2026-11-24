import { describe, expect, it } from 'vitest';
import { TOOL_SYNC_MIN_AGE_MS, TOOL_SYNC_MIN_GAP_MS, TOOL_SYNC_READY_HOLD_MS, ToolSyncTracker } from './toolSync.js';

const START = Date.parse('2026-11-21T08:00:00Z');
const MINUTE = 60_000;

/** A tracker whose last poll found the machine READY, held for the hold time at START */
function readyTracker(): ToolSyncTracker {
  const tracker = new ToolSyncTracker();
  tracker.polled(START - TOOL_SYNC_READY_HOLD_MS, 'READY');
  tracker.polled(START, 'READY');
  return tracker;
}

describe('ToolSyncTracker: the automatic read only when no program runs', () => {
  it('waits 2 minutes of READY polls with no break', () => {
    const tracker = new ToolSyncTracker();
    tracker.polled(START, 'READY');

    expect(tracker.autoSyncDue(START + TOOL_SYNC_READY_HOLD_MS - 1)).toBe(false);
    expect(tracker.autoSyncDue(START + TOOL_SYNC_READY_HOLD_MS)).toBe(true);
    expect(TOOL_SYNC_READY_HOLD_MS).toBe(2 * MINUTE);
  });

  it('is not due after a poll with another run state, also when the spindle stands still', () => {
    for (const execution of ['ACTIVE', 'FEED_HOLD', 'INTERRUPTED', '', undefined]) {
      const tracker = readyTracker();
      tracker.polled(START + 1000, execution);

      expect(tracker.autoSyncDue(START + 20 * MINUTE)).toBe(false);
    }
  });

  it('starts the 2 minutes again after one poll that is not READY', () => {
    const tracker = readyTracker();
    tracker.polled(START + 1000, 'FEED_HOLD');
    tracker.polled(START + 2000, 'READY');

    expect(tracker.autoSyncDue(START + 2000 + TOOL_SYNC_READY_HOLD_MS - 1)).toBe(false);
    expect(tracker.autoSyncDue(START + 2000 + TOOL_SYNC_READY_HOLD_MS)).toBe(true);
  });

  it('starts the 2 minutes again after a failed poll', () => {
    const tracker = readyTracker();
    tracker.polled(START + 1000, null);
    tracker.polled(START + 2000, 'READY');

    expect(tracker.autoSyncDue(START + 2000 + TOOL_SYNC_READY_HOLD_MS - 1)).toBe(false);
  });

  it('is not due before the first poll', () => {
    expect(new ToolSyncTracker().autoSyncDue(START)).toBe(false);
  });

  it('is ready for a Sync only when the last poll is READY, with no wait for the hold time', () => {
    const tracker = new ToolSyncTracker();
    expect(tracker.lastPollReady).toBe(false);

    tracker.polled(START, 'READY');
    expect(tracker.lastPollReady).toBe(true);

    for (const execution of ['ACTIVE', 'FEED_HOLD', '', undefined, null]) {
      tracker.polled(START + 1000, execution);
      expect(tracker.lastPollReady).toBe(false);
    }
  });

  it('forgets the READY time with the last read, so a new address waits 2 minutes again', () => {
    const tracker = readyTracker();

    tracker.forgetLastRead();

    expect(tracker.autoSyncDue(START + 1000)).toBe(false);
  });
});

describe('ToolSyncTracker', () => {
  it('is not synced at the start, and the first automatic read is due after the READY hold time', () => {
    expect(new ToolSyncTracker().state()).toEqual({ lastSyncAt: null, lastAttemptAt: null, error: null, running: false });
    expect(readyTracker().autoSyncDue(START)).toBe(true);
  });

  it('reads again automatically only when the last good read is more than 10 minutes old', () => {
    const tracker = readyTracker();
    tracker.started(START, 'auto');
    tracker.ended(START, null);

    expect(tracker.autoSyncDue(START + TOOL_SYNC_MIN_AGE_MS)).toBe(false);
    expect(tracker.autoSyncDue(START + TOOL_SYNC_MIN_AGE_MS + 1)).toBe(true);
    expect(TOOL_SYNC_MIN_AGE_MS).toBe(10 * MINUTE);
  });

  it('after a failed read, tries again automatically no sooner than 30 seconds later', () => {
    const tracker = readyTracker();
    tracker.started(START, 'auto');
    tracker.ended(START, 'No reply');

    expect(tracker.autoSyncDue(START + TOOL_SYNC_MIN_GAP_MS - 1)).toBe(false);
    expect(tracker.autoSyncDue(START + TOOL_SYNC_MIN_GAP_MS)).toBe(true);
  });

  it('keeps no result of an abandoned read: only the read stops running', () => {
    const tracker = readyTracker();
    tracker.started(START, 'auto');
    tracker.ended(START, null);
    tracker.started(START + 20 * MINUTE, 'auto');

    tracker.abandoned('auto');

    expect(tracker.state()).toEqual({ lastSyncAt: new Date(START).toISOString(), lastAttemptAt: new Date(START).toISOString(), error: null, running: false });
  });

  it('accepts a Sync at once after a Sync whose read was abandoned, so the user can press Sync again', () => {
    const tracker = readyTracker();
    tracker.started(START, 'manual');

    tracker.abandoned('manual');

    expect(tracker.manualRefusal(START + 1000)).toBeNull();
  });

  it('keeps the limit of the Sync button when an automatic read is abandoned', () => {
    const tracker = readyTracker();
    tracker.started(START, 'manual');
    tracker.ended(START + 1000, null);
    tracker.started(START + 2000, 'auto');

    tracker.abandoned('auto');

    expect(tracker.manualRefusal(START + 3000)).toEqual({ outcome: 'too-soon', retryAfterSeconds: 27 });
  });

  it('is not due while a read runs', () => {
    const tracker = readyTracker();
    tracker.started(START, 'auto');

    expect(tracker.autoSyncDue(START + 20 * MINUTE)).toBe(false);
    expect(tracker.state().running).toBe(true);
  });

  it('runs from started() until ended() or abandoned()', () => {
    const tracker = readyTracker();
    expect(tracker.running).toBe(false);

    tracker.started(START, 'auto');
    expect(tracker.running).toBe(true);
    tracker.ended(START + 1000, null);
    expect(tracker.running).toBe(false);

    tracker.started(START + 2000, 'manual');
    tracker.abandoned('manual');
    expect(tracker.running).toBe(false);
  });

  it('keeps the time of the last good read and the error of the last read', () => {
    const tracker = readyTracker();
    tracker.started(START, 'auto');
    tracker.ended(START + 1000, null);
    tracker.started(START + 20 * MINUTE, 'auto');
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
    tracker.started(START, 'manual');

    expect(tracker.manualRefusal(START + 1000)).toEqual({ outcome: 'busy' });
    tracker.ended(START + 2000, null);
    expect(tracker.manualRefusal(START + 10_000)).toEqual({ outcome: 'too-soon', retryAfterSeconds: 20 });
    expect(tracker.manualRefusal(START + TOOL_SYNC_MIN_GAP_MS)).toBeNull();
  });

  it('does not count an automatic read in the limit of the Sync button', () => {
    const tracker = readyTracker();
    tracker.started(START, 'auto');
    tracker.ended(START + 1000, null);

    expect(tracker.manualRefusal(START + 2000)).toBeNull();
  });
});
