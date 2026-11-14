import { createLogger } from '../logging/logger.js';
import type { ChannelForSending } from './ChannelStore.js';
import type { ChannelType, OutgoingMessage, SendContext, SendResult } from './channels/ChannelType.js';
import type { Outbox, OutboxEntry } from './Outbox.js';

const log = createLogger('notifications');

/** How often the sender looks for messages to send */
export const SEND_INTERVAL_MS = 5_000;
/** A try that takes longer than this stops, and Chatter tries again later */
export const SEND_TIMEOUT_MS = 10_000;
/** Chatter stops trying this long after it queued the message */
export const GIVE_UP_AFTER_MS = 24 * 60 * 60_000;

/** The waits after the first failed tries. Each later wait is the last one. */
const RETRY_WAITS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000];

/** The wait before the next try, after `attempts` earlier tries failed */
export function retryWait(attempts: number): number {
  return RETRY_WAITS_MS[Math.min(attempts, RETRY_WAITS_MS.length - 1)];
}

/**
 * One try, which always ends: after `timeoutMs`, the signal stops the request, and the result is a failure to try again.
 * A channel type can forget the signal, so a race with the timer makes sure.
 */
export function sendWithTimeLimit(
  { type, values }: Pick<ChannelForSending, 'type' | 'values'>,
  message: OutgoingMessage,
  { fetch, timeoutMs }: { fetch: SendContext['fetch']; timeoutMs: number },
): Promise<SendResult> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeUp = new Promise<SendResult>(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(timeoutFailure(type));
    }, timeoutMs);
  });
  // The async function turns an error that send throws into a failed promise, so the timer always stops
  const sent = (async () => type.send(values, message, { fetch, signal: controller.signal }))();
  return Promise.race([sent, timeUp]).finally(() => clearTimeout(timer));
}

export interface ChannelSource {
  forSending(id: string): ChannelForSending | null;
}

export interface SenderOptions {
  now?: () => number;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * Sends the messages of the outbox: every 5 seconds, the first due message of each channel.
 * A failed try that can help is tried again later, with longer waits. After 24 hours, Chatter stops trying.
 */
export class OutboxSender {
  private timer: NodeJS.Timeout | undefined;
  private readonly running = new Set<Promise<void>>();
  private readonly now: () => number;
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly outbox: Outbox,
    private readonly channels: ChannelSource,
    { now = Date.now, fetch = globalThis.fetch, timeoutMs = SEND_TIMEOUT_MS }: SenderOptions = {},
  ) {
    this.now = now;
    this.fetch = fetch;
    this.timeoutMs = timeoutMs;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sendDue().catch(error => log.error('Could not send the notifications', { error }));
    }, SEND_INTERVAL_MS);
  }

  /** Waits for the tries that are running, so their results are saved before the database closes */
  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all(this.running);
  }

  /** Starts one try for each due message. Resolves when these tries end. */
  async sendDue(): Promise<void> {
    const tries = this.outbox.takeDue(this.now()).map(entry => this.track(this.tryToSend(entry)));
    await Promise.all(tries);
  }

  private track(attempt: Promise<void>): Promise<void> {
    this.running.add(attempt);
    return attempt.finally(() => this.running.delete(attempt));
  }

  private async tryToSend(entry: OutboxEntry): Promise<void> {
    try {
      const target = this.channels.forSending(entry.channelId);
      if (!target) return this.fail(entry, null, 'The channel is not there, or this version of Chatter does not know its type.');
      if (!target.channel.enabled) return this.fail(entry, target, 'The channel is off, so Chatter did not send the message.');
      const result = await sendWithTimeLimit(target, entry.message, { fetch: this.fetch, timeoutMs: this.timeoutMs });
      this.saveResult(entry, target, result);
    } catch (error) {
      this.recoverFrom(entry, error);
    }
  }

  /** Without a result, the message stays "being sent", and the channel gets no more messages until a restart */
  private recoverFrom(entry: OutboxEntry, error: unknown): void {
    log.error('A notification failed in a way that Chatter did not expect', { message: entry.id, error });
    try {
      this.saveResult(entry, null, { ok: false, retry: true, error: 'Chatter failed in a way that it did not expect. The log has the details.' });
    } catch (saveError) {
      log.error('Could not save the result of a notification', { message: entry.id, error: saveError });
    }
  }

  /** A retry that would come after the 24 hours is a failure now */
  private saveResult(entry: OutboxEntry, target: ChannelForSending | null, result: SendResult): void {
    const now = this.now();
    const nextTryAt = now + retryWait(entry.attempts);
    if (result.ok) {
      this.outbox.markSent(entry.id, result.detail, now);
      log.info('Notification sent', { ...logFields(entry, target), detail: result.detail });
    } else if (result.retry && nextTryAt < entry.createdAt + GIVE_UP_AFTER_MS) {
      this.outbox.markRetry(entry.id, result.error, nextTryAt);
      log.warn('Notification not sent. Chatter tries again', { ...logFields(entry, target), error: result.error, waitSeconds: (nextTryAt - now) / 1000 });
    } else {
      this.fail(entry, target, result.error);
    }
  }

  private fail(entry: OutboxEntry, target: ChannelForSending | null, error: string): void {
    this.outbox.markFailed(entry.id, error);
    log.warn('Notification not sent. Chatter does not try again', { ...logFields(entry, target), error });
  }
}

function timeoutFailure(type: ChannelType): SendResult {
  return { ok: false, retry: true, error: `${type.name} did not answer in time.` };
}

function logFields(entry: OutboxEntry, target: ChannelForSending | null) {
  return { message: entry.id, kind: entry.message.kind, channel: target?.channel.name ?? entry.channelId, attempt: entry.attempts + 1 };
}
