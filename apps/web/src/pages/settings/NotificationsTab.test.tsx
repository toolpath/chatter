import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchChannels, fetchChannelTypes, fetchMessages, fetchNotificationSettings, saveNotificationSettings, sendTestMessage, updateChannel,
  type ChannelTypeInfo, type NotificationChannel, type NotificationMessage,
} from '../../api/notifications';
import { NotificationsTab } from './NotificationsTab';

vi.mock('../../api/notifications', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/notifications')>()),
  fetchChannelTypes: vi.fn(),
  fetchChannels: vi.fn(),
  fetchMessages: vi.fn(),
  fetchNotificationSettings: vi.fn(),
  saveNotificationSettings: vi.fn(),
  sendTestMessage: vi.fn(),
  updateChannel: vi.fn(),
  addChannel: vi.fn(),
  removeChannel: vi.fn(),
}));

const TYPES: ChannelTypeInfo[] = [
  {
    id: 'twilio-sms', name: 'Text message (Twilio)', fields: [
      { key: 'accountSid', label: 'Account SID', kind: 'text', required: true },
      { key: 'authToken', label: 'Auth token', kind: 'secret', required: true },
      { key: 'from', label: 'From number', kind: 'text', required: true },
      { key: 'to', label: 'Phone numbers', kind: 'phone-list', required: true },
    ],
  },
  { id: 'webhook', name: 'Webhook', fields: [{ key: 'url', label: 'Web address', kind: 'url', required: true }] },
];

const phones: NotificationChannel = {
  id: 'phones', type: 'twilio-sms', name: 'Shop phones',
  settings: { accountSid: 'AC1', from: '+15551230000', to: ['+15559870001', '+15559870002'] },
  hasSecret: { authToken: true }, minSeverity: 'critical', machineIds: null, enabled: true, createdAt: '2026-11-13T09:00:00.000Z',
};

const slack: NotificationChannel = {
  ...phones, id: 'slack', type: 'webhook', name: 'Slack #shop-floor', settings: { url: 'https://hooks.slack.com/x' },
  hasSecret: {}, minSeverity: 'warning', machineIds: ['haas-vf2'],
};

function message(values: Partial<NotificationMessage>): NotificationMessage {
  return {
    id: 1, channelId: 'phones', alertId: 7, kind: 'started', machineId: 'haas-vf2', severity: 'critical',
    text: 'CRITICAL - Haas VF-2: In alarm. Started 9:02 AM.', status: 'sent', attempts: 1, lastError: null,
    detail: 'Sent to 2 phones', createdAt: new Date().toISOString(), sentAt: new Date().toISOString(), ...values,
  };
}

const MACHINES = [{ id: 'haas-vf2', name: 'Haas VF-2' }];

async function renderTab(messages: NotificationMessage[] = []) {
  vi.mocked(fetchChannelTypes).mockResolvedValue(TYPES);
  vi.mocked(fetchChannels).mockResolvedValue([phones, slack]);
  vi.mocked(fetchMessages).mockResolvedValue(messages);
  render(<NotificationsTab machines={MACHINES} />);
  await screen.findByRole('region', { name: 'Channels' });
}

function channelRow(name: string): HTMLElement {
  return within(screen.getByRole('region', { name: 'Channels' })).getByText(name).closest('tr') as HTMLElement;
}

describe('NotificationsTab', () => {
  beforeEach(() => {
    vi.mocked(fetchNotificationSettings).mockResolvedValue({ linkBaseUrl: 'http://chatter.local:3001', timeZone: 'America/Chicago' });
    vi.mocked(updateChannel).mockReset();
    vi.mocked(sendTestMessage).mockReset();
    vi.mocked(saveNotificationSettings).mockReset();
    vi.mocked(fetchMessages).mockReset();
  });

  it('shows each channel with its type, what it gets, and its machines', async () => {
    await renderTab();

    expect(channelRow('Shop phones')).toHaveTextContent('Text message (Twilio) · 2 phones');
    expect(channelRow('Shop phones')).toHaveTextContent('Critical only');
    expect(channelRow('Shop phones')).toHaveTextContent('All machines');
    expect(channelRow('Slack #shop-floor')).toHaveTextContent('Warning and up');
    expect(channelRow('Slack #shop-floor')).toHaveTextContent('Haas VF-2');
  });

  it('shows the last message of a channel, and the error of a failed one', async () => {
    await renderTab([
      message({ id: 2, channelId: 'slack', status: 'failed', lastError: 'The address answered 404 Not found.', detail: null }),
      message({ id: 1 }),
    ]);

    expect(channelRow('Shop phones')).toHaveTextContent('Sent');
    expect(channelRow('Slack #shop-floor')).toHaveTextContent('Failed');
    expect(channelRow('Slack #shop-floor')).toHaveTextContent('The address answered 404 Not found.');
  });

  it('turns a channel off, and keeps its saved secrets', async () => {
    vi.mocked(updateChannel).mockResolvedValue({ ...phones, enabled: false });
    await renderTab();

    const toggle = screen.getByRole('switch', { name: 'Shop phones on' });
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toBeEnabled());
    expect(updateChannel).toHaveBeenCalledWith('phones', {
      type: 'twilio-sms', name: 'Shop phones', values: phones.settings, minSeverity: 'critical', machineIds: null, enabled: false,
    });
  });

  it('sends a test to a saved channel and shows the result', async () => {
    vi.mocked(sendTestMessage).mockResolvedValue({ ok: false, error: 'Twilio does not accept the Auth token.' });
    await renderTab();

    fireEvent.click(within(channelRow('Shop phones')).getByRole('button', { name: 'Send test' }));

    expect(await screen.findByText('Twilio does not accept the Auth token.')).toBeInTheDocument();
    expect(sendTestMessage).toHaveBeenCalledWith(expect.objectContaining({ name: 'Shop phones' }), 'phones');
    await waitFor(() => expect(fetchMessages).toHaveBeenCalledTimes(2));
  });

  it('shows the messages, and filters them by channel', async () => {
    await renderTab([
      message({ id: 2, channelId: 'slack', text: 'Slack text', detail: 'Sent' }),
      message({ id: 1, text: 'Phone text' }),
    ]);
    const messages = screen.getByRole('region', { name: 'Messages' });

    expect(within(messages).getByText('Slack text')).toBeInTheDocument();
    fireEvent.change(within(messages).getByLabelText('Channel'), { target: { value: 'phones' } });

    expect(within(messages).queryByText('Slack text')).not.toBeInTheDocument();
    expect(within(messages).getByText('Phone text')).toBeInTheDocument();
  });

  it('shows the error of a failed message in the message list', async () => {
    await renderTab([message({ status: 'failed', lastError: 'Twilio says: unverified number.', detail: null })]);

    expect(within(screen.getByRole('region', { name: 'Messages' })).getByText('Twilio says: unverified number.')).toBeInTheDocument();
  });

  it('fills the time zone from the browser when none is saved', async () => {
    vi.mocked(fetchNotificationSettings).mockResolvedValue({ linkBaseUrl: null, timeZone: null });
    await renderTab();

    expect(screen.getByLabelText('Time zone')).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(screen.getByText(/from this browser/)).toBeInTheDocument();
  });

  it('saves the message settings', async () => {
    vi.mocked(saveNotificationSettings).mockResolvedValue({ linkBaseUrl: 'http://10.0.0.5:3001', timeZone: 'America/Chicago' });
    await renderTab();

    fireEvent.change(screen.getByLabelText('Chatter address for links'), { target: { value: 'http://10.0.0.5:3001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(saveNotificationSettings).toHaveBeenCalledWith({ linkBaseUrl: 'http://10.0.0.5:3001', timeZone: 'America/Chicago' });
  });

  it('shows a failed save of the settings next to the settings', async () => {
    vi.mocked(saveNotificationSettings).mockRejectedValue(new Error('Chatter does not know this time zone'));
    await renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const settings = screen.getByRole('region', { name: 'Message settings' });
    expect(await within(settings).findByText('Chatter does not know this time zone')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Channels' })).queryByText('Chatter does not know this time zone')).not.toBeInTheDocument();
  });
});
