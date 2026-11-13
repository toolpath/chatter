import { type AlertSeverity, channelWantsAlert, type NotificationChannel } from '@local-chatter/shared';
import type { Alert } from '../alerts/AlertStore.js';
import { createLogger } from '../logging/logger.js';
import type { AlertChange, AlertChangeListener } from './AlertChangeFinder.js';
import { severityOf, type TextOptions } from './messageText.js';
import type { Outbox } from './Outbox.js';
import { alertOutgoingMessage } from './outgoingMessages.js';

const log = createLogger('notifications');

export interface NotifierOptions {
  channels: { list(): NotificationChannel[] };
  outbox: Pick<Outbox, 'queue' | 'combineWithWaitingStart' | 'hasStartMessage'>;
  /** null when the machine is not there any more */
  machineName: (machineId: string) => string | null;
  textOptions: () => TextOptions;
  now?: () => number;
}

/**
 * Queues the messages of each alert change, one for each channel that wants the alert.
 * When an alert ends while its start message still waits, the channel gets one combined message.
 * A channel that did not get the start message gets no end message, so nobody reads "OK" for an alert they never saw.
 */
export class AlertNotifier implements AlertChangeListener {
  constructor(private readonly options: NotifierOptions) {}

  /**
   * An error is only logged. Else the change fails again at each look, and no later alert gets its messages.
   * The messages of this change are then lost, and the log tells why.
   */
  alertChanged(change: AlertChange): void {
    try {
      this.queueMessages(change);
    } catch (error) {
      log.error('Could not queue the messages of an alert', { alert: change.alert.name, kind: change.kind, error });
    }
  }

  private queueMessages({ kind, alertId, alert }: AlertChange): void {
    const { outbox, textOptions, now = Date.now } = this.options;
    const machineName = alert.machineId === undefined ? null : this.options.machineName(alert.machineId);
    const message = (messageKind: 'started' | 'ended' | 'combined') =>
      alertOutgoingMessage({ kind: messageKind, alert, machineName }, textOptions());
    for (const channel of this.channelsThatWant(alert)) {
      if (kind === 'ended') {
        if (!outbox.hasStartMessage(channel.id, alertId)) continue;
        if (outbox.combineWithWaitingStart(channel.id, alertId, message('combined'))) continue;
      }
      outbox.queue({ channelId: channel.id, alertId, message: message(kind) }, now());
    }
  }

  private channelsThatWant(alert: Alert): NotificationChannel[] {
    return this.options.channels.list().filter(channel => channel.enabled && wantsAlert(channel, alert));
  }
}

/**
 * A rule of Chatter always has a level. An alert from another rule gets the lowest level, so it is not lost.
 * An alert that is not about one machine goes only to the channels for all machines.
 */
function wantsAlert(channel: NotificationChannel, alert: Alert): boolean {
  if (alert.machineId === undefined) return channel.machineIds === null;
  const severity: AlertSeverity = severityOf(alert) ?? 'warning';
  return channelWantsAlert(channel, { machineId: alert.machineId, severity });
}
