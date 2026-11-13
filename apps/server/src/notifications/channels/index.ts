import type { ChannelTypeInfo } from '@local-chatter/shared';
import { type ChannelType, defineChannelType } from './ChannelType.js';
import { createTwilioChannel, TWILIO_API } from './twilio.js';
import { webhookChannel } from './webhook.js';

/** The channel types of Chatter. To add a service, write one file like webhook.ts and add one line here. */
const CHANNEL_TYPES: readonly ChannelType[] = [
  defineChannelType(createTwilioChannel(TWILIO_API)),
  defineChannelType(webhookChannel),
];

export function findChannelType(id: string): ChannelType | undefined {
  return CHANNEL_TYPES.find(type => type.id === id);
}

/** For GET /api/notification-types: the web app makes the form of each type from its fields */
export function channelTypeInfos(): ChannelTypeInfo[] {
  return CHANNEL_TYPES.map(({ id, name, fields }) => ({ id, name, fields }));
}
