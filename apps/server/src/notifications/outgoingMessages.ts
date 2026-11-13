import type { NotificationKind } from '@local-chatter/shared';
import type { OutgoingMessage } from './channels/ChannelType.js';
import {
  type AlertMessage, alertMessageText, chatterLink, machineLink, moreAlertsText, severityOf, testMessageText, type TextOptions,
} from './messageText.js';

// The messages that go to the channel types. Each one has the text, and the facts that a webhook sends as JSON.

export function alertOutgoingMessage(message: AlertMessage, options: TextOptions): OutgoingMessage {
  const { kind, alert, machineName } = message;
  return {
    kind,
    text: alertMessageText(message, options),
    severity: severityOf(alert),
    machine: alert.machineId === undefined ? null : { id: alert.machineId, name: machineName?.trim() || alert.machineId },
    alertName: alert.name,
    summary: alert.annotations.summary ?? null,
    startedAt: new Date(alert.startsAt).toISOString(),
    endedAt: kind === 'started' ? null : new Date(alert.endsAt).toISOString(),
    link: machineLink(alert.machineId, options.linkBaseUrl),
  };
}

/** The message that goes in place of `count` alerts over the limit of a channel */
export function moreAlertsMessage(count: number, options: TextOptions): OutgoingMessage {
  return messageWithoutAlert('more', moreAlertsText(count, options), options);
}

export function testMessage(options: TextOptions): OutgoingMessage {
  return messageWithoutAlert('test', testMessageText(options), options);
}

function messageWithoutAlert(kind: NotificationKind, text: string, options: TextOptions): OutgoingMessage {
  return {
    kind, text, severity: null, machine: null, alertName: null, summary: null, startedAt: null, endedAt: null,
    link: chatterLink(options.linkBaseUrl),
  };
}
