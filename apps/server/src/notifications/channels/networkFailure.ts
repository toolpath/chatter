import type { SendResult } from './ChannelType.js';

/**
 * The result when fetch throws: the time limit ended, or Chatter could not reach the service.
 * Chatter tries again later in both cases. `target` names the service in the text, for example "Twilio".
 * The text shows only the network code, because other error text can have the web address in it.
 */
export function networkFailure(error: unknown, target: string): Extract<SendResult, { ok: false }> {
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return { ok: false, retry: true, error: `${capitalized(target)} did not answer in time.` };
  }
  const code = networkCode(error);
  return { ok: false, retry: true, error: `Chatter could not reach ${target}${code ? ` (${code})` : ''}.` };
}

/** Node puts the network code, for example ECONNREFUSED, in the cause of "fetch failed" */
function networkCode(error: unknown): string | null {
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === 'string' ? cause.code : null;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
