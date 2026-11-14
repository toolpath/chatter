import { isPhoneNumber } from '@local-chatter/shared';
import { z } from 'zod';
import type { ChannelDefinition, OutgoingMessage, SendContext, SendResult } from './ChannelType.js';
import { networkFailure } from './networkFailure.js';

export const TWILIO_API = 'https://api.twilio.com';
const THIS_COMPUTER = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The Twilio address that Chatter uses, and a line for the log when it is not the real Twilio */
export interface TwilioAddress {
  url: string;
  warning: string | null;
}

/**
 * The address of the Twilio API from TWILIO_API_URL, for a fake Twilio in development.
 * Chatter sends the auth token to this address. So it takes only https, or plain http on this computer.
 */
export function twilioAddressOf(value: string | undefined): TwilioAddress {
  const url = value?.trim() ?? '';
  if (!url) return { url: TWILIO_API, warning: null };
  if (!isSafeForTheToken(url)) {
    return { url: TWILIO_API, warning: 'Chatter does not use TWILIO_API_URL: it must start with https://, or be http:// on this computer. Text messages go to Twilio.' };
  }
  return { url, warning: `Text messages go to ${url} (TWILIO_API_URL), not to Twilio` };
}

function isSafeForTheToken(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { protocol, hostname } = new URL(url);
  return protocol === 'https:' || (protocol === 'http:' && THIS_COMPUTER.has(hostname));
}
export const MAX_PHONES = 20;

const twilioSettings = z.object({
  accountSid: z.string({ error: 'Account SID is necessary' }).trim()
    .regex(/^AC[0-9a-fA-F]{32}$/, 'Account SID starts with AC and has 34 characters'),
  authToken: z.string({ error: 'Auth token is necessary' }).trim().min(1, 'Auth token is necessary'),
  from: z.string({ error: 'From number is necessary' }).trim()
    .refine(isPhoneNumber, 'From number must start with + and the country code, for example +15551230000'),
  to: z.array(
    z.string().trim().refine(isPhoneNumber, 'Each phone number must start with + and the country code, for example +15559870001'),
    { error: 'Add one phone number or more' },
  ).min(1, 'Add one phone number or more').max(MAX_PHONES, `Add at most ${MAX_PHONES} phone numbers`),
});

type TwilioSettings = z.infer<typeof twilioSettings>;

/** What Twilio says when it refuses a message. `code` is the Twilio error code. */
interface TwilioError {
  code?: number;
}

/** The result for one phone. `cause` tells what went wrong, but not what Chatter does next. */
type PhoneResult = { ok: true } | { ok: false; retry: boolean; cause: string };

/** The Twilio error codes that the user can fix, from https://www.twilio.com/docs/api/errors */
const REFUSALS: Record<number, (phone: string) => string> = {
  20003: () => 'Twilio refused the login. Check the Account SID and the auth token.',
  20404: () => 'Twilio does not know this Account SID. Check the Account SID.',
  21211: phone => `${phone} is not a phone number that Twilio can send to. Check the number.`,
  21606: () => 'The From number cannot send text messages for this Twilio account. Use an SMS number of your account.',
  21608: phone => `${phone} is not verified. A Twilio trial account sends only to numbers that you verify in Twilio.`,
  21610: phone => `${phone} sent STOP to your Twilio number, so Twilio does not send to it. The phone can send START to get texts again.`,
  21408: phone => `Your Twilio account cannot send to the country of ${phone}. Turn on the country in the Twilio Messaging Geo Permissions.`,
  572006: () => 'A Twilio trial account can send only the message templates of Twilio, not the messages of Chatter. Upgrade the Twilio account.',
};

/**
 * Sends each message as a text message to each phone, with the Twilio REST API. It uses no Twilio library,
 * so the image stays small. `apiBase` is the Twilio address. Development can give the address of a fake Twilio.
 */
export function createTwilioChannel(apiBase: string): ChannelDefinition<TwilioSettings> {
  const base = apiBase.replace(/\/+$/, '');
  return {
    id: 'twilio-sms',
    name: 'Text message (Twilio)',
    fields: [
      { key: 'accountSid', label: 'Account SID', kind: 'text', required: true, mono: true },
      {
        key: 'authToken', label: 'Auth token', kind: 'secret', required: true, mono: true,
        hint: 'Chatter keeps the token secret. After you save, it never shows the token again.',
      },
      {
        key: 'from', label: 'From number', kind: 'text', required: true, mono: true,
        hint: 'Your Twilio number. Start with + and the country code.',
      },
      { key: 'to', label: 'Phone numbers', kind: 'phone-list', required: true, mono: true },
    ],
    note: 'A Twilio trial account cannot send the messages of Chatter. Upgrade the account first. '
      + 'In the US, Twilio delivers the messages of a normal number only after you register the number for A2P 10DLC. '
      + 'Before that, Chatter shows Sent, but the phones get nothing. The Twilio message logs then show error 30034.',
    settings: twilioSettings,
    // All the phones at the same time, so a slow answer does not use the time limit of the other phones
    async send(settings, message, context) {
      return combined(await Promise.all(settings.to.map(phone => sendOne(base, settings, phone, message, context))));
    },
  };
}

async function sendOne(
  base: string, settings: TwilioSettings, phone: string, message: OutgoingMessage, { fetch, signal }: SendContext,
): Promise<PhoneResult> {
  const login = Buffer.from(`${settings.accountSid}:${settings.authToken}`).toString('base64');
  try {
    const response = await fetch(`${base}/2010-04-01/Accounts/${settings.accountSid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${login}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: phone, From: settings.from, Body: message.text }),
      signal,
    });
    if (response.ok) {
      response.body?.cancel().catch(() => {});
      return { ok: true };
    }
    return refusal(response.status, await twilioError(response), phone);
  } catch (error) {
    const { retry, error: cause } = networkFailure(error, 'Twilio');
    return { ok: false, retry, cause };
  }
}

async function twilioError(response: Response): Promise<TwilioError> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? (body as TwilioError) : {};
  } catch {
    return {};
  }
}

function refusal(status: number, { code }: TwilioError, phone: string): PhoneResult {
  const known = status === 401 ? REFUSALS[20003] : code === undefined ? undefined : REFUSALS[code];
  if (known) return { ok: false, retry: false, cause: known(phone) };
  if (status === 429 || status >= 500) return { ok: false, retry: true, cause: `Twilio answered ${status}.` };
  return { ok: false, retry: false, cause: `Twilio refused the message to ${phone} (${code ? `error ${code}` : `answer ${status}`}).` };
}

/**
 * One result for all the phones. When some phones got the message, Chatter does not try again,
 * because then those phones would get the message two times.
 */
function combined(results: PhoneResult[]): SendResult {
  const failures = results.filter((result): result is Extract<PhoneResult, { ok: false }> => !result.ok);
  const sentCount = results.length - failures.length;
  if (failures.length === 0) return { ok: true, detail: `Sent to ${phones(sentCount)}` };
  const causes = [...new Set(failures.map(failure => failure.cause))].join(' ');
  if (sentCount > 0) {
    return {
      ok: false, retry: false,
      error: `Sent to ${sentCount} of ${phones(results.length)}. ${causes} Chatter does not try again, so no phone gets the message two times.`,
    };
  }
  const retry = failures.some(failure => failure.retry);
  return { ok: false, retry, error: retry ? `${causes} Chatter tries again later.` : causes };
}

function phones(count: number): string {
  return `${count} ${count === 1 ? 'phone' : 'phones'}`;
}
