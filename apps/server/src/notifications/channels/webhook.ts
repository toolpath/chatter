import { z } from 'zod';
import type { ChannelDefinition, OutgoingMessage, SendResult } from './ChannelType.js';

const BAD_URL = 'Web address must start with http:// or https://';
const LOGIN_IN_URL = 'Remove the user name and password from the web address. Put a password in Secret.';
const BAD_SECRET = 'Secret can have only plain letters, digits, and signs, with no spaces';

/** fetch refuses a header value with other characters */
const HEADER_SAFE = /^[\x21-\x7e]*$/;

/** The answers that point to another address in the Location header */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const webhookSettings = z.object({
  url: z.string({ error: BAD_URL }).trim()
    .refine(isHttpAddress, BAD_URL)
    // fetch refuses such an address, and its error text would show the password
    .refine(hasNoLogin, LOGIN_IN_URL),
  secret: z.string().trim().regex(HEADER_SAFE, BAD_SECRET).optional(),
});

type WebhookSettings = z.infer<typeof webhookSettings>;

/**
 * Sends each message as JSON to a web address: Slack, ntfy, Home Assistant, or an app of the shop.
 * Slack shows the `text` line. Other apps can read each field.
 */
export const webhookChannel: ChannelDefinition<WebhookSettings> = {
  id: 'webhook',
  name: 'Webhook',
  fields: [
    {
      key: 'url', label: 'Web address', kind: 'url', required: true, mono: true,
      hint: 'For Slack, make an incoming webhook in Slack and paste its address here.',
    },
    {
      key: 'secret', label: 'Secret (optional)', kind: 'secret', required: false, mono: true,
      hint: 'Chatter sends it in the Authorization header, so the other app knows the message is from Chatter.',
    },
  ],
  settings: webhookSettings,
  async send(settings, message, { fetch, signal }) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (settings.secret) headers.authorization = `Bearer ${settings.secret}`;
    try {
      // A redirect would change the POST to a GET, so Chatter does not follow it
      const response = await fetch(settings.url, {
        method: 'POST', headers, body: JSON.stringify(webhookBody(message)), redirect: 'manual', signal,
      });
      // Chatter does not read the answer. A failure to close it must not send the message again.
      response.body?.cancel().catch(() => {});
      return resultOf(response.status);
    } catch (error) {
      return failureToReach(error);
    }
  },
};

function webhookBody(message: OutgoingMessage) {
  return {
    text: message.text,
    state: message.kind,
    level: message.severity,
    machine: message.machine,
    alert: message.alertName,
    summary: message.summary,
    startedAt: message.startedAt,
    endedAt: message.endedAt,
    link: message.link,
  };
}

function resultOf(status: number): SendResult {
  const answered = `The address answered ${status}`;
  if (status >= 200 && status < 300) return { ok: true, detail: answered };
  if (REDIRECTS.has(status)) {
    return { ok: false, retry: false, error: `${answered} and points to another address. Use the new address.` };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { ok: false, retry: true, error: `${answered}. Chatter tries again later.` };
  }
  if (status === 401 || status === 403) return { ok: false, retry: false, error: `${answered}. Check the secret.` };
  return { ok: false, retry: false, error: `${answered}. Check the web address.` };
}

function failureToReach(error: unknown): SendResult {
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { ok: false, retry: true, error: 'The address did not answer in time.' };
  }
  const code = networkCode(error);
  return { ok: false, retry: true, error: code ? `Chatter could not reach the address (${code}).` : 'Chatter could not reach the address.' };
}

/**
 * Node puts the network code, for example ECONNREFUSED, in the cause of "fetch failed".
 * Chatter does not show other error text, because it can have the web address in it.
 */
function networkCode(error: unknown): string | null {
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === 'string' ? cause.code : null;
}

/** True also for text that is not a web address, because isHttpAddress refuses that text */
function hasNoLogin(text: string): boolean {
  if (!URL.canParse(text)) return true;
  const { username, password } = new URL(text);
  return !username && !password;
}

function isHttpAddress(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
