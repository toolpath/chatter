import type {
  ChannelInput, ChannelTestResult, ChannelTypeInfo, NotificationChannel, NotificationMessage, NotificationSettings,
} from '@local-chatter/shared';
import { api } from './client';
import { errorOf, jsonOrThrow } from './replies';

export type { ChannelInput, ChannelTestResult, ChannelTypeInfo, NotificationChannel, NotificationMessage, NotificationSettings };

// Settings > Notifications. Only an admin can call these.

const channelParam = (id: string) => ({ param: { id } });

export async function fetchChannelTypes(): Promise<ChannelTypeInfo[]> {
  return jsonOrThrow(await api['notification-types'].$get(), 'Could not load the channel types');
}

export async function fetchChannels(): Promise<NotificationChannel[]> {
  return jsonOrThrow(await api['notification-channels'].$get(), 'Could not load the channels');
}

export async function addChannel(input: ChannelInput): Promise<NotificationChannel> {
  return jsonOrThrow(await api['notification-channels'].$post({ json: input }), 'Could not save the channel');
}

/** An empty secret keeps the saved secret */
export async function updateChannel(id: string, input: ChannelInput): Promise<NotificationChannel> {
  return jsonOrThrow(
    await api['notification-channels'][':id'].$put({ ...channelParam(id), json: input }),
    'Could not save the channel',
  );
}

export async function removeChannel(id: string): Promise<void> {
  const error = await errorOf(await api['notification-channels'][':id'].$delete(channelParam(id)), 'Could not delete the channel');
  if (error) throw new Error(error);
}

/** With `savedId`, an empty secret uses the saved secret, and the result goes in the message list */
export async function sendTestMessage(input: ChannelInput, savedId?: string): Promise<ChannelTestResult> {
  const response = savedId === undefined
    ? await api['notification-channels'].test.$post({ json: input })
    : await api['notification-channels'][':id'].test.$post({ ...channelParam(savedId), json: input });
  return jsonOrThrow(response, 'Could not send the test');
}

/** The messages of the last 30 days, the newest first */
export async function fetchMessages(): Promise<NotificationMessage[]> {
  return jsonOrThrow(await api['notification-messages'].$get({ query: {} }), 'Could not load the messages');
}

export async function fetchNotificationSettings(): Promise<NotificationSettings> {
  return jsonOrThrow(await api['notification-settings'].$get(), 'Could not load the notification settings');
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<NotificationSettings> {
  return jsonOrThrow(await api['notification-settings'].$put({ json: settings }), 'Could not save the notification settings');
}

/** The form of a saved channel. The secrets are empty, so the server keeps the saved ones. */
export function inputOf(channel: NotificationChannel): ChannelInput {
  const { type, name, settings, minSeverity, machineIds, enabled } = channel;
  return { type, name, values: settings, minSeverity, machineIds, enabled };
}
