import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import type { PollRecorder } from '../polling/poller.js';
import { pollTimeOf } from './pollTime.js';
import { changedKinds, stateValuesOf, type StateValues } from './statePeriods.js';
import type { StatePeriodStore } from './StatePeriodStore.js';
import { createLogger } from '../logging/logger.js';

const log = createLogger('history');

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** The same time as the number history in VictoriaMetrics */
export const KEEP_PERIODS_MS = 365 * DAY_MS;
/** How often the open periods get a new "seen" time. A power cut loses at most this much. */
export const MARK_SEEN_EVERY_MS = MINUTE_MS;
const REMOVE_OLD_EVERY_MS = HOUR_MS;

/**
 * Saves when the program, alarm, mode, run state and tool of each machine change.
 * Each value gets a period with a start and an end, in SQLite.
 */
export class StatePeriodRecorder implements PollRecorder {
  private readonly lastValues = new Map<string, StateValues>();
  private readonly lastSeenTimes = new Map<string, number>();
  private nextRemoveOldAt = 0;
  private lastErrorMessage = '';

  constructor(private readonly store: StatePeriodStore, private readonly now: () => number = Date.now) {
    store.closeLeftovers();
  }

  /** An error never stops the polling */
  record(connector: BaseMachineConnector): void {
    try {
      const snapshot = connector.getDataSnapshot();
      const time = pollTimeOf(snapshot, this.now);
      this.store.inTransaction(() => {
        this.saveChanges(snapshot.machineId, stateValuesOf(snapshot), time);
        this.markSeenWhenDue(snapshot.machineId, time);
      });
      this.removeOldWhenDue();
    } catch (error) {
      this.reportError(error);
    }
  }

  removeMachine(machineId: string): void {
    this.lastValues.delete(machineId);
    this.lastSeenTimes.delete(machineId);
    this.store.removeMachine(machineId);
  }

  /** End the open periods. Call it before the server stops. */
  stop(): void {
    this.store.closeAll(this.now());
    // The next poll after a stop opens new periods
    this.lastValues.clear();
  }

  private saveChanges(machineId: string, values: StateValues, time: number): void {
    const previous = this.lastValues.get(machineId) ?? {};
    for (const kind of changedKinds(previous, values)) {
      if (previous[kind] !== undefined) this.store.close(machineId, kind, time);
      const newValue = values[kind];
      if (newValue !== undefined) this.store.open(machineId, kind, newValue, time);
    }
    this.lastValues.set(machineId, values);
  }

  private markSeenWhenDue(machineId: string, time: number): void {
    if (time - (this.lastSeenTimes.get(machineId) ?? -Infinity) < MARK_SEEN_EVERY_MS) return;
    this.store.markSeen(machineId, time);
    this.lastSeenTimes.set(machineId, time);
  }

  private removeOldWhenDue(): void {
    const now = this.now();
    if (now < this.nextRemoveOldAt) return;
    this.store.removeEndedBefore(now - KEEP_PERIODS_MS);
    this.nextRemoveOldAt = now + REMOVE_OLD_EVERY_MS;
  }

  /** Show each new kind of error once, so a full disk does not fill the log */
  private reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== this.lastErrorMessage) log.error('Could not save the machine states', { reason: message });
    this.lastErrorMessage = message;
  }
}
