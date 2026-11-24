import type { ToolSyncOutcome, ToolSyncState } from '../../types/index.js';

/**
 * The tool table (ATC) and the tool data (TOLN) are big replies, like a file, and they change only when an
 * operator loads or measures a tool. So Chatter reads them automatically only when the machine runs no program
 * (see TOOL_SYNC_READY_HOLD_MS), and the last good read is more than 10 minutes old. A user can read them with the
 * Sync button when the last poll found no program that runs.
 */
export const TOOL_SYNC_MIN_AGE_MS = 10 * 60_000;

/**
 * An automatic tool read starts only after each poll of this time said READY (MEM operation status 0), with no
 * other run state, failed poll or disconnect between them.
 * Why: on a Brother C00, a tool read at the time when an open door stopped a program kept the control from going
 * into feed hold. The cycle start lamp stayed green, and Cycle Start did not continue the program after the door
 * closed. A stopped spindle, or a run state that Chatter does not know, does not tell that no program runs.
 */
export const TOOL_SYNC_READY_HOLD_MS = 2 * 60_000;

/**
 * The shortest time between two tool reads that Chatter starts for the same reason: at most one Sync request in
 * 30 seconds for each machine, so many clicks do not keep the one connection of the control busy, and after a failed
 * automatic read, the next automatic read waits this long too.
 */
export const TOOL_SYNC_MIN_GAP_MS = 30_000;

/**
 * The time limit of a tool read. The read sends 2 or 3 commands with big replies. On a slow Brother, each reply can
 * take up to 5 s (the reply timeout), so the replies take up to 15 s.
 * The limit also includes the wait for a state poll that runs. An automatic read starts after its poll ends, so
 * usually only a Sync waits for a poll. The scheduler stops a poll after 10 s, so the worst case (a slow poll, then
 * 3 slow replies) takes about 25 s, which is more than the limit. Then the read fails, and the user can press Sync
 * again, or the next automatic read tries again.
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
  private lastManualAt: number | null = null;
  private error: string | null = null;
  private runningNow = false;
  /** The start of the READY polls with no break, or null when the last poll did not say READY */
  private readySince: number | null = null;

  /** True from started() until ended() or abandoned(). The connector reads it, so it keeps no copy of this fact. */
  get running(): boolean {
    return this.runningNow;
  }

  started(now: number, trigger: 'auto' | 'manual'): void {
    this.runningNow = true;
    if (trigger === 'manual') this.lastManualAt = now;
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
  abandoned(trigger: 'auto' | 'manual'): void {
    this.runningNow = false;
    if (trigger === 'manual') this.lastManualAt = null;
  }

  /**
   * Keep the run state of each poll. `execution` is null for a failed poll. Only READY counts as "no program runs".
   */
  polled(now: number, execution: unknown): void {
    if (execution !== 'READY') this.readySince = null;
    else this.readySince ??= now;
  }

  /** True when the last poll said READY. A Sync needs it, but not the hold time. */
  get lastPollReady(): boolean {
    return this.readySince !== null;
  }

  /**
   * Forget the last read and the READY polls, so the tools are read when the control at a new address has said
   * READY for the hold time. A read that runs now and the Sync limit of 30 seconds stay.
   */
  forgetLastRead(): void {
    this.readySince = null;
    this.lastSyncAt = null;
    this.lastAttemptAt = null;
    this.error = null;
  }

  /** True when an automatic read can start: READY for the hold time, and the last read is old enough */
  autoSyncDue(now: number): boolean {
    if (this.running) return false;
    if (this.readySince === null || now - this.readySince < TOOL_SYNC_READY_HOLD_MS) return false;
    if (this.lastAttemptAt !== null && now - this.lastAttemptAt < TOOL_SYNC_MIN_GAP_MS) return false;
    return this.lastSyncAt === null || now - this.lastSyncAt > TOOL_SYNC_MIN_AGE_MS;
  }

  /** Null when a Sync request can start now */
  manualRefusal(now: number): ToolSyncRefusal | null {
    if (this.running) return { outcome: 'busy' };
    if (this.lastManualAt !== null && now - this.lastManualAt < TOOL_SYNC_MIN_GAP_MS) {
      return { outcome: 'too-soon', retryAfterSeconds: Math.ceil((TOOL_SYNC_MIN_GAP_MS - (now - this.lastManualAt)) / 1000) };
    }
    return null;
  }

  state(): ToolSyncState {
    return { lastSyncAt: isoOrNull(this.lastSyncAt), lastAttemptAt: isoOrNull(this.lastAttemptAt), error: this.error, running: this.running };
  }
}
