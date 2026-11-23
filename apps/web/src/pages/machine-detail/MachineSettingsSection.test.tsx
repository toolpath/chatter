import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Machine } from '../../types';
import { testMachine } from '../../test/testMachine';
import { MachineSettingsSection } from './MachineSettingsSection';

const NEW_HOST = '192.168.1.99';
const FTP_AGAIN = 'Type the password again. You changed the IP address or the FTP port. '
  + 'Chatter does not send a saved password to a new address.';
const OPCUA_AGAIN = 'Type the password again. You changed the IP address or the OPC UA port. '
  + 'Chatter does not send a saved password to a new address.';

function renderSection(machine: Machine, onUpdate = vi.fn().mockResolvedValue(false)) {
  render(<MachineSettingsSection machine={machine} onUpdate={onUpdate} />);
  return onUpdate;
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const ftpPassword = () => screen.getByLabelText('FTP password');
const opcuaPassword = () => screen.getByLabelText('OPC UA password');
const siemens = (overrides: Partial<Machine> = {}) => testMachine({ type: 'siemens', opcuaPort: 4840, ...overrides } as never);

describe('MachineSettingsSection', () => {
  it('keeps the typed IP address when the server refuses the save, so the user can add the password and save again', async () => {
    const onUpdate = renderSection(testMachine({ hasFtpPassword: true }));

    type('IP address', NEW_HOST);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled());
    expect(onUpdate).toHaveBeenCalledWith('m1', expect.objectContaining({ host: NEW_HOST }));
    expect(screen.getByLabelText('IP address')).toHaveValue(NEW_HOST);
    expect(screen.queryByText('The settings are saved')).not.toBeInTheDocument();
  });

  // The server refuses these saves with "Type the FTP password again" (checkSavedPasswordsStay), so the form tells it first
  describe('a saved FTP password and a new address', () => {
    it('asks for the password again after a change of the IP address', () => {
      renderSection(testMachine({ hasFtpPassword: true }));

      type('IP address', NEW_HOST);

      expect(ftpPassword()).toHaveAccessibleDescription(expect.stringContaining(FTP_AGAIN));
      expect(screen.getByText(FTP_AGAIN)).toHaveClass('text-primary-text');
    });

    it('asks for the password again after a change of the FTP port', () => {
      renderSection(testMachine({ hasFtpPassword: true }));

      type('FTP port', '2121');

      expect(ftpPassword()).toHaveAccessibleDescription(expect.stringContaining(FTP_AGAIN));
    });

    it('stops asking when the user types the password', () => {
      renderSection(testMachine({ hasFtpPassword: true }));

      type('IP address', NEW_HOST);
      type('FTP password', 'new-secret');

      expect(screen.queryByText(FTP_AGAIN)).not.toBeInTheDocument();
      expect(ftpPassword()).toHaveAccessibleDescription(expect.stringContaining('This new password is saved when you click Save changes.'));
    });

    it('stops asking when the user removes the password', () => {
      renderSection(testMachine({ hasFtpPassword: true }));

      type('IP address', NEW_HOST);
      fireEvent.click(screen.getByRole('button', { name: 'Remove password' }));

      expect(screen.queryByText(FTP_AGAIN)).not.toBeInTheDocument();
    });

    it('stops asking when the user types the saved address again', () => {
      renderSection(testMachine({ hasFtpPassword: true }));

      type('IP address', NEW_HOST);
      type('IP address', '192.168.1.50');

      expect(screen.queryByText(FTP_AGAIN)).not.toBeInTheDocument();
    });

    it('does not ask after a save, when the server has the new address and the password', async () => {
      renderSection(testMachine({ hasFtpPassword: true }), vi.fn().mockResolvedValue(true));

      type('IP address', NEW_HOST);
      type('FTP password', 'new-secret');
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      expect(await screen.findByText('The settings are saved')).toBeInTheDocument();
      expect(ftpPassword()).toHaveValue('');
      expect(screen.queryByText(FTP_AGAIN)).not.toBeInTheDocument();
    });
  });

  // The server accepts these saves with no password, so the form must not ask for one
  describe('changes that keep the saved password', () => {
    it('does not ask when no FTP password is saved', () => {
      renderSection(testMachine({ hasFtpPassword: false }));

      type('IP address', NEW_HOST);

      expect(screen.queryByText(FTP_AGAIN)).not.toBeInTheDocument();
    });

    it('does not ask for spaces around the saved IP address, because the server removes them', () => {
      renderSection(testMachine({ hasFtpPassword: true }));

      type('IP address', ' 192.168.1.50 ');

      expect(screen.queryByText(FTP_AGAIN)).not.toBeInTheDocument();
    });

    it('does not ask after a change of the username, the name or the data port', () => {
      renderSection(testMachine({ hasFtpPassword: true }));

      type('FTP username', 'operator');
      type('Machine name', 'Mill 2');
      type('Data port', '10001');

      expect(screen.queryByText(FTP_AGAIN)).not.toBeInTheDocument();
      expect(ftpPassword()).toHaveAccessibleDescription(expect.stringContaining('A password is saved. Leave this empty to keep it.'));
    });

    it('does not ask when the FTP port box is empty and the saved port is the default port 21', () => {
      renderSection(testMachine({ hasFtpPassword: true, ftpPort: undefined }));

      type('FTP port', '');

      expect(screen.queryByText(FTP_AGAIN)).not.toBeInTheDocument();
    });
  });

  describe('a Siemens machine', () => {
    it('asks for the OPC UA password again after a change of the OPC UA port, and not for the FTP password', () => {
      renderSection(siemens({ hasOpcuaPassword: true, hasFtpPassword: true }));

      type('OPC UA port', '4841');

      expect(opcuaPassword()).toHaveAccessibleDescription(expect.stringContaining(OPCUA_AGAIN));
      expect(screen.queryByText(FTP_AGAIN)).not.toBeInTheDocument();
    });

    it('asks for each saved password again after a change of the IP address', () => {
      renderSection(siemens({ hasOpcuaPassword: true, hasFtpPassword: true }));

      type('IP address', NEW_HOST);

      expect(opcuaPassword()).toHaveAccessibleDescription(expect.stringContaining(OPCUA_AGAIN));
      expect(ftpPassword()).toHaveAccessibleDescription(expect.stringContaining(FTP_AGAIN));
    });

    it('does not ask for the OPC UA password after a change of the FTP port', () => {
      renderSection(siemens({ hasOpcuaPassword: true, hasFtpPassword: false }));

      type('FTP port', '2121');

      expect(screen.queryByText(OPCUA_AGAIN)).not.toBeInTheDocument();
    });

    it('does not ask after a change of the OPC UA username or the security', () => {
      renderSection(siemens({ hasOpcuaPassword: true }));

      type('OPC UA username (empty: anonymous)', 'Operator');
      fireEvent.change(screen.getByLabelText('Security'), { target: { value: 'signAndEncrypt' } });

      expect(screen.queryByText(OPCUA_AGAIN)).not.toBeInTheDocument();
    });

    it('does not ask when no OPC UA password is saved', () => {
      renderSection(siemens({ hasOpcuaPassword: false }));

      type('OPC UA port', '4841');

      expect(screen.queryByText(OPCUA_AGAIN)).not.toBeInTheDocument();
    });
  });
});
