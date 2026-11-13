import { ALERT_SEVERITIES, type AlertSeverity } from './alertRules.js';

/**
 * Notifications: messages that Chatter sends out when an alert starts or ends.
 * A channel is one place to send them, for example the shop phones (Twilio) or a Slack webhook.
 * Settings > Notifications shows the channels and the messages. Only an admin (manage-chatter) changes them.
 */

/** How the web app shows one input of a channel form */
export const CHANNEL_FIELD_KINDS = ['text', 'secret', 'url', 'phone-list'] as const;
export type ChannelFieldKind = typeof CHANNEL_FIELD_KINDS[number];

/**
 * One input of a channel form. Each channel type gives its list, and the web app makes the form from it.
 * The server never sends the value of a `secret` field back to the browser.
 */
export interface ChannelField {
  key: string;
  label: string;
  kind: ChannelFieldKind;
  /** A short help line under the input */
  hint?: string;
  required: boolean;
  /** Show the value in the mono font, for ids and web addresses */
  mono?: boolean;
}

/** A channel type that the server knows, from GET /api/notification-types */
export interface ChannelTypeInfo {
  /** For example 'twilio-sms' */
  id: string;
  /** For example 'Text message (Twilio)' */
  name: string;
  fields: ChannelField[];
  /** A fact that the admin must know before they use this type. The form shows it in a box. */
  note?: string;
}

/** A `phone-list` field has a list of numbers. Each other field has one text. */
export type ChannelFieldValue = string | string[];
export type ChannelValues = Record<string, ChannelFieldValue>;

/** Which alerts a channel gets */
export interface ChannelRouting {
  /** 'warning' gets warning and critical alerts. 'critical' gets only critical alerts. */
  minSeverity: AlertSeverity;
  /** null gets the alerts of all machines, also of machines that you add later */
  machineIds: string[] | null;
}

/** A channel as the API shows it. It has no secret values. */
export interface NotificationChannel extends ChannelRouting {
  id: string;
  type: string;
  name: string;
  /** The values of the fields that are not secret */
  settings: ChannelValues;
  /** True for each secret field that has a saved value, for example { authToken: true } */
  hasSecret: Record<string, boolean>;
  enabled: boolean;
  /** ISO time */
  createdAt: string;
}

/**
 * The body of POST and PUT /api/notification-channels, and of a test before you save.
 * `values` has all the fields, also the secret fields. An empty secret on an edit keeps the saved secret.
 */
export interface ChannelInput extends ChannelRouting {
  type: string;
  name: string;
  values: ChannelValues;
  enabled: boolean;
  /** The keys of saved secrets to delete on an edit, for example ['secret'] to stop sending a webhook secret */
  clearSecrets?: string[];
}

/**
 * Why Chatter made a message. A "combined" message tells that an alert started and ended.
 * A "more" message goes in place of the messages over the limit of a channel, for example "And 7 more alerts".
 */
export const NOTIFICATION_KINDS = ['started', 'ended', 'combined', 'more', 'test'] as const;
export type NotificationKind = typeof NOTIFICATION_KINDS[number];

/**
 * "waiting" is in the outbox. "failed" means that Chatter stopped trying.
 * "grouped" means that the message went into one "more" message, because the channel was at its limit.
 */
export const MESSAGE_STATUSES = ['waiting', 'sent', 'failed', 'grouped'] as const;
export type MessageStatus = typeof MESSAGE_STATUSES[number];

/** One message in the list, from GET /api/notification-messages */
export interface NotificationMessage {
  id: number;
  channelId: string;
  /** null for a test message */
  alertId: number | null;
  kind: NotificationKind;
  machineId: string | null;
  severity: AlertSeverity | null;
  text: string;
  status: MessageStatus;
  attempts: number;
  /** The last error, in plain words for the user */
  lastError: string | null;
  /** What the service said when the message was sent, for example "Sent to 2 phones" */
  detail: string | null;
  /** ISO time */
  createdAt: string;
  /** ISO time */
  sentAt: string | null;
}

/** The result of "Send test" */
export type ChannelTestResult =
  | { ok: true; detail: string }
  | { ok: false; error: string };

/** GET and PUT /api/notification-settings */
export interface NotificationSettings {
  /** The address that people use to open Chatter, for example http://chatter.local:3001. null sends no links. */
  linkBaseUrl: string | null;
  /**
   * The time zone of the shop for the times in the messages, for example America/Chicago.
   * null gives the times in UTC. The web app fills it from the browser of the Admin until it is saved.
   */
  timeZone: string | null;
}

/** The message list keeps this many days */
export const NOTIFICATION_MESSAGE_DAYS = 30;

/** True when an alert with this severity is at the level of the channel or above it */
export function isAtLeastLevel(severity: AlertSeverity, minSeverity: AlertSeverity): boolean {
  return ALERT_SEVERITIES.indexOf(severity) >= ALERT_SEVERITIES.indexOf(minSeverity);
}

/** True when the channel gets this alert */
export function channelWantsAlert(
  routing: ChannelRouting,
  alert: { machineId: string; severity: AlertSeverity },
): boolean {
  const machineMatches = routing.machineIds === null || routing.machineIds.includes(alert.machineId);
  return machineMatches && isAtLeastLevel(alert.severity, routing.minSeverity);
}

/** E.164: a +, a country code that does not start with 0, and 7 to 15 digits in all */
const PHONE_NUMBER = /^\+[1-9]\d{6,14}$/;

/** True when the text is a phone number in the form that Twilio needs, for example +15559870001 */
export function isPhoneNumber(text: string): boolean {
  return PHONE_NUMBER.test(text);
}
