import type { ChannelTypeInfo } from '@local-chatter/shared';
import { type ChannelType, defineChannelType } from './ChannelType.js';
import { createTwilioChannel, twilioAddressOf } from './twilio.js';
import { webhookChannel } from './webhook.js';

/**
 * The address of the Twilio API. For development only: TWILIO_API_URL points it at a fake Twilio (npm run fake-notify),
 * so you can try text messages without a Twilio account. The server logs `warning` at start.
 */
export const TWILIO_ADDRESS = twilioAddressOf(process.env.TWILIO_API_URL);

/** The channel types of Chatter. To add a service, write one file like webhook.ts and add one line here. */
const CHANNEL_TYPES: readonly ChannelType[] = [
  defineChannelType(createTwilioChannel(TWILIO_ADDRESS.url)),
  defineChannelType(webhookChannel),
];

export function findChannelType(id: string): ChannelType | undefined {
  return CHANNEL_TYPES.find(type => type.id === id);
}

/** For GET /api/notification-types: the web app makes the form of each type from its fields */
export function channelTypeInfos(): ChannelTypeInfo[] {
  return CHANNEL_TYPES.map(({ id, name, fields, note }) => ({ id, name, fields, note }));
}
