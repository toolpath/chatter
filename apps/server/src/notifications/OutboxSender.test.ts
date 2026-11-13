import type { NotificationChannel } from '@local-chatter/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureLogging } from '../logging/logger.js';
import type { ChannelForSending } from './ChannelStore.js';
import type { ChannelType, OutgoingMessage, SendContext, SendResult } from './channels/ChannelType.js';
import { Outbox } from './Outbox.js';
import { GIVE_UP_AFTER_MS, OutboxSender, retryWait } from './OutboxSender.js';

const NOW = Date.UTC(2026, 10, 13, 9, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const message: OutgoingMessage = {
  kind: 'started', text: 'CRITICAL - Haas VF-2: In alarm', severity: 'critical', machine: { id: 'haas-vf2', name: 'Haas VF-2' },
  alertName: 'In alarm', summary: null, startedAt: '2026-11-13T09:00:00.000Z', endedAt: null, link: null,
};

const moreAlerts = (count: number): OutgoingMessage => ({ ...message, kind: 'more', text: `And ${count} more alerts.`, machine: null });

/** A channel type that gives the next result of `results`, and keeps what it got */
function fakeType(results: SendResult[]) {
  const calls: { values: unknown; message: OutgoingMessage; context: SendContext }[] = [];
  const type: ChannelType = {
    id: 'fake', name: 'Fake', fields: [],
    checkSettings: () => ({ ok: true }),
    send: async (values, sent, context) => {
      calls.push({ values, message: sent, context });
      return results.shift() ?? { ok: true, detail: 'Sent' };
    },
  };
  return { type, calls };
}

function channel(id: string, enabled = true): NotificationChannel {
  return {
    id, type: 'fake', name: `Channel ${id}`, settings: {}, hasSecret: {}, minSeverity: 'warning',
    machineIds: null, enabled, createdAt: '2026-11-13T09:00:00.000Z',
  };
}

describe('OutboxSender', () => {
  let outbox: Outbox;
  let now: number;
  let logLines: string[];
  let restoreLogging: ReturnType<typeof configureLogging>;

  beforeEach(() => {
    outbox = new Outbox(new Database(':memory:'), moreAlerts);
    now = NOW;
    logLines = [];
    restoreLogging = configureLogging({ sink: (_level, text) => logLines.push(text), level: 'info' });
  });

  afterEach(() => {
    configureLogging(restoreLogging);
  });

  function senderFor(channels: Record<string, ChannelForSending>, timeoutMs?: number): OutboxSender {
    return new OutboxSender(outbox, { forSending: id => channels[id] ?? null }, { now: () => now, timeoutMs });
  }

  function queue(channelId = 'phones'): number {
    return outbox.queue({ channelId, alertId: 7, message }, now);
  }

  function statusOf(id: number) {
    return outbox.list({}).find(row => row.id === id);
  }

  it('sends a due message with the saved values of its channel, and marks it sent', async () => {
    const { type, calls } = fakeType([{ ok: true, detail: 'Sent to 2 phones' }]);
    const id = queue();

    await senderFor({ phones: { channel: channel('phones'), type, values: { to: ['+15559870001'] } } }).sendDue();

    expect(calls).toEqual([{ values: { to: ['+15559870001'] }, message, context: expect.objectContaining({ signal: expect.any(AbortSignal) }) }]);
    expect(statusOf(id)).toMatchObject({ status: 'sent', detail: 'Sent to 2 phones', attempts: 1, sentAt: '2026-11-13T09:00:00.000Z' });
  });

  it('tries again later when the service asks for it, and keeps the error for the message list', async () => {
    const { type } = fakeType([{ ok: false, retry: true, error: 'Twilio did not answer in time.' }]);
    const id = queue();
    const sender = senderFor({ phones: { channel: channel('phones'), type, values: {} } });

    await sender.sendDue();

    expect(statusOf(id)).toMatchObject({ status: 'waiting', attempts: 1, lastError: 'Twilio did not answer in time.' });
    now += retryWait(0) - 1;
    expect(outbox.takeDue(now)).toEqual([]);
    now += 1;
    expect(outbox.takeDue(now)).toHaveLength(1);
  });

  it('waits longer after each failed try, up to 10 minutes', () => {
    expect([0, 1, 2, 3, 4, 20].map(retryWait)).toEqual([30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 10 * MINUTE]);
  });

  it('stops trying when trying again cannot help', async () => {
    const { type } = fakeType([{ ok: false, retry: false, error: 'Twilio does not accept the Account SID and Auth token.' }]);
    const id = queue();

    await senderFor({ phones: { channel: channel('phones'), type, values: {} } }).sendDue();

    expect(statusOf(id)).toMatchObject({ status: 'failed', lastError: 'Twilio does not accept the Account SID and Auth token.' });
    expect(logLines.join('\n')).toContain('Chatter does not try again');
  });

  it('stops trying when the next try would come more than 24 hours after the message was queued', async () => {
    const { type } = fakeType([{ ok: false, retry: true, error: 'Chatter could not reach Twilio.' }]);
    const id = queue();
    now += GIVE_UP_AFTER_MS - retryWait(0);

    await senderFor({ phones: { channel: channel('phones'), type, values: {} } }).sendDue();

    expect(statusOf(id)).toMatchObject({ status: 'failed', lastError: 'Chatter could not reach Twilio.' });
  });

  it('still tries again when the next try comes before the 24 hours end', async () => {
    const { type } = fakeType([{ ok: false, retry: true, error: 'Chatter could not reach Twilio.' }]);
    const id = queue();
    now += GIVE_UP_AFTER_MS - retryWait(0) - 1;

    await senderFor({ phones: { channel: channel('phones'), type, values: {} } }).sendDue();

    expect(statusOf(id)?.status).toBe('waiting');
  });

  it('tries again later when the channel type throws, so the channel is not stuck', async () => {
    const throws: ChannelType = { ...fakeType([]).type, send: () => { throw new Error('broken type'); } };
    const id = queue();

    await senderFor({ phones: { channel: channel('phones'), type: throws, values: {} } }).sendDue();

    expect(statusOf(id)).toMatchObject({ status: 'waiting', lastError: 'Chatter failed in a way that it did not expect. The log has the details.' });
    now += retryWait(0);
    expect(outbox.takeDue(now)).toHaveLength(1);
  });

  it('sends a message one time, also when a new round starts while the first try runs', async () => {
    let answer: (result: SendResult) => void = () => {};
    let tries = 0;
    const slow: ChannelType = { ...fakeType([]).type, send: () => new Promise(resolve => { tries += 1; answer = resolve; }) };
    queue();
    const sender = senderFor({ phones: { channel: channel('phones'), type: slow, values: {} } });

    const first = sender.sendDue();
    await sender.sendDue();
    answer({ ok: true, detail: 'Sent' });
    await first;

    expect(tries).toBe(1);
  });

  it('writes no secret value in the log', async () => {
    const { type } = fakeType([{ ok: false, retry: true, error: 'Twilio did not answer in time.' }]);
    queue();

    await senderFor({ phones: { channel: channel('phones'), type, values: { authToken: 'secret-token' } } }).sendDue();

    expect(logLines.join('\n')).not.toContain('secret-token');
  });

  it('does not send to a channel that was turned off after the message was queued', async () => {
    const { type, calls } = fakeType([]);
    const id = queue();

    await senderFor({ phones: { channel: channel('phones', false), type, values: {} } }).sendDue();

    expect(calls).toEqual([]);
    expect(statusOf(id)).toMatchObject({ status: 'failed', lastError: 'The channel is off, so Chatter did not send the message.' });
  });

  it('does not send when the channel is not there, or its type is not known any more', async () => {
    const id = queue('gone');

    await senderFor({}).sendDue();

    expect(statusOf(id)).toMatchObject({
      status: 'failed', lastError: 'The channel is not there, or this version of Chatter does not know its type.',
    });
  });

  it('stops a try that takes longer than the time limit, and tries again later', async () => {
    const neverAnswers: ChannelType = { ...fakeType([]).type, send: () => new Promise(() => {}) };
    const id = queue();

    await senderFor({ phones: { channel: channel('phones'), type: neverAnswers, values: {} } }, 10).sendDue();

    expect(statusOf(id)).toMatchObject({ status: 'waiting', lastError: 'Fake did not answer in time.' });
  });

  it('aborts the signal of a try that takes too long, so the request stops', async () => {
    let signal: AbortSignal | undefined;
    const slow: ChannelType = { ...fakeType([]).type, send: (_values, _message, context) => {
      signal = context.signal;
      return new Promise(() => {});
    } };
    queue();

    await senderFor({ phones: { channel: channel('phones'), type: slow, values: {} } }, 10).sendDue();

    expect(signal?.aborted).toBe(true);
  });

  it('sends to each channel in the same round', async () => {
    const { type, calls } = fakeType([]);
    queue('phones');
    queue('slack');

    await senderFor({
      phones: { channel: channel('phones'), type, values: {} },
      slack: { channel: channel('slack'), type, values: {} },
    }).sendDue();

    expect(calls).toHaveLength(2);
  });

  it('writes a log line for each sent message', async () => {
    queue();

    await senderFor({ phones: { channel: channel('phones'), type: fakeType([]).type, values: {} } }).sendDue();

    expect(logLines.join('\n')).toMatch(/Notification sent .*channel="Channel phones"/);
  });

  it('waits for the tries that are running when it stops', async () => {
    let answer: (result: SendResult) => void = () => {};
    const waiting: ChannelType = { ...fakeType([]).type, send: () => new Promise(resolve => { answer = resolve; }) };
    const id = queue();
    const sender = senderFor({ phones: { channel: channel('phones'), type: waiting, values: {} } });
    sender.start();
    void sender.sendDue();

    const stopped = sender.stop();
    answer({ ok: true, detail: 'Sent' });
    await stopped;

    expect(statusOf(id)?.status).toBe('sent');
  });
});
