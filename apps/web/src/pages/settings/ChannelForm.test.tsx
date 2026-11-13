import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendTestMessage, type ChannelTypeInfo, type NotificationChannel } from '../../api/notifications';
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
];

const MACHINES = [{ id: 'haas-vf2', name: 'Haas VF-2' }, { id: 'okuma', name: 'Okuma LB3000' }];

const slack: NotificationChannel = {
  id: 'slack', type: 'webhook', name: 'Slack', settings: { url: 'https://hooks.slack.com/x' }, hasSecret: { secret: true },
  minSeverity: 'warning', machineIds: null, enabled: true, createdAt: '2026-11-13T09:00:00.000Z',
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

  it('saves a new channel with each phone number, and closes', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const { onClose } = renderForm({ onSave });
    fillTwilio();
    fireEvent.click(screen.getByRole('button', { name: 'Add a number' }));
    type('Phone number 2', '+15559870002');

    fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));

    expect(onSave).toHaveBeenCalledWith({
      type: 'twilio-sms', name: 'Shop phones', values: { accountSid: 'AC1', authToken: 'token', to: ['+15559870001', '+15559870002'] },
      minSeverity: 'warning', machineIds: null, enabled: true,
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
