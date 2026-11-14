import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OutgoingMessage } from './channels/ChannelType.js';
import { MAX_KEPT_MESSAGES, Outbox, type OutboxEntry, SEND_LIMIT, SEND_LIMIT_WINDOW_MS } from './Outbox.js';

const NOW = Date.UTC(2026, 10, 13, 9, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function alertMessage(kind: 'started' | 'ended' | 'combined', machineId = 'haas-vf2'): OutgoingMessage {
  return {
    kind, text: `${kind} - Haas VF-2: In alarm`, severity: 'critical', machine: { id: machineId, name: 'Haas VF-2' },
    alertName: 'In alarm', summary: 'In alarm', startedAt: '2026-11-13T09:00:00.000Z', endedAt: null, link: null,
  };
}

function moreAlerts(count: number): OutgoingMessage {
  return {
    kind: 'more', text: `And ${count} more alerts.`, severity: null, machine: null,
    alertName: null, summary: null, startedAt: null, endedAt: null, link: null,
  };
}

describe('Outbox', () => {
  let db: Database.Database;
  let outbox: Outbox;

  beforeEach(() => {
    db = new Database(':memory:');
    outbox = new Outbox(db, moreAlerts);
  });

  function queue(channelId: string, alertId: number | null, message = alertMessage('started'), now = NOW): number {
    return outbox.queue({ channelId, alertId, message }, now);
  }

  /** Queues and sends `count` messages, the first at `now`, and each next one `gap` later */
  function sendMessages(channelId: string, count: number, now: number, gap = 0): void {
    for (let index = 0; index < count; index += 1) {
      const time = now + index * gap;
      const id = queue(channelId, null, alertMessage('started'), time);
      if (!outbox.takeDue(time).some(entry => entry.id === id)) throw new Error(`Message ${id} was not due`);
      outbox.markSent(id, 'Sent to 1 phone', time);
    }
  }

  function texts(entries: OutboxEntry[]): string[] {
    return entries.map(entry => entry.message.text);
  }

  it('keeps the result of a test in the list, and never gives the test to the sender', () => {
    const test = { ...moreAlerts(0), kind: 'test' as const, text: 'Test from Chatter.' };

    outbox.keepTestResult('phones', test, { ok: true, detail: 'Sent to 1 phone' }, NOW);
    outbox.keepTestResult('slack', test, { ok: false, error: 'Slack says the address is wrong.' }, NOW);

    expect(outbox.takeDue(NOW)).toEqual([]);
    expect(outbox.list({}).map(({ channelId, kind, status, detail, lastError }) => ({ channelId, kind, status, detail, lastError }))).toEqual([
      { channelId: 'slack', kind: 'test', status: 'failed', detail: null, lastError: 'Slack says the address is wrong.' },
      { channelId: 'phones', kind: 'test', status: 'sent', detail: 'Sent to 1 phone', lastError: null },
    ]);
  });

  it('gives a queued message to the sender, and shows it as waiting', () => {
    const id = queue('phones', 7);

    expect(outbox.takeDue(NOW)).toEqual([{ id, channelId: 'phones', message: alertMessage('started'), attempts: 0, createdAt: NOW }]);
    expect(outbox.list({})).toEqual([{
      id, channelId: 'phones', alertId: 7, kind: 'started', machineId: 'haas-vf2', severity: 'critical',
      text: 'started - Haas VF-2: In alarm', status: 'waiting', attempts: 0, lastError: null, detail: null,
      createdAt: '2026-11-13T09:00:00.000Z', sentAt: null,
    }]);
  });

  it('gives at most one message for each channel, the oldest first', () => {
    queue('phones', 1, alertMessage('started'));
    queue('phones', 2, alertMessage('ended'));
    queue('slack', 3, alertMessage('combined'));

    expect(texts(outbox.takeDue(NOW)).sort()).toEqual(['combined - Haas VF-2: In alarm', 'started - Haas VF-2: In alarm']);
  });

  it('does not give the next message of a channel while its message is being sent', () => {
    queue('phones', 1, alertMessage('started'));
    queue('phones', 2, alertMessage('ended'));
    const [first] = outbox.takeDue(NOW);

    expect(outbox.takeDue(NOW)).toEqual([]);

    outbox.markSent(first.id, 'Sent to 1 phone', NOW);
    expect(texts(outbox.takeDue(NOW))).toEqual(['ended - Haas VF-2: In alarm']);
  });

  it('marks a sent message, with the time and what the service said', () => {
    const id = queue('phones', 1);
    outbox.takeDue(NOW);

    outbox.markSent(id, 'Sent to 2 phones', NOW + 5_000);

    expect(outbox.list({})[0]).toMatchObject({
      status: 'sent', attempts: 1, detail: 'Sent to 2 phones', sentAt: '2026-11-13T09:00:05.000Z',
    });
    expect(outbox.takeDue(NOW + 5_000)).toEqual([]);
  });

  it('gives a message again at the time of its next try, and keeps the next messages of the channel behind it', () => {
    const id = queue('phones', 1, alertMessage('started'));
    queue('phones', 2, alertMessage('ended'));
    outbox.takeDue(NOW);

    outbox.markRetry(id, 'Twilio answered 503.', NOW + 30_000);

    expect(outbox.takeDue(NOW + 29_999)).toEqual([]);
    expect(outbox.takeDue(NOW + 30_000)).toEqual([expect.objectContaining({ id, attempts: 1 })]);
    expect(outbox.list({}).find(message => message.id === id)).toMatchObject({ status: 'waiting', lastError: 'Twilio answered 503.' });
  });

  it('marks a message that failed, and then gives the next message of the channel', () => {
    const id = queue('phones', 1, alertMessage('started'));
    queue('phones', 2, alertMessage('ended'));
    outbox.takeDue(NOW);

    outbox.markFailed(id, 'Twilio refused the login.');

    expect(outbox.list({}).find(message => message.id === id)).toMatchObject({ status: 'failed', attempts: 1, lastError: 'Twilio refused the login.' });
    expect(texts(outbox.takeDue(NOW))).toEqual(['ended - Haas VF-2: In alarm']);
  });

  it('gives a message again after a restart, when Chatter stopped while it was sending the message', () => {
    const id = queue('phones', 1);
    outbox.takeDue(NOW);

    const afterRestart = new Outbox(db, moreAlerts);

    expect(afterRestart.takeDue(NOW)).toEqual([expect.objectContaining({ id })]);
  });

  describe('combineWithWaitingStart', () => {
    it('changes a waiting start message into one message that tells the start and the end', () => {
      const id = queue('phones', 7, alertMessage('started'));

      expect(outbox.combineWithWaitingStart('phones', 7, alertMessage('combined'))).toBe(true);

      expect(outbox.list({})).toEqual([expect.objectContaining({ id, kind: 'combined', text: 'combined - Haas VF-2: In alarm' })]);
      expect(outbox.takeDue(NOW)[0].message).toEqual(alertMessage('combined'));
    });

    it('does not change a start message that was sent, or that is being sent', () => {
      const sent = queue('phones', 7);
      outbox.takeDue(NOW);
      outbox.markSent(sent, 'Sent to 1 phone', NOW);
      queue('slack', 8);
      outbox.takeDue(NOW);

      expect(outbox.combineWithWaitingStart('phones', 7, alertMessage('combined'))).toBe(false);
      expect(outbox.combineWithWaitingStart('slack', 8, alertMessage('combined'))).toBe(false);
    });

    it('changes only the start message of that channel and that alert', () => {
      queue('phones', 7);

      expect(outbox.combineWithWaitingStart('slack', 7, alertMessage('combined'))).toBe(false);
      expect(outbox.combineWithWaitingStart('phones', 8, alertMessage('combined'))).toBe(false);
    });
  });

  describe('hasStartMessage', () => {
    it('is true when the channel got the start message of the alert, also when it waits, failed, or went in a "more" message', () => {
      queue('waiting', 1);
      const failed = queue('failed', 1);
      outbox.takeDue(NOW);
      outbox.markFailed(failed, 'Twilio refused the login.');
      sendMessages('grouped', SEND_LIMIT - 1, NOW);
      [1, 2].forEach(alertId => queue('grouped', alertId, alertMessage('started'), NOW + MINUTE));
      outbox.takeDue(NOW + MINUTE);

      expect(outbox.hasStartMessage('waiting', 1)).toBe(true);
      expect(outbox.hasStartMessage('failed', 1)).toBe(true);
      expect(outbox.list({ channelId: 'grouped' }).find(message => message.alertId === 1)?.status).toBe('grouped');
      expect(outbox.hasStartMessage('grouped', 1)).toBe(true);
    });

    it('is false for another channel or another alert', () => {
      queue('phones', 1);

      expect(outbox.hasStartMessage('slack', 1)).toBe(false);
      expect(outbox.hasStartMessage('phones', 2)).toBe(false);
    });
  });

  describe(`the limit of ${SEND_LIMIT} messages in 10 minutes`, () => {
    it('holds the messages of a channel at its limit, until the oldest sent message is 10 minutes old', () => {
      sendMessages('phones', SEND_LIMIT, NOW);
      queue('phones', 1, alertMessage('ended'), NOW + MINUTE);
      queue('slack', 2, alertMessage('combined'), NOW + MINUTE);

      expect(texts(outbox.takeDue(NOW + MINUTE))).toEqual(['combined - Haas VF-2: In alarm']);
      expect(outbox.takeDue(NOW + SEND_LIMIT_WINDOW_MS - 1)).toEqual([]);
      expect(texts(outbox.takeDue(NOW + SEND_LIMIT_WINDOW_MS))).toEqual(['ended - Haas VF-2: In alarm']);
    });

    it('sends one "more" message in place of the waiting messages, when the channel has room for only one message', () => {
      sendMessages('phones', SEND_LIMIT - 1, NOW);
      const waiting = [1, 2, 3].map(alertId => queue('phones', alertId, alertMessage('started'), NOW + MINUTE));

      const due = outbox.takeDue(NOW + MINUTE);

      expect(due).toEqual([expect.objectContaining({ channelId: 'phones', message: moreAlerts(3), attempts: 0 })]);
      const listed = outbox.list({});
      expect(listed.filter(message => waiting.includes(message.id))).toEqual(waiting.map(() => expect.objectContaining({
        status: 'grouped', detail: `Grouped with 2 more messages, because a channel gets at most ${SEND_LIMIT} messages in 10 minutes.`,
      })));
      expect(listed[0]).toMatchObject({ id: due[0].id, kind: 'more', status: 'waiting', alertId: null, machineId: null });
    });

    it('says "message" when one other message went in the "more" message', () => {
      sendMessages('phones', SEND_LIMIT - 1, NOW);
      [1, 2].forEach(alertId => queue('phones', alertId, alertMessage('started'), NOW + MINUTE));

      outbox.takeDue(NOW + MINUTE);

      expect(outbox.list({}).find(message => message.alertId === 1)?.detail)
        .toBe(`Grouped with 1 more message, because a channel gets at most ${SEND_LIMIT} messages in 10 minutes.`);
    });

    it('keeps sending each message as it is while the channel has room for two or more', () => {
      sendMessages('phones', SEND_LIMIT - 2, NOW);
      [1, 2, 3].forEach(alertId => queue('phones', alertId, alertMessage('started'), NOW + MINUTE));

      expect(outbox.takeDue(NOW + MINUTE)).toEqual([expect.objectContaining({ message: alertMessage('started') })]);
    });

    it('counts the start and the end of one alert as one alert', () => {
      sendMessages('phones', SEND_LIMIT - 1, NOW);
      queue('phones', 1, alertMessage('started'), NOW + MINUTE);
      queue('phones', 2, alertMessage('started'), NOW + MINUTE);
      queue('phones', 1, alertMessage('ended'), NOW + MINUTE);

      expect(outbox.takeDue(NOW + MINUTE)[0].message).toEqual(moreAlerts(2));
    });

    it('adds the alerts of a "more" message that waits to the next "more" message', () => {
      sendMessages('phones', SEND_LIMIT - 1, NOW);
      [1, 2, 3].forEach(alertId => queue('phones', alertId, alertMessage('started'), NOW + MINUTE));
      const [more] = outbox.takeDue(NOW + MINUTE);
      outbox.markRetry(more.id, 'Twilio answered 503.', NOW + 2 * MINUTE);
      [4, 5].forEach(alertId => queue('phones', alertId, alertMessage('started'), NOW + 2 * MINUTE));

      expect(outbox.takeDue(NOW + 2 * MINUTE)[0].message).toEqual(moreAlerts(5));
    });

    it('does not put a test message into a "more" message', () => {
      sendMessages('phones', SEND_LIMIT - 1, NOW);
      const test = queue('phones', null, { ...moreAlerts(0), kind: 'test', text: 'Test from Chatter.' }, NOW + MINUTE);
      [1, 2].forEach(alertId => queue('phones', alertId, alertMessage('started'), NOW + MINUTE));

      expect(outbox.takeDue(NOW + MINUTE)[0].message).toEqual(moreAlerts(2));
      expect(outbox.list({}).find(message => message.id === test)?.status).toBe('waiting');
    });

    it('sends the last message as it is, when only one message waits', () => {
      sendMessages('phones', SEND_LIMIT - 1, NOW);
      queue('phones', 1, alertMessage('ended'), NOW + MINUTE);

      expect(texts(outbox.takeDue(NOW + MINUTE))).toEqual(['ended - Haas VF-2: In alarm']);
    });

    it('does not count the messages that failed', () => {
      for (let index = 0; index < SEND_LIMIT; index += 1) {
        const id = queue('phones', index);
        outbox.takeDue(NOW);
        outbox.markFailed(id, 'Twilio refused the login.');
      }
      queue('phones', 99, alertMessage('ended'));

      expect(texts(outbox.takeDue(NOW))).toEqual(['ended - Haas VF-2: In alarm']);
    });
  });

  describe('cleanUp', () => {
    it(`deletes the finished messages that are older than 30 days, and keeps the waiting messages`, () => {
      sendMessages('phones', 1, NOW - 31 * DAY);
      queue('slack', 1, alertMessage('started'), NOW - 31 * DAY);
      sendMessages('phones', 1, NOW - 29 * DAY);

      outbox.cleanUp(NOW);

      expect(outbox.list({}).map(message => [message.status, message.createdAt])).toEqual([
        ['sent', new Date(NOW - 29 * DAY).toISOString()],
        ['waiting', new Date(NOW - 31 * DAY).toISOString()],
      ]);
    });

    it(`keeps at most ${MAX_KEPT_MESSAGES} finished messages, the newest`, () => {
      sendMessages('phones', MAX_KEPT_MESSAGES + 2, NOW, SEND_LIMIT_WINDOW_MS);
      const newest = outbox.list({})[0].id;

      outbox.cleanUp(NOW);

      const kept = outbox.list({});
      expect(kept).toHaveLength(MAX_KEPT_MESSAGES);
      expect(kept[0].id).toBe(newest);
    });
  });

  it('deletes the waiting messages of a removed channel, and keeps its finished messages', () => {
    sendMessages('phones', 1, NOW);
    queue('phones', 2);
    queue('slack', 3);

    outbox.removeChannel('phones');

    expect(outbox.list({}).map(message => [message.channelId, message.status]).sort()).toEqual([['phones', 'sent'], ['slack', 'waiting']]);
  });

  it('deletes the waiting messages of a removed machine', () => {
    queue('phones', 1, alertMessage('started', 'haas-vf2'));
    queue('phones', 2, alertMessage('started', 'haas-st10'));

    outbox.removeMachine('haas-vf2');

    expect(outbox.list({}).map(message => message.machineId)).toEqual(['haas-st10']);
  });

  it('lists the messages of one channel, or since a time, the newest first', () => {
    queue('phones', 1, alertMessage('started'), NOW - 2 * DAY);
    queue('slack', 2, alertMessage('started'), NOW - MINUTE);
    queue('phones', 3, alertMessage('ended'), NOW);

    expect(outbox.list({ channelId: 'phones' }).map(message => message.alertId)).toEqual([3, 1]);
    expect(outbox.list({ since: NOW - DAY }).map(message => message.alertId)).toEqual([3, 2]);
  });
});
