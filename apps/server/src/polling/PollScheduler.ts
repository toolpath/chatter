import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';

interface PollSchedulerHooks {
  /** Called after each poll of a machine, good or bad */
  afterPoll(connector: BaseMachineConnector): void;
  /** Called when a machine had no good poll in its connecting time, so it is offline now */
  connectingEnded(connector: BaseMachineConnector): void;
}

/** A connector in a bad state may throw on disconnect. It counts as disconnected all the same. */
function disconnectQuietly(connector: BaseMachineConnector): void {
  try {
    connector.disconnect();
  } catch {
    connector.connected = false;
  }
}

const DEFAULT_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10000;
/**
 * The first poll of a real machine can take 5 to 15 seconds. Until the first good poll,
 * and for at most this time, the machine is "connecting", not "offline".
 */
const CONNECTING_TIME_MS = 30000;

/**
 * A machine that fails often is polled less often, so it does not slow the server.
 * The time is never shorter than the interval that was set.
 */
const BACKOFF_STEPS = [
  { minFailures: 3, intervalMs: 10000 },   // 3-5 failures: 10 seconds
  { minFailures: 6, intervalMs: 30000 },   // 6-9 failures: 30 seconds
  { minFailures: 10, intervalMs: 60000 },  // 10+ failures: 60 seconds
];

/**
 * Polls each machine on its own timer, so a slow machine does not hold up the others.
 * Only one poll runs at a time for each machine, also when a poll runs out of time.
 */
export class PollScheduler {
  private baseIntervalMs = DEFAULT_INTERVAL_MS;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The machines to keep polling: from start() until stop() */
  private readonly activeIds = new Set<string>();
  /** The machines with a poll that has not ended yet */
  private readonly idsWithPollInProgress = new Set<string>();
  private readonly failureCounts = new Map<string, number>();
  /** The machines that are connecting, each with the timer that ends its connecting time */
  private readonly connectingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly hooks: PollSchedulerHooks) {}

  get intervalMs(): number {
    return this.baseIntervalMs;
  }

  setInterval(ms: number): void {
    this.baseIntervalMs = ms;
  }

  /** True from start() until the first good poll, for at most CONNECTING_TIME_MS */
  isConnecting(id: string): boolean {
    return this.connectingTimers.has(id);
  }

  /** Poll now, then keep polling. Does nothing if the machine is polled already. */
  start(connector: BaseMachineConnector): void {
    if (this.activeIds.has(connector.id)) return;
    this.activeIds.add(connector.id);
    this.failureCounts.set(connector.id, 0);
    this.startConnecting(connector);
    // Do not wait: pollNow sets the next timer when it ends
    void this.pollNow(connector);
  }

  /** A poll that still runs is not stopped, but no poll comes after it */
  stop(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.activeIds.delete(id);
    this.failureCounts.delete(id);
    this.endConnecting(id);
  }

  stopAll(): void {
    for (const id of [...this.activeIds]) this.stop(id);
  }

  async pollNow(connector: BaseMachineConnector): Promise<void> {
    if (this.idsWithPollInProgress.has(connector.id)) {
      // The last poll ran out of time and still runs. Two polls at once would talk over each other.
      this.scheduleNext(connector);
      return;
    }

    const succeeded = (await this.pollWithTimeout(connector)) && connector.connected;
    // A machine that was stopped or removed during the poll keeps no state, and gets no history
    if (!this.activeIds.has(connector.id)) return;

    this.recordResult(connector.id, succeeded);
    // Before afterPoll, so the status it sends already says that the machine is connected
    if (succeeded) this.endConnecting(connector.id);
    this.hooks.afterPoll(connector);
    this.scheduleNext(connector);
  }

  /**
   * Poll one time. False when the poll fails or runs out of time. The machine stays "in progress" until the poll really ends.
   * A poll that runs out of time disconnects the machine, so its old values do not show as live.
   * When that poll ends later, the machine is disconnected again, so whatever the late poll did
   * (for example a connect that ended after all) does not count. The next poll connects again.
   */
  private async pollWithTimeout(connector: BaseMachineConnector): Promise<boolean> {
    const { id } = connector;
    let timedOut = false;
    this.idsWithPollInProgress.add(id);
    // Promise.resolve().then also catches an error that poll() throws before it gives a promise
    const poll = Promise.resolve()
      .then(() => connector.poll())
      .finally(() => {
        this.idsWithPollInProgress.delete(id);
        if (timedOut) disconnectQuietly(connector);
      });
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>(resolve => {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        disconnectQuietly(connector);
        resolve(false);
      }, POLL_TIMEOUT_MS);
    });

    try {
      return await Promise.race([poll.then(() => true), timeout]);
    } catch {
      // A poll that fails counts as a failure, the same as a poll that runs out of time
      return false;
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  private startConnecting(connector: BaseMachineConnector): void {
    const timer = setTimeout(() => {
      this.connectingTimers.delete(connector.id);
      this.hooks.connectingEnded(connector);
    }, CONNECTING_TIME_MS);
    this.connectingTimers.set(connector.id, timer);
  }

  private endConnecting(id: string): void {
    clearTimeout(this.connectingTimers.get(id));
    this.connectingTimers.delete(id);
  }

  private recordResult(id: string, succeeded: boolean): void {
    const failures = succeeded ? 0 : (this.failureCounts.get(id) ?? 0) + 1;
    this.failureCounts.set(id, failures);
  }

  private scheduleNext(connector: BaseMachineConnector): void {
    clearTimeout(this.timers.get(connector.id));
    if (!this.activeIds.has(connector.id)) return;

    const timer = setTimeout(() => void this.pollNow(connector), this.nextIntervalMs(connector.id));
    this.timers.set(connector.id, timer);
  }

  private nextIntervalMs(id: string): number {
    const failures = this.failureCounts.get(id) ?? 0;
    const backoffMs = BACKOFF_STEPS.filter(step => failures >= step.minFailures).pop()?.intervalMs ?? 0;
    return Math.max(this.baseIntervalMs, backoffMs);
  }
}
