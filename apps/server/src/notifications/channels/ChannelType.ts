import type { AlertSeverity, ChannelTypeInfo, NotificationKind } from '@local-chatter/shared';
import type { z } from 'zod';
import { createLogger } from '../../logging/logger.js';

const log = createLogger('notifications');

/** One message, as a channel type sends it. The times are ISO text. */
export interface OutgoingMessage {
  kind: NotificationKind;
  /** The same text for each channel type, from messageText.ts */
  text: string;
  severity: AlertSeverity | null;
  machine: { id: string; name: string } | null;
  alertName: string | null;
  summary: string | null;
  startedAt: string | null;
  endedAt: string | null;
  link: string | null;
}

export interface SendContext {
  /** Tests give a fake fetch, so no test sends a real message */
  fetch: typeof globalThis.fetch;
  /** Stops the request after the time limit of the sender */
  signal: AbortSignal;
}

/** `error` is for the user, in plain words. `retry` is false when trying again cannot help, for example a wrong login. */
export type SendResult =
  | { ok: true; detail: string }
  | { ok: false; retry: boolean; error: string };

export type SettingsCheck = { ok: true } | { ok: false; error: string };

/**
 * What a developer writes to add a service: one file with one definition, and one line in channels/index.ts.
 * `settings` checks the values of the form, also the secret values. `send` gets only values that passed the check.
 */
export interface ChannelDefinition<Settings> extends ChannelTypeInfo {
  settings: z.ZodType<Settings>;
  send(settings: Settings, message: OutgoingMessage, context: SendContext): Promise<SendResult>;
}

/** A channel type in the list. It checks the saved values itself, so the rest of Chatter does not know their shape. */
export interface ChannelType extends ChannelTypeInfo {
  checkSettings(values: unknown): SettingsCheck;
  /**
   * Never throws. A failure that the channel type did not expect is a failure that Chatter tries again.
   * Its error text goes only to the log, because the text can have a secret in it.
   */
  send(values: unknown, message: OutgoingMessage, context: SendContext): Promise<SendResult>;
}

export function defineChannelType<Settings>(definition: ChannelDefinition<Settings>): ChannelType {
  const { id, name, fields } = definition;
  return {
    id,
    name,
    fields,
    checkSettings(values) {
      const result = definition.settings.safeParse(values);
      return result.success ? { ok: true } : { ok: false, error: firstProblem(result.error) };
    },
    async send(values, message, context) {
      const result = definition.settings.safeParse(values);
      if (!result.success) return { ok: false, retry: false, error: `The channel settings are wrong: ${firstProblem(result.error)}` };
      try {
        return await definition.send(result.data, message, context);
      } catch (error) {
        log.error('A channel type failed in a way that it did not expect', { type: id, error });
        return { ok: false, retry: true, error: `${name} failed in a way that Chatter did not expect. The log has the details.` };
      }
    },
  };
}

/** zod always gives one problem or more when the check fails */
function firstProblem(error: z.ZodError): string {
  return error.issues[0].message;
}
