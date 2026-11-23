import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendTestMessage, type ChannelTypeInfo, type NotificationChannel, type NotificationMessage } from '../../api/notifications';
import { ChannelForm } from './ChannelForm';

vi.mock('../../api/notifications', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/notifications')>()),
  sendTestMessage: vi.fn(),
}));

const TYPES: ChannelTypeInfo[] = [
  {
    id: 'twilio-sms', name: 'Text message (Twilio)', note: 'Register the number for A2P 10DLC.', fields: [
      { key: 'accountSid', label: 'Account SID', kind: 'text', required: true },
      { key: 'authToken', label: 'Auth token', kind: 'secret', required: true, hint: 'Chatter keeps the token secret.' },
      { key: 'to', label: 'Phone numbers', kind: 'phone-list', required: true },
    ],
  },
  {
    id: 'webhook', name: 'Webhook', fields: [
      { key: 'url', label: 'Web address', kind: 'url', required: true },
      { key: 'secret', label: 'Secret (optional)', kind: 'secret', required: false },
    ],
  },
  {
    id: 'ntfy', name: 'ntfy', fields: [
      { key: 'topic', label: 'Topic', kind: 'text', required: true, generate: 'words' },
      { key: 'url', label: 'Server (optional)', kind: 'url', required: false, advanced: true },
      { key: 'token', label: 'Access token (optional)', kind: 'secret', required: false, advanced: true },
    ],
  },
  {
    id: 'telegram', name: 'Telegram', fields: [
      { key: 'chatId', label: 'Chat ID', kind: 'text', required: true },
      {
        key: 'sound', label: 'Notification sound', kind: 'choice', required: false, default: 'normal', hint: 'Quiet still shows the message.',
        options: [{ value: 'normal', label: 'Normal' }, { value: 'quiet', label: 'Quiet' }],
      },
    ],
  },
];

const MACHINES = [{ id: 'haas-vf2', name: 'Haas VF-2' }, { id: 'okuma', name: 'Okuma LB3000' }];

const slack: NotificationChannel = {
  id: 'slack', type: 'webhook', name: 'Slack', settings: { url: 'https://hooks.slack.com/x' }, hasSecret: { secret: true },
  minSeverity: 'warning', machineIds: null, ignorePatterns: [], enabled: true, createdAt: '2026-11-13T09:00:00.000Z',
};

function renderForm(props: Partial<Parameters<typeof ChannelForm>[0]> = {}) {
  const handlers = {
    // The server refuses, so the form stays open after the test
    onSave: vi.fn().mockResolvedValue(false),
    onDelete: vi.fn().mockResolvedValue(false),
    onTested: vi.fn(),
    onClose: vi.fn(),
  };
  render(<ChannelForm types={TYPES} machines={MACHINES} error={null} isSaving={false} {...handlers} {...props} />);
  return handlers;
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillTwilio() {
  type('Name', 'Shop phones');
  type('Account SID', 'AC1');
  type('Auth token', 'token');
  type('Phone number 1', '+15559870001');
}

describe('ChannelForm', () => {
  beforeEach(() => {
    vi.mocked(sendTestMessage).mockReset();
  });

  it('makes the form from the fields of the first type, with its note', () => {
    renderForm();

    expect(screen.getByRole('dialog', { name: 'Add channel' })).toBeInTheDocument();
    expect(screen.getByLabelText('Account SID')).toBeInTheDocument();
    expect(screen.getByText('Chatter keeps the token secret.')).toBeInTheDocument();
    expect(screen.getByText('Register the number for A2P 10DLC.')).toBeInTheDocument();
  });

  it('keeps the browser from filling in the channel name, because it is not a person or an account', () => {
    renderForm();

    expect(screen.getByLabelText('Name')).toHaveAttribute('autocomplete', 'off');
  });

  describe('a field that Chatter can fill with random words', () => {
    const pickNtfy = () => fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'ntfy' } });

    it('fills the box with three random words when the admin clicks the button', () => {
      renderForm();
      pickNtfy();

      fireEvent.click(screen.getByRole('button', { name: 'Make a random topic' }));

      expect((screen.getByLabelText('Topic') as HTMLInputElement).value).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    });

    it('shows the value, so the admin can type it in the other app, and keeps the browser from filling it in', () => {
      renderForm();
      pickNtfy();

      expect(screen.getByLabelText('Topic')).not.toHaveAttribute('type', 'password');
      expect(screen.getByLabelText('Topic')).toHaveAttribute('autocomplete', 'off');
    });

    it('sends the random words when the admin saves', async () => {
      const onSave = vi.fn().mockResolvedValue(true);
      renderForm({ onSave });
      pickNtfy();
      type('Name', 'Shop phones');
      fireEvent.click(screen.getByRole('button', { name: 'Make a random topic' }));
      const topic = (screen.getByLabelText('Topic') as HTMLInputElement).value;

      fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave.mock.calls[0][0].values.topic).toBe(topic);
    });

    it('shows the saved topic when the admin opens a saved channel', () => {
      renderForm({ channel: { ...slack, id: 'phones', type: 'ntfy', name: 'Phones', settings: { topic: 'maple-otter-lantern' }, hasSecret: {} } });

      expect(screen.getByLabelText('Topic')).toHaveValue('maple-otter-lantern');
    });

    it('keeps each other secret hidden, with no button', () => {
      renderForm();
      pickNtfy();

      expect(screen.getByLabelText('Access token (optional)')).toHaveAttribute('type', 'password');
      expect(screen.getAllByRole('button', { name: /^Make a random/ })).toHaveLength(1);
    });
  });

  describe('advanced fields', () => {
    const advancedGroup = () => screen.getByText('Advanced').closest('details')!;
    const ntfyChannel = (change: Partial<NotificationChannel>): NotificationChannel => ({
      ...slack, id: 'phones', type: 'ntfy', name: 'Phones', settings: { topic: 'maple-otter-lantern' }, hasSecret: {}, ...change,
    });

    it('puts the advanced fields under a closed Advanced heading', () => {
      renderForm();
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'ntfy' } });

      const group = advancedGroup();
      expect(group).not.toHaveAttribute('open');
      expect(group).toContainElement(screen.getByLabelText('Server (optional)'));
      expect(group).toContainElement(screen.getByLabelText('Access token (optional)'));
      expect(group).not.toContainElement(screen.getByLabelText('Topic'));
    });

    it('opens the Advanced heading when the admin clicks it', () => {
      renderForm();
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'ntfy' } });

      fireEvent.click(screen.getByText('Advanced'));

      expect(advancedGroup()).toHaveAttribute('open');
    });

    it('opens the Advanced heading for a saved channel with a value in an advanced field', () => {
      renderForm({ channel: ntfyChannel({ settings: { topic: 'maple-otter-lantern', url: 'https://ntfy.shop.local' } }) });

      expect(advancedGroup()).toHaveAttribute('open');
    });

    it('opens the Advanced heading for a saved channel with an advanced secret', () => {
      renderForm({ channel: ntfyChannel({ hasSecret: { token: true } }) });

      expect(advancedGroup()).toHaveAttribute('open');
    });

    it('keeps the Advanced heading closed for a saved channel with no advanced value', () => {
      renderForm({ channel: ntfyChannel({ settings: { topic: 'maple-otter-lantern', url: '' } }) });

      expect(advancedGroup()).not.toHaveAttribute('open');
    });

    it('shows no Advanced heading for a type with no advanced field', () => {
      renderForm();

      expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
    });
  });

  it('saves a new channel with each phone number, and closes', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const { onClose } = renderForm({ onSave });
    fillTwilio();
    fireEvent.click(screen.getByRole('button', { name: 'Add a number' }));
    type('Phone number 2', '+15559870002');

    fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));

    expect(onSave).toHaveBeenCalledWith({
      type: 'twilio-sms', name: 'Shop phones', values: { accountSid: 'AC1', authToken: 'token', to: ['+15559870001', '+15559870002'] },
      minSeverity: 'warning', machineIds: null, ignorePatterns: [], enabled: true,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('removes a phone number', () => {
    const { onSave } = renderForm();
    fillTwilio();
    fireEvent.click(screen.getByRole('button', { name: 'Add a number' }));
    type('Phone number 2', '+15559870002');

    fireEvent.click(screen.getByRole('button', { name: 'Remove phone number 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ values: expect.objectContaining({ to: ['+15559870002'] }) }));
  });

  it('shows the fields of the type that the admin picks', () => {
    renderForm();

    type('Type', 'webhook');

    expect(screen.getByLabelText('Web address')).toBeInTheDocument();
    expect(screen.queryByLabelText('Account SID')).not.toBeInTheDocument();
    expect(screen.queryByText('Register the number for A2P 10DLC.')).not.toBeInTheDocument();
  });

  it('sends only the alerts of the machines that the admin picks', () => {
    const { onSave } = renderForm();
    fillTwilio();

    fireEvent.click(screen.getByLabelText('Pick machines'));
    fireEvent.click(screen.getByLabelText('Haas VF-2'));
    type('Level', 'critical');
    fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ machineIds: ['haas-vf2'], minSeverity: 'critical' }));
  });

  describe('a choice field', () => {
    it('shows the options and starts on the default', () => {
      renderForm();

      type('Type', 'telegram');

      const select = screen.getByLabelText('Notification sound');
      expect(select).toHaveValue('normal');
      expect(screen.getByRole('option', { name: 'Quiet' })).toBeInTheDocument();
      expect(screen.getByText('Quiet still shows the message.')).toBeInTheDocument();
    });

    it('saves the option that the admin picks', () => {
      const { onSave } = renderForm();
      type('Type', 'telegram');
      type('Name', 'Shop chat');
      type('Chat ID', '-100123');

      type('Notification sound', 'quiet');
      fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ values: { chatId: '-100123', sound: 'quiet' } }));
    });

    it('starts on the default for a saved channel with no value', () => {
      renderForm({ channel: { ...slack, type: 'telegram', settings: { chatId: '-100123' } } });

      expect(screen.getByLabelText('Notification sound')).toHaveValue('normal');
    });
  });

  describe('ignore patterns', () => {
    function sent(
      text: string, kind: NotificationMessage['kind'] = 'started', { alertId = 7, channelId = 'phones' } = {},
    ): NotificationMessage {
      return {
        id: 1, channelId, alertId, kind, machineId: 'haas-vf2', severity: 'critical', text, status: 'sent',
        attempts: 1, lastError: null, detail: null, createdAt: '2026-11-13T09:00:00.000Z', sentAt: '2026-11-13T09:00:00.000Z',
      };
    }

    it('adds and removes pattern boxes, and saves only the filled patterns', () => {
      const { onSave } = renderForm();
      fillTwilio();

      type('Ignore pattern 1', 'Door open');
      fireEvent.click(screen.getByRole('button', { name: 'Add a pattern' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add a pattern' }));
      type('Ignore pattern 2', 'Coolant');
      type('Ignore pattern 3', 'Program 9*');
      fireEvent.click(screen.getByRole('button', { name: 'Remove ignore pattern 2' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add a pattern' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));

      expect(screen.getAllByLabelText(/^Ignore pattern \d$/)).toHaveLength(3);
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ ignorePatterns: ['Door open', 'Program 9*'] }));
    });

    it('starts with the saved patterns of a channel', () => {
      renderForm({ channel: { ...slack, ignorePatterns: ['Door open', 'Coolant'] } });

      expect(screen.getByLabelText('Ignore pattern 1')).toHaveValue('Door open');
      expect(screen.getByLabelText('Ignore pattern 2')).toHaveValue('Coolant');
    });

    it('shows how many of the last alert messages each pattern matches', () => {
      renderForm({
        messages: [
          sent('CRITICAL - Haas VF-2: Door open. Started 9:02 AM.'),
          sent('OK - Haas VF-2: Door open ended at 9:04 AM.', 'ended'),
          sent('WARNING - Okuma LB3000: Idle for 20 minutes. Started 9:10 AM.', 'started', { alertId: 8 }),
          // A test is never ignored, so the preview does not count it
          sent('Test from Chatter. Door open.', 'test'),
        ],
      });

      type('Ignore pattern 1', 'door OPEN');
      expect(screen.getByText('Matches 2 of the last 3 messages.')).toBeInTheDocument();

      type('Ignore pattern 1', 'Haas*Started');
      expect(screen.getByText('Matches 1 of the last 3 messages.')).toBeInTheDocument();
    });

    it('counts each alert message of a new channel one time, also when several channels got it', () => {
      const doorOpen = 'CRITICAL - Haas VF-2: Door open. Started 9:02 AM.';
      renderForm({
        messages: [
          sent(doorOpen, 'started', { channelId: 'phones' }),
          sent(doorOpen, 'started', { channelId: 'slack' }),
          sent('WARNING - Okuma LB3000: Idle for 20 minutes. Started 9:10 AM.', 'started', { alertId: 8, channelId: 'slack' }),
        ],
      });

      type('Ignore pattern 1', 'Door open');

      expect(screen.getByText('Matches 1 of the last 2 messages.')).toBeInTheDocument();
    });

    it('counts only the messages of the saved channel that the admin edits', () => {
      renderForm({
        channel: slack,
        messages: [
          sent('CRITICAL - Haas VF-2: Door open. Started 9:02 AM.', 'started', { channelId: 'phones' }),
          sent('CRITICAL - Haas VF-2: Door open. Started 9:02 AM.', 'started', { channelId: 'slack' }),
          sent('OK - Haas VF-2: Door open ended at 9:04 AM.', 'ended', { channelId: 'slack' }),
          sent('WARNING - Okuma LB3000: Idle for 20 minutes. Started 9:10 AM.', 'started', { alertId: 8, channelId: 'phones' }),
        ],
      });

      type('Ignore pattern 1', 'Door open');

      expect(screen.getByText('Matches 2 of the last 2 messages.')).toBeInTheDocument();
    });

    it('tells why a pattern cannot be saved, in place of the count', () => {
      renderForm({ messages: [sent('CRITICAL - Haas VF-2: Door open. Started 9:02 AM.')] });

      type('Ignore pattern 1', '*');

      expect(screen.getByText('This pattern matches each message. To stop all messages, turn the channel off.')).toBeInTheDocument();
    });
  });

  it('keeps the form open and shows the error when the save fails', () => {
    const { onClose } = renderForm({ error: 'The phone number must start with +', onSave: vi.fn().mockResolvedValue(false) });

    expect(screen.getByText('The phone number must start with +')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('a saved channel', () => {
    it('cannot change its type, and keeps its saved secret when the box is empty', () => {
      const { onSave } = renderForm({ channel: slack });

      expect(screen.getByRole('dialog', { name: 'Edit Slack' })).toBeInTheDocument();
      expect(screen.getByLabelText('Type')).toBeDisabled();
      expect(screen.getByLabelText('Secret (optional)')).toHaveAttribute('placeholder', 'Saved. Leave it empty to keep it.');
      fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ values: { url: 'https://hooks.slack.com/x', secret: '' } }));
    });

    it('deletes a saved secret that is not necessary when the admin asks', () => {
      const { onSave } = renderForm({ channel: slack });

      fireEvent.click(screen.getByLabelText('Delete the saved secret'));
      fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ clearSecrets: ['secret'] }));
    });

    it('is deleted after the admin confirms in the form', async () => {
      const onDelete = vi.fn().mockResolvedValue(true);
      const { onClose } = renderForm({ channel: slack, onDelete });

      fireEvent.click(screen.getByRole('button', { name: 'Delete channel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete the channel' }));

      expect(onDelete).toHaveBeenCalled();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('keeps the changes that are not saved when the admin keeps the channel', () => {
      const { onDelete } = renderForm({ channel: slack });
      type('Name', 'Slack night shift');

      fireEvent.click(screen.getByRole('button', { name: 'Delete channel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Keep the channel' }));

      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Name')).toHaveValue('Slack night shift');
    });

    it('can only be deleted when this Chatter does not know its type', () => {
      renderForm({ channel: { ...slack, type: 'carrier-pigeon' } });

      expect(screen.getByText('This version of Chatter does not know this channel type')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save channel' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Delete channel' })).toBeEnabled();
    });

    it('sends a test with the saved secret, and loads the message list again', async () => {
      vi.mocked(sendTestMessage).mockResolvedValue({ ok: true, detail: 'The address answered 200 OK.' });
      const { onTested } = renderForm({ channel: slack });

      fireEvent.click(screen.getByRole('button', { name: 'Send test' }));

      expect(await screen.findByText('The address answered 200 OK.')).toBeInTheDocument();
      expect(sendTestMessage).toHaveBeenCalledWith(expect.objectContaining({ name: 'Slack' }), 'slack');
      expect(onTested).toHaveBeenCalled();
    });
  });

  // The server refuses a save or a test that moves a saved secret (problemWithMovedSecrets), so the form tells it first
  describe('a saved secret and a new address', () => {
    // The same sentences as the refusal of the server (problemWithMovedSecrets)
    const SECRET_AGAIN = 'Type the Secret again. You changed the Web address. Chatter does not send a saved secret to a new address. '
      + 'To use no secret, select Delete the saved secret.';
    const secretBox = () => screen.getByLabelText('Secret (optional)');
    const ntfy: NotificationChannel = {
      ...slack, id: 'phones', type: 'ntfy', name: 'Phones', settings: { topic: 'shop', url: 'https://ntfy.example.com' }, hasSecret: { token: true },
    };

    it('asks for the secret again after a change of the address', () => {
      renderForm({ channel: slack });

      type('Web address', 'https://hooks.slack.com/y');

      expect(secretBox()).toHaveAccessibleDescription(SECRET_AGAIN);
      expect(screen.getByText(SECRET_AGAIN)).toHaveClass('text-primary-text');
      expect(secretBox()).not.toHaveAttribute('placeholder');
    });

    it('tells a screen reader the hint when it comes, in a polite live region that is there before', () => {
      renderForm({ channel: slack });
      const before = Array.from(document.querySelectorAll('[aria-live="polite"]'));

      type('Web address', 'https://hooks.slack.com/y');

      const region = screen.getByText(SECRET_AGAIN).closest('[aria-live="polite"]');
      expect(region).not.toBeNull();
      expect(before).toContain(region);
    });

    it('opens the closed Advanced heading, so the admin sees the hint of an advanced secret', () => {
      const advancedSecret: ChannelTypeInfo = {
        ...TYPES[1], fields: [TYPES[1].fields[0], { ...TYPES[1].fields[1], advanced: true }],
      };
      renderForm({ types: [advancedSecret], channel: slack });
      const advancedGroup = () => screen.getByText('Advanced').closest('details')!;
      fireEvent.click(screen.getByText('Advanced'));
      expect(advancedGroup()).not.toHaveAttribute('open');

      type('Web address', 'https://hooks.slack.com/y');

      expect(advancedGroup()).toHaveAttribute('open');
      expect(advancedGroup()).toContainElement(screen.getByText(SECRET_AGAIN));
    });

    it('asks for the secret again when the admin empties the address', () => {
      renderForm({ channel: ntfy });

      type('Server (optional)', '');

      expect(screen.getByLabelText('Access token (optional)'))
        .toHaveAccessibleDescription('Type the Access token again. You changed the Server. Chatter does not send a saved secret to a new address. '
          + 'To use no secret, select Delete the saved secret.');
    });

    it('keeps the hint of the type in the description', () => {
      const twilioWithAddress: ChannelTypeInfo = {
        ...TYPES[0], fields: [...TYPES[0].fields, { key: 'url', label: 'API address', kind: 'url', required: false }],
      };
      renderForm({
        types: [twilioWithAddress],
        channel: { ...slack, type: 'twilio-sms', settings: { accountSid: 'AC1', to: ['+15559870001'], url: 'https://api.twilio.com' }, hasSecret: { authToken: true } },
      });

      type('API address', 'https://api.example.com');

      expect(screen.getByLabelText('Auth token')).toHaveAccessibleDescription(
        'Chatter keeps the token secret. Type the Auth token again. You changed the API address. Chatter does not send a saved secret to a new address.',
      );
    });

    it('stops asking when the admin types the secret', () => {
      renderForm({ channel: slack });

      type('Web address', 'https://hooks.slack.com/y');
      type('Secret (optional)', 'new-secret');

      expect(screen.queryByText(SECRET_AGAIN)).not.toBeInTheDocument();
    });

    it('still asks when the admin types only spaces, because the server keeps the saved secret then', () => {
      renderForm({ channel: slack });

      type('Web address', 'https://hooks.slack.com/y');
      type('Secret (optional)', '   ');

      expect(screen.getByText(SECRET_AGAIN)).toBeInTheDocument();
    });

    it('stops asking when the admin deletes the saved secret', () => {
      renderForm({ channel: slack });

      type('Web address', 'https://hooks.slack.com/y');
      fireEvent.click(screen.getByLabelText('Delete the saved secret'));

      expect(screen.queryByText(SECRET_AGAIN)).not.toBeInTheDocument();
    });

    it('does not ask for spaces around the saved address, because the server removes them', () => {
      renderForm({ channel: slack });

      type('Web address', '  https://hooks.slack.com/x  ');

      expect(screen.queryByText(SECRET_AGAIN)).not.toBeInTheDocument();
      expect(secretBox()).toHaveAttribute('placeholder', 'Saved. Leave it empty to keep it.');
    });

    it('does not ask after a change of a field that is not an address', () => {
      renderForm({ channel: ntfy });

      type('Topic', 'night-shift');
      type('Name', 'Night phones');

      expect(screen.queryByText(/again/)).not.toBeInTheDocument();
    });

    it('does not ask when no secret is saved', () => {
      renderForm({ channel: { ...slack, hasSecret: { secret: false } } });

      type('Web address', 'https://hooks.slack.com/y');

      expect(screen.queryByText(SECRET_AGAIN)).not.toBeInTheDocument();
    });

    it('does not ask in the form of a new channel', () => {
      renderForm();
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'webhook' } });

      type('Web address', 'https://hooks.slack.com/y');

      expect(screen.queryByText(SECRET_AGAIN)).not.toBeInTheDocument();
    });
  });

  it('sends a test of a form that is not saved, and shows why it failed', async () => {
    vi.mocked(sendTestMessage).mockResolvedValue({ ok: false, error: 'Twilio does not accept the Auth token.' });
    const { onTested } = renderForm();
    fillTwilio();

    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));

    expect(await screen.findByText('Twilio does not accept the Auth token.')).toBeInTheDocument();
    expect(sendTestMessage).toHaveBeenCalledWith(expect.objectContaining({ name: 'Shop phones' }), undefined);
    expect(onTested).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Delete channel' })).not.toBeInTheDocument();
  });
});
