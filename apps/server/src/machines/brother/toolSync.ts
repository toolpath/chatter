/*
 * The tool table (ATC) and the tool data (TOLN) are big replies, like a file, and they change only when an operator
 * loads or measures a tool. Chatter reads them only when a user presses Sync, and only when the last poll said READY
 * (MEM operation status 0). Chatter never reads them by itself.
 * Why: on a Brother C00, a tool read near the time when an open door stopped a program kept the control from going
 * into feed hold. The cycle start lamp stayed green, and Cycle Start did not continue the program after the door
 * closed. A stopped spindle, or a run state that Chatter does not know, does not tell that no program runs.
 * Also READY does not prove that no program runs: on a C00, MEM A01 index 2 (the operation status) reads 0 (READY)
 * during a door-open feed hold. So the screen tells the operator to press Sync only when no program runs.
 */

import type { ToolSyncOutcome, ToolSyncState } from '../../types/index.js';

/** The shortest time between two Sync requests for the same machine, so many clicks do not keep the control busy */
const TOOL_SYNC_MIN_GAP_MS = 30_000;

/**
 * The time limit of a tool read. The read sends 2 or 3 commands with big replies. On a slow Brother, each reply can
 * take up to 5 s (the reply timeout), so the replies take up to 15 s.
 * The limit also includes the wait for a state poll that runs. The scheduler stops a poll after 10 s, so the worst
 * case (a slow poll, then 3 slow replies) takes about 25 s, which is more than the limit. Then the read fails, and the
 * user can press Sync again.
 * The limit is not longer, because while the read runs, it holds the one connection of the control, and the state
 * polls give only the last values.
 */
export const TOOL_SYNC_TIMEOUT_MS = 20_000;

/** Why the server does not start a Sync now */
export type ToolSyncRefusal = Extract<ToolSyncOutcome, { outcome: 'busy' | 'too-soon' }>;

const isoOrNull = (time: number | null) => (time === null ? null : new Date(time).toISOString());

/** When the tools were read, how the last read ended, and whether a read runs */
export class ToolSyncTracker {
  private lastSyncAt: number | null = null;
  private lastAttemptAt: number | null = null;
  private lastRequestAt: number | null = null;
  private error: string | null = null;
  private runningNow = false;
  private lastPollWasReady = false;

  /** True from started() until ended() or abandoned(). The connector reads it, so it keeps no copy of this fact. */
  get running(): boolean {
    return this.runningNow;
  }

  started(now: number): void {
    this.runningNow = true;
    this.lastRequestAt = now;
  }

  /** `error` is null for a good read */
  ended(now: number, error: string | null): void {
    this.runningNow = false;
    this.lastAttemptAt = now;
    this.error = error;
    if (error === null) this.lastSyncAt = now;
  }

  /**
   * The read ended with no result to keep: the address changed during it, or the poll that it waited for found that
   * a program runs, so it sent no tool command. The state of the last read stays. A Sync whose read was abandoned
   * does not count in the limit of 30 seconds, so the user can press Sync again.
   */
  abandoned(): void {
    this.runningNow = false;
    this.lastRequestAt = null;
  }

  /**
   * Keep the run state of each poll. `execution` is null for a failed poll. Only READY counts as "no program runs".
   */
  polled(execution: unknown): void {
    this.lastPollWasReady = execution === 'READY';
  }

  /** True when the last poll said READY. A Sync needs it. */
  get lastPollReady(): boolean {
    return this.lastPollWasReady;
  }

  /**
   * Forget the last read and the run state of the last poll, so a Sync at a new address waits for a READY poll of
   * the control there. A read that runs now and the Sync limit of 30 seconds stay.
   */
  forgetLastRead(): void {
    this.lastPollWasReady = false;
    this.lastSyncAt = null;
    this.lastAttemptAt = null;
    this.error = null;
  }

  /** Null when a Sync request can start now */
  manualRefusal(now: number): ToolSyncRefusal | null {
    if (this.running) return { outcome: 'busy' };
    if (this.lastRequestAt !== null && now - this.lastRequestAt < TOOL_SYNC_MIN_GAP_MS) {
      return { outcome: 'too-soon', retryAfterSeconds: Math.ceil((TOOL_SYNC_MIN_GAP_MS - (now - this.lastRequestAt)) / 1000) };
    }
    return null;
  }

  state(): ToolSyncState {
    return { lastSyncAt: isoOrNull(this.lastSyncAt), lastAttemptAt: isoOrNull(this.lastAttemptAt), error: this.error, running: this.running };
  }
}
