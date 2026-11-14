import type { ChannelInput } from '@local-chatter/shared';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ChannelStore, MAX_CHANNEL_NAME_LENGTH } from './ChannelStore.js';
import { type ChannelType, defineChannelType } from './channels/ChannelType.js';

const NOW = Date.UTC(2026, 10, 13, 9, 0);
const SID = `AC${'0123456789abcdef'.repeat(2)}`;

const twilioInput: ChannelInput = {
  type: 'twilio-sms',
  name: 'Shop phones',
  values: { accountSid: SID, authToken: 'token-one', from: '+15551230000', to: ['+15559870001'] },
  minSeverity: 'critical',
  machineIds: null,
  enabled: true,
};

const webhookInput: ChannelInput = {
  type: 'webhook',
  name: 'Slack #shop-floor',
  values: { url: 'https://hooks.slack.com/services/T0/B0/x', secret: '' },
  minSeverity: 'warning',
  machineIds: ['haas-vf2', 'haas-st10'],
  enabled: true,
};

describe('ChannelStore', () => {
  let db: Database.Database;
  let store: ChannelStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new ChannelStore(db);
  });

  function addedId(input: ChannelInput): string {
    const result = store.add(input, NOW);
    if (!result.ok) throw new Error(result.error);
    return result.channel.id;
  }

  it('saves a channel, and shows it without its secret values', () => {
    const result = store.add(twilioInput, NOW);

    expect(result).toEqual({
      ok: true,
      channel: {
        id: expect.any(String),
        type: 'twilio-sms',
        name: 'Shop phones',
        settings: { accountSid: SID, from: '+15551230000', to: ['+15559870001'] },
        hasSecret: { authToken: true },
        minSeverity: 'critical',
        machineIds: null,
        enabled: true,
        createdAt: '2026-11-13T09:00:00.000Z',
      },
    });
    expect(JSON.stringify(store.list())).not.toContain('token-one');
  });

  it('lists the channels in the order they were added', () => {
    addedId(twilioInput);
    addedId(webhookInput);

    expect(store.list().map(channel => channel.name)).toEqual(['Shop phones', 'Slack #shop-floor']);
  });

  it('keeps the channels after a restart', () => {
    const id = addedId(webhookInput);

    expect(new ChannelStore(db).get(id)?.name).toBe('Slack #shop-floor');
  });

  it('shows that an optional secret is not saved', () => {
    const id = addedId(webhookInput);

    expect(store.get(id)?.hasSecret).toEqual({ secret: false });
  });

  it('trims the name, and drops the values that the channel type does not have', () => {
    const id = addedId({ ...webhookInput, name: '  Slack  ', values: { ...webhookInput.values, extra: 'x' } });

    expect(store.get(id)).toMatchObject({ name: 'Slack', settings: { url: webhookInput.values.url } });
    expect(store.get(id)?.settings).not.toHaveProperty('extra');
  });

  it('keeps each machine one time in the machine list', () => {
    const id = addedId({ ...webhookInput, machineIds: ['haas-vf2', 'haas-vf2', 'haas-st10'] });

    expect(store.get(id)?.machineIds).toEqual(['haas-vf2', 'haas-st10']);
  });

  it.each([
    [{ type: 'carrier-pigeon' }, 'Chatter does not know the channel type "carrier-pigeon"'],
    [{ name: '   ' }, 'Name is necessary'],
    [{ name: 'x'.repeat(MAX_CHANNEL_NAME_LENGTH + 1) }, `Name can have at most ${MAX_CHANNEL_NAME_LENGTH} characters`],
    [{ values: { ...twilioInput.values, to: ['555'] } }, 'Each phone number must start with + and the country code, for example +15559870001'],
    [{ values: { ...twilioInput.values, authToken: '' } }, 'Auth token is necessary'],
  ])('does not save a channel with %o', (change, error) => {
    expect(store.add({ ...twilioInput, ...change }, NOW)).toEqual({ ok: false, error });
    expect(store.list()).toEqual([]);
  });

  describe('update', () => {
    it('changes the channel, and keeps the saved secret when the secret is empty', () => {
      const id = addedId(twilioInput);

      const result = store.update(id, { ...twilioInput, name: 'Night shift', values: { ...twilioInput.values, authToken: '' } });

      expect(result).toMatchObject({ ok: true, channel: { id, name: 'Night shift', hasSecret: { authToken: true } } });
      expect(store.forSending(id)?.values.authToken).toBe('token-one');
    });

    it('changes the secret when the edit has a new one', () => {
      const id = addedId(twilioInput);

      store.update(id, { ...twilioInput, values: { ...twilioInput.values, authToken: 'token-two' } });

      expect(store.forSending(id)?.values.authToken).toBe('token-two');
    });

    it('keeps the time when the channel was added', () => {
      const id = addedId(webhookInput);

      store.update(id, { ...webhookInput, enabled: false });

      expect(store.get(id)).toMatchObject({ enabled: false, createdAt: '2026-11-13T09:00:00.000Z' });
    });

    it('does not keep the secrets of the old type when the type changes', () => {
      const id = addedId(twilioInput);

      store.update(id, webhookInput);

      expect(store.forSending(id)?.values).toEqual({ url: webhookInput.values.url });
      expect(store.get(id)?.hasSecret).toEqual({ secret: false });
    });

    it('keeps the saved secret when the secret is only spaces', () => {
      const id = addedId({ ...webhookInput, values: { ...webhookInput.values, secret: 'old-secret' } });

      store.update(id, { ...webhookInput, values: { ...webhookInput.values, secret: '   ' } });

      expect(store.forSending(id)?.values.secret).toBe('old-secret');
    });

    it('deletes an optional saved secret when the edit asks for it', () => {
      const id = addedId({ ...webhookInput, values: { ...webhookInput.values, secret: 'old-secret' } });

      const result = store.update(id, { ...webhookInput, clearSecrets: ['secret'] });

      expect(result).toMatchObject({ ok: true, channel: { hasSecret: { secret: false } } });
      expect(store.forSending(id)?.values).not.toHaveProperty('secret');
    });

    it('keeps a new secret that the edit has, also when the edit asks to delete the saved secret', () => {
      const id = addedId({ ...webhookInput, values: { ...webhookInput.values, secret: 'old-secret' } });

      store.update(id, { ...webhookInput, values: { ...webhookInput.values, secret: 'new-secret' }, clearSecrets: ['secret'] });

      expect(store.forSending(id)?.values.secret).toBe('new-secret');
    });

    it('does not delete a secret that the channel type needs', () => {
      const id = addedId(twilioInput);

      expect(store.update(id, { ...twilioInput, values: { ...twilioInput.values, authToken: '' }, clearSecrets: ['authToken'] }))
        .toEqual({ ok: false, error: 'Auth token is necessary' });
      expect(store.forSending(id)?.values.authToken).toBe('token-one');
    });

    it('does not change the channel when the edit is wrong', () => {
      const id = addedId(twilioInput);

      expect(store.update(id, { ...twilioInput, name: '' })).toEqual({ ok: false, error: 'Name is necessary' });
      expect(store.get(id)?.name).toBe('Shop phones');
    });

    it('tells when the channel is not there', () => {
      expect(store.update('missing', twilioInput)).toEqual({ ok: false, error: 'The channel is not there. Maybe someone deleted it.' });
    });
  });

  describe('checkInput', () => {
    it('gives the values with the saved secret, so "Send test" works on an edit with an empty secret', () => {
      const id = addedId(twilioInput);

      const result = store.checkInput({ ...twilioInput, values: { ...twilioInput.values, authToken: '' } }, id);

      expect(result).toMatchObject({ ok: true, type: { id: 'twilio-sms' }, values: { authToken: 'token-one' } });
    });

    it('gives the first problem of a form before it is saved', () => {
      expect(store.checkInput({ ...twilioInput, values: { ...twilioInput.values, authToken: '' } }))
        .toEqual({ ok: false, error: 'Auth token is necessary' });
    });
  });

  it('removes a channel', () => {
    const id = addedId(twilioInput);

    expect(store.remove(id)).toBe(true);
    expect(store.get(id)).toBeNull();
    expect(store.remove(id)).toBe(false);
  });

  it('keeps an empty machine list when the last machine of the list is removed, so the channel gets no alerts', () => {
    const id = addedId({ ...webhookInput, machineIds: ['haas-vf2'] });

    store.removeMachine('haas-vf2');

    expect(store.get(id)?.machineIds).toEqual([]);
  });

  it('takes a removed machine out of the machine lists', () => {
    const id = addedId(webhookInput);
    const allMachines = addedId(twilioInput);

    store.removeMachine('haas-vf2');

    expect(store.get(id)?.machineIds).toEqual(['haas-st10']);
    expect(store.get(allMachines)?.machineIds).toBeNull();
  });

  it('gives the type and all the values, with the secrets, for sending', () => {
    const id = addedId(twilioInput);

    const sending = store.forSending(id);

    expect(sending?.type.id).toBe('twilio-sms');
    expect(sending?.values).toEqual(twilioInput.values);
    expect(sending?.channel.name).toBe('Shop phones');
    expect(store.forSending('missing')).toBeNull();
  });

  describe('with other channel types', () => {
    /** A channel type with one secret field, named `secret` */
    function typeWithSecret(id: string): ChannelType {
      return defineChannelType({
        id, name: id, fields: [{ key: 'secret', label: 'Secret', kind: 'secret', required: true }],
        settings: z.object({ secret: z.string({ error: 'Secret is necessary' }).min(1, 'Secret is necessary') }),
        send: async () => ({ ok: true, detail: 'sent' }),
      });
    }

    const types = new Map([['first', typeWithSecret('first')], ['second', typeWithSecret('second')]]);
    const input = (type: string, secret: string): ChannelInput => ({ ...webhookInput, type, values: { secret } });

    it('does not give the secret of the old type to a new type with the same secret name', () => {
      const typed = new ChannelStore(db, id => types.get(id));
      const saved = typed.add(input('first', 'first-secret'), NOW);
      if (!saved.ok) throw new Error(saved.error);

      expect(typed.update(saved.channel.id, input('second', ''))).toEqual({ ok: false, error: 'Secret is necessary' });
    });

    it('still lists a channel whose type Chatter does not know any more, but does not send to it', () => {
      const typed = new ChannelStore(db, id => types.get(id));
      const saved = typed.add(input('first', 'first-secret'), NOW);
      if (!saved.ok) throw new Error(saved.error);
      const afterUpdate = new ChannelStore(db, () => undefined);

      expect(afterUpdate.list()).toEqual([expect.objectContaining({ type: 'first', hasSecret: { secret: true } })]);
      expect(afterUpdate.forSending(saved.channel.id)).toBeNull();
    });
  });
});
