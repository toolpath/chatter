import type { AlertSeverity, MessageStatus, NotificationChannel, NotificationKind, NotificationMessage } from '@local-chatter/shared';
import type { ChannelTypeInfo } from '../../api/notifications';
import type { StatusTone } from '../../components/ui/StatusDot';

// The words of Settings > Notifications, in one place, so the channel list, the messages and the form say the same.

export interface MachineName {
  id: string;
  name: string;
}

export const LEVEL_LABELS: Record<AlertSeverity, string> = { warning: 'Warning and up', critical: 'Critical only' };

export const KIND_LABELS: Record<NotificationKind, string> = {
  started: 'Started',
  ended: 'Ended',
  combined: 'Started and ended',
  more: 'More alerts',
  test: 'Test',
};

export const STATUS_TONES: Record<MessageStatus, StatusTone> = { waiting: 'check', sent: 'good', failed: 'bad', grouped: 'good' };

export const STATUS_LABELS: Record<MessageStatus, string> = {
  waiting: 'Waiting',
  sent: 'Sent',
  failed: 'Failed',
  grouped: 'In an "And more alerts" message',
};

/** For example "Text message (Twilio) · 2 phones" */
export function channelSummary(channel: NotificationChannel, types: ChannelTypeInfo[]): string {
  const type = types.find(known => known.id === channel.type);
  if (!type) return `${channel.type} (this Chatter does not know this type)`;
  const phoneCounts = type.fields
    .filter(field => field.kind === 'phone-list')
    .map(field => phoneCount(channel.settings[field.key]));
  return [type.name, ...phoneCounts].join(' · ');
}

function phoneCount(value: string | string[] | undefined): string {
  const count = Array.isArray(value) ? value.length : 0;
  return `${count} ${count === 1 ? 'phone' : 'phones'}`;
}

/** For example "All machines" or "Haas VF-2, Haas ST-10" */
export function machinesLabel(machineIds: string[] | null, machines: MachineName[]): string {
  if (machineIds === null) return 'All machines';
  if (machineIds.length === 0) return 'No machines';
  return machineIds.map(id => machineNameOf(id, machines)).join(', ');
}

/** The name of the machine, or its id when it is not there any more */
export function machineNameOf(id: string, machines: MachineName[]): string {
  return machines.find(machine => machine.id === id)?.name ?? id;
}

/** The newest message of the channel. The list has the newest first. */
export function lastMessageOf(channelId: string, messages: NotificationMessage[]): NotificationMessage | undefined {
  return messages.find(message => message.channelId === channelId);
}
