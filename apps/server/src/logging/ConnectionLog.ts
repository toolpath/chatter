import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import type { PollRecorder } from '../polling/poller.js';
import { createLogger, type Logger } from './logger.js';

interface MachineState {
  connected: boolean;
  /** The errors of the last poll */
  errors: string[];
  /** When the machine went offline, or null while it is online */
  offlineSince: Date | null;
}

/**
 * Writes a log line when a machine connects, goes offline, comes back, or reports a new problem.
 * A machine is polled every few seconds, so the log says only what changed, not each failed poll:
 * a machine that is off for a weekend gives one line, not thousands.
 * While a machine is still connecting (the web shows "Connecting"), a failed poll is normal, so it is not logged.
 */
export class ConnectionLog implements PollRecorder {
  private readonly states = new Map<string, MachineState>();

  constructor(
    private readonly log: Logger = createLogger('machines'),
    private readonly now: () => Date = () => new Date(),
    /** True while the machine is in its first connecting time (see PollScheduler) */
    private readonly isConnecting: (machineId: string) => boolean = () => false,
  ) {}

  record(connector: BaseMachineConnector): void {
    const { id, name, type, host, connected, errors } = connector.getStatus();
    const problem = errors.join('; ');
    const machineLog = this.log.child({ machine: id, name, type, host });
    const previous = this.states.get(id);
    const now = this.now();
    if (!previous && !connected && this.isConnecting(id)) return;

    if (!previous) {
      if (connected) machineLog.info('Machine connected', problem ? { problem } : {});
      else machineLog.warn('Machine cannot be reached', { reason: problem || undefined });
    } else if (previous.connected && !connected) {
      machineLog.warn('Machine went offline', { reason: problem || undefined });
    } else if (!previous.connected && connected) {
      machineLog.info('Machine is online again', { offlineFor: durationText(previous.offlineSince, now) });
      if (problem) machineLog.warn('Machine reports a problem', { problem });
    } else if (isNewProblem(previous.errors, errors)) {
      machineLog.warn(connected ? 'Machine reports a problem' : 'Machine is still offline, for another reason', {
        [connected ? 'problem' : 'reason']: problem,
      });
    } else if (connected && previous.errors.length > 0 && errors.length === 0) {
      machineLog.info('Machine problem is gone');
    }

    const wasOffline = previous !== undefined && !previous.connected;
    this.states.set(id, {
      connected,
      errors: [...errors],
      offlineSince: connected ? null : wasOffline ? previous.offlineSince : now,
    });
  }

  removeMachine(machineId: string): void {
    this.states.delete(machineId);
  }
}

/**
 * True when the errors tell of another problem: none of them was there at the last poll.
 * A connector often adds a second message for the same cause (for example "Connection failed" next to
 * "Poll failed" on the next try), and that is not worth a line.
 */
export function isNewProblem(previous: string[], current: string[]): boolean {
  return current.length > 0 && !current.some(error => previous.includes(error));
}

/** "45s", "12m", "3h 5m" or "2d 4h": how long a machine was offline */
export function durationText(since: Date | null, now: Date): string | undefined {
  if (!since) return undefined;
  const seconds = Math.max(0, Math.round((now.getTime() - since.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
