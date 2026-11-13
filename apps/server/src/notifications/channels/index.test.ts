import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineChannelType, type OutgoingMessage, type SendContext } from './ChannelType.js';
import { channelTypeInfos, findChannelType } from './index.js';

const MESSAGE: OutgoingMessage = {
  kind: 'test', text: 'Test from Chatter.', severity: null, machine: null,
  alertName: null, summary: null, startedAt: null, endedAt: null, link: null,
};
const CONTEXT: SendContext = { fetch: globalThis.fetch, signal: new AbortController().signal };

const echoChannel = defineChannelType({
  id: 'echo',
  name: 'Echo',
  fields: [{ key: 'to', label: 'To', kind: 'text', required: true }],
  settings: z.object({ to: z.string({ error: 'To is necessary' }).min(1, 'To is necessary') }),
  send: async (settings, message) => ({ ok: true, detail: `${message.text} to ${settings.to}` }),
});

describe('defineChannelType', () => {
  it('sends with the settings after it checks them', async () => {
    expect(await echoChannel.send({ to: 'shop' }, MESSAGE, CONTEXT)).toEqual({ ok: true, detail: 'Test from Chatter. to shop' });
  });

  it('does not send, and does not try again, when the saved settings are wrong', async () => {
    expect(await echoChannel.send({ to: '' }, MESSAGE, CONTEXT))
      .toEqual({ ok: false, retry: false, error: 'The channel settings are wrong: To is necessary' });
  });

  it('checks the settings of a form, and gives the first problem', () => {
    expect(echoChannel.checkSettings({ to: 'shop' })).toEqual({ ok: true });
    expect(echoChannel.checkSettings({})).toEqual({ ok: false, error: 'To is necessary' });
  });

  it('gives a failure that Chatter tries again, without the error text, when the channel type fails in a way it did not expect', async () => {
    const broken = defineChannelType({
      id: 'broken', name: 'Broken', fields: [], settings: z.object({}),
      send: async () => { throw new Error('oops'); },
    });

    expect(await broken.send({}, MESSAGE, CONTEXT))
      .toEqual({ ok: false, retry: true, error: 'Broken failed in a way that Chatter did not expect. The log has the details.' });
  });
});

describe('channel types', () => {
  it('has the Twilio text message type first, and then the webhook type', () => {
    expect(channelTypeInfos().map(type => type.id)).toEqual(['twilio-sms', 'webhook']);
  });

  it('lists each type with its fields, for the form of the web app', () => {
    const webhook = channelTypeInfos().find(type => type.id === 'webhook');

    expect(webhook).toEqual({ id: 'webhook', name: 'Webhook', fields: expect.any(Array) });
    expect(webhook?.fields.map(field => field.key)).toEqual(['url', 'secret']);
  });

  it('finds a type by its id, and gives nothing for an id that it does not know', () => {
    expect(findChannelType('webhook')?.name).toBe('Webhook');
    expect(findChannelType('carrier-pigeon')).toBeUndefined();
  });
});
