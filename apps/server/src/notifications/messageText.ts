import { ALERT_SEVERITIES } from '@local-chatter/shared';
import type { Alert } from '../alerts/AlertStore.js';

// The text of each message. Each channel type sends this same text, so a text message and Slack say the same.
// The fixed words use only GSM-7 characters. One character outside that set makes the limit of one text
// message 70, not 160. The names and the summary come from the shop, so Chatter sends them as they are.

/** The characters in one text message */
export const SMS_LENGTH = 160;

export interface TextOptions {
  /** The time zone of the shop, for example 'America/Chicago' */
  timeZone: string;
  /** The address that people use to open Chatter. null or blank sends no links. */
  linkBaseUrl: string | null;
}

export interface AlertMessage {
  kind: 'started' | 'ended' | 'combined';
  alert: Alert;
  /** null for an alert that is not about one machine */
  machineName: string | null;
}

/**
 * For example "CRITICAL - Haas VF-2: Spindle load above 80%. Spindle load is 92%. Started 9:02 AM."
 * When the text is too long for one text message, it first leaves out the value, and then shortens the alert name.
 * The machine name and the link stay as they are, so a very long machine name can still make two text messages.
 */
export function alertMessageText(message: AlertMessage, options: TextOptions): string {
  const name = message.alert.name;
  const full = composeText(message, name, valueDetail(message.alert), options);
  if (full.length <= SMS_LENGTH) return full;
  const withoutDetail = composeText(message, name, null, options);
  if (withoutDetail.length <= SMS_LENGTH) return withoutDetail;
  const roomForName = SMS_LENGTH - (withoutDetail.length - name.length);
  return composeText(message, shortened(name, roomForName), null, options);
}

/** The message that Chatter sends in place of the alerts over the limit of a channel */
export function moreAlertsText(count: number, options: TextOptions): string {
  const alerts = count === 1 ? 'alert' : 'alerts';
  const them = count === 1 ? 'it' : 'them';
  return `And ${count} more ${alerts}. Open Chatter to see ${them}.${withLink(chatterLink(options.linkBaseUrl))}`;
}

/** The message of "Send test". It has the link, so the user can try the link too. */
export function testMessageText(options: TextOptions): string {
  return `Test from Chatter. Messages to this channel work.${withLink(chatterLink(options.linkBaseUrl))}`;
}

function composeText(message: AlertMessage, name: string, detail: string | null, options: TextOptions): string {
  const { alert } = message;
  const about = `${message.machineName?.trim() || 'Chatter'}: ${name}`;
  const time = (milliseconds: number) => clockTime(milliseconds, options.timeZone);
  const link = withLink(machineLink(alert.machineId, options.linkBaseUrl));
  switch (message.kind) {
    case 'started':
      return `${severityLabel(alert)} - ${about}${detail ? `. ${detail}` : ''}. Started ${time(alert.startsAt)}.${link}`;
    case 'ended':
      return `OK - ${about} ended at ${time(alert.endsAt)}.${link}`;
    case 'combined':
      return `${severityLabel(alert)} - ${about} started ${time(alert.startsAt)} and ended ${time(alert.endsAt)}.${link}`;
  }
}

/**
 * The summary of the rule, for example "Spindle load is 92.3%". vmalert writes the value with all its decimals,
 * so a number with 3 or more decimals gets 1. null when the summary says only the alert name again.
 */
function valueDetail(alert: Alert): string | null {
  const summary = alert.annotations.summary?.trim();
  if (!summary || summary === alert.name) return null;
  return summary.replace(/\d+\.\d{3,}/g, number => String(Number(Number(number).toFixed(1))));
}

function severityLabel(alert: Alert): string {
  const severity = alert.labels.severity;
  return (ALERT_SEVERITIES as readonly string[]).includes(severity) ? severity.toUpperCase() : 'ALERT';
}

/**
 * For example "9:02 AM". Node puts a narrow space (U+202F) before AM, so it becomes a plain space.
 * A time zone that is not a known name gives the time in UTC, with "UTC" after it, so the message still goes.
 */
function clockTime(milliseconds: number, timeZone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(milliseconds).replace(/\s/g, ' ');
  try {
    return format(timeZone);
  } catch {
    return `${format('UTC')} UTC`;
  }
}

function shortened(text: string, room: number): string {
  const ending = '...';
  if (room <= ending.length) return text;
  return `${text.slice(0, room - ending.length).trimEnd()}${ending}`;
}

function chatterLink(linkBaseUrl: string | null): string | null {
  const base = linkBaseUrl?.trim().replace(/\/+$/, '');
  return base || null;
}

function machineLink(machineId: string | undefined, linkBaseUrl: string | null): string | null {
  const base = chatterLink(linkBaseUrl);
  if (base === null || machineId === undefined) return base;
  return `${base}/machine/${encodeURIComponent(machineId)}`;
}

function withLink(link: string | null): string {
  return link === null ? '' : ` ${link}`;
}
