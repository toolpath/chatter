import { describe, expect, it } from 'vitest';
import type { ChannelTypeInfo, NotificationChannel } from '../../api/notifications';
import { channelInputOf, editChannelForm, newChannelForm, secretsToTypeAgain, withType } from './channelFormState';

const twilio: ChannelTypeInfo = {
  id: 'twilio-sms', name: 'Text message (Twilio)', fields: [
    { key: 'accountSid', label: 'Account SID', kind: 'text', required: true },
    { key: 'authToken', label: 'Auth token', kind: 'secret', required: true },
    { key: 'to', label: 'Phone numbers', kind: 'phone-list', required: true },
  ],
};

const webhook: ChannelTypeInfo = {
  id: 'webhook', name: 'Webhook', fields: [
    { key: 'url', label: 'Web address', kind: 'url', required: true },
    { key: 'secret', label: 'Secret (optional)', kind: 'secret', required: false },
  ],
};

const slack: NotificationChannel = {
  id: 'slack', type: 'webhook', name: 'Slack', settings: { url: 'https://hooks.slack.com/x' }, hasSecret: { secret: true },
  minSeverity: 'critical', machineIds: ['haas-vf2'], ignorePatterns: [], enabled: false, createdAt: '2026-11-13T09:00:00.000Z',
};

describe('newChannelForm', () => {
  it('fills each field that has a default', () => {
    const telegram: ChannelTypeInfo = {
      id: 'telegram', name: 'Telegram', fields: [
        { key: 'chatId', label: 'Chat ID', kind: 'text', required: true },
        { key: 'sound', label: 'Notification sound', kind: 'choice', required: false, default: 'normal', options: [{ value: 'normal', label: 'Normal' }] },
      ],
    };

    expect(newChannelForm(telegram).values).toEqual({ chatId: '', sound: 'normal' });
  });

  it('starts empty, on, for all machines and warning alerts, with one phone box', () => {
    expect(newChannelForm(twilio)).toEqual({
      type: 'twilio-sms', name: '', values: { accountSid: '', authToken: '', to: [''] }, clearSecrets: [],
      minSeverity: 'warning', machineIds: null, ignorePatterns: [''], enabled: true,
    });
  });
});

describe('editChannelForm', () => {
  it('starts with the saved values and an empty secret, so the server keeps the saved one', () => {
    expect(editChannelForm(slack, webhook)).toEqual({
      type: 'webhook', name: 'Slack', values: { url: 'https://hooks.slack.com/x', secret: '' }, clearSecrets: [],
      minSeverity: 'critical', machineIds: ['haas-vf2'], ignorePatterns: [''], enabled: false,
    });
  });

  it('starts with the saved ignore patterns', () => {
    expect(editChannelForm({ ...slack, ignorePatterns: ['Door open', 'Program 9*'] }, webhook).ignorePatterns)
      .toEqual(['Door open', 'Program 9*']);
  });

  it('gives one phone box when the saved list is empty', () => {
    const phones = { ...slack, type: 'twilio-sms', settings: { accountSid: 'AC1', to: [] } };

    expect(editChannelForm(phones, twilio).values.to).toEqual(['']);
  });
});

describe('withType', () => {
  it('empties the values for the new type, and keeps the name and the alerts', () => {
    const form = { ...newChannelForm(twilio), name: 'Shop', minSeverity: 'critical' as const };

    expect(withType(form, webhook)).toEqual({ ...form, type: 'webhook', values: { url: '', secret: '' } });
  });
});

describe('channelInputOf', () => {
  it('trims the texts and drops the empty phone boxes', () => {
    const form = { ...newChannelForm(twilio), name: ' Shop phones ', values: { accountSid: ' AC1 ', authToken: 'token', to: [' +15551230000 ', ''] } };

    expect(channelInputOf(form)).toEqual({
      type: 'twilio-sms', name: 'Shop phones', values: { accountSid: 'AC1', authToken: 'token', to: ['+15551230000'] },
      minSeverity: 'warning', machineIds: null, ignorePatterns: [], enabled: true,
    });
  });

  it('trims the ignore patterns and drops the empty boxes', () => {
    const form = { ...newChannelForm(webhook), ignorePatterns: [' Door open ', '', '  ', 'Program 9*'] };

    expect(channelInputOf(form).ignorePatterns).toEqual(['Door open', 'Program 9*']);
  });

  it('asks the server to delete a saved secret only when the secret box is empty', () => {
    const form = { ...editChannelForm(slack, webhook), clearSecrets: ['secret'] };

    expect(channelInputOf(form).clearSecrets).toEqual(['secret']);
    expect(channelInputOf({ ...form, values: { ...form.values, secret: 'new' } }).clearSecrets).toBeUndefined();
  });
});

describe('secretsToTypeAgain', () => {
  const twoAddresses: ChannelTypeInfo = {
    id: 'relay', name: 'Relay', fields: [
      { key: 'url', label: 'Web address', kind: 'url', required: true },
      { key: 'backup', label: 'Backup address (optional)', kind: 'url', required: false },
      { key: 'token', label: 'Token', kind: 'secret', required: true },
      { key: 'secret', label: 'Secret (optional)', kind: 'secret', required: false },
    ],
  };
  const relay: NotificationChannel = {
    ...slack, type: 'relay', settings: { url: 'https://a.example.com', backup: 'https://b.example.com' }, hasSecret: { token: true, secret: true },
  };
  const moved = (values: Record<string, string>) => {
    const form = editChannelForm(relay, twoAddresses);
    return { ...form, values: { ...form.values, ...values } };
  };

  it('names each changed address for each kept secret, as the server does', () => {
    const reason = 'You changed the Web address and the Backup address. Chatter does not send a saved secret to a new address.';

    expect(secretsToTypeAgain(moved({ url: 'https://c.example.com', backup: '' }), relay, twoAddresses)).toEqual({
      token: `Type the Token again. ${reason}`,
      // Only a secret that is not necessary can be deleted
      secret: `Type the Secret again. ${reason} To use no secret, select Delete the saved secret.`,
    });
  });

  it('names only the changed address, and asks only for the secret that the form keeps', () => {
    expect(secretsToTypeAgain(moved({ backup: '', token: 'new' }), relay, twoAddresses)).toEqual({
      secret: 'Type the Secret again. You changed the Backup address. Chatter does not send a saved secret to a new address. '
        + 'To use no secret, select Delete the saved secret.',
    });
  });

  it('does not ask for a secret that the admin deletes and then types again, because the form sends the new secret', () => {
    const form = { ...moved({ url: 'https://c.example.com', token: 'new', secret: 'typed' }), clearSecrets: ['secret'] };

    expect(secretsToTypeAgain(form, relay, twoAddresses)).toEqual({});
  });

  it('asks only for the secrets that the form keeps', () => {
    const form = { ...moved({ url: 'https://c.example.com', token: 'new' }), clearSecrets: ['secret'] };

    expect(secretsToTypeAgain(form, relay, twoAddresses)).toEqual({});
  });

  it('asks for nothing when no address changes, or for a channel that is not saved or has another type', () => {
    expect(secretsToTypeAgain(moved({ url: ' https://a.example.com ' }), relay, twoAddresses)).toEqual({});
    expect(secretsToTypeAgain(moved({ url: 'https://c.example.com' }), undefined, twoAddresses)).toEqual({});
    expect(secretsToTypeAgain(moved({ url: 'https://c.example.com' }), { ...relay, type: 'webhook' }, twoAddresses)).toEqual({});
  });
});
