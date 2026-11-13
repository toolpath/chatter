import { describe, expect, it } from 'vitest';
import type { ChannelTypeInfo, NotificationChannel } from '../../api/notifications';
import { channelInputOf, editChannelForm, newChannelForm, withType } from './channelFormState';

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
  minSeverity: 'critical', machineIds: ['haas-vf2'], enabled: false, createdAt: '2026-11-13T09:00:00.000Z',
};

describe('newChannelForm', () => {
  it('starts empty, on, for all machines and warning alerts, with one phone box', () => {
    expect(newChannelForm(twilio)).toEqual({
      type: 'twilio-sms', name: '', values: { accountSid: '', authToken: '', to: [''] }, clearSecrets: [],
      minSeverity: 'warning', machineIds: null, enabled: true,
    });
  });
});

describe('editChannelForm', () => {
  it('starts with the saved values and an empty secret, so the server keeps the saved one', () => {
    expect(editChannelForm(slack, webhook)).toEqual({
      type: 'webhook', name: 'Slack', values: { url: 'https://hooks.slack.com/x', secret: '' }, clearSecrets: [],
      minSeverity: 'critical', machineIds: ['haas-vf2'], enabled: false,
    });
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
      minSeverity: 'warning', machineIds: null, enabled: true,
    });
  });

  it('asks the server to delete a saved secret only when the secret box is empty', () => {
    const form = { ...editChannelForm(slack, webhook), clearSecrets: ['secret'] };

    expect(channelInputOf(form).clearSecrets).toEqual(['secret']);
    expect(channelInputOf({ ...form, values: { ...form.values, secret: 'new' } }).clearSecrets).toBeUndefined();
  });
});
