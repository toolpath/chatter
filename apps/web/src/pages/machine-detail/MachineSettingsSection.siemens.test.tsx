import { OPCUA_NO_ENCRYPTION_WARNING, type Role } from '@local-chatter/shared';
import { Dialog } from '@toolpath/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetOpcuaCertificate } from '../../api/machines';
import { CurrentUserContext } from '../../components/CurrentUser';
import { testMachine } from '../../test/testMachine';
import type { Machine } from '../../types';
import { MachineSettingsSection } from './MachineSettingsSection';

vi.mock('../../api/machines', () => ({ forgetOpcuaCertificate: vi.fn() }));

const SHA256 = '0123456789abcdef'.repeat(4);
const SHOWN_SHA256 = '01:23:45:67:89:AB:CD:EF:'.repeat(4).slice(0, -1);

function siemens(overrides: Record<string, unknown> = {}): Machine {
  return testMachine({ type: 'siemens', opcuaPort: 4840, opcuaSecurity: 'signAndEncrypt', ...overrides } as never);
}

function renderSection(machine: Machine, role: Role = 'admin') {
  render(
    <CurrentUserContext.Provider value={{ username: 'sam', role }}>
      <Dialog.Provider>
        <MachineSettingsSection machine={machine} onUpdate={vi.fn().mockResolvedValue(true)} />
      </Dialog.Provider>
    </CurrentUserContext.Provider>,
  );
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const setSecurity = (value: string) => fireEvent.change(screen.getByLabelText('Security'), { target: { value } });
const warning = () => screen.queryByRole('status', { name: 'Security warning' });
const certificate = () => screen.getByRole('group', { name: 'Trusted certificate of the control' });

describe('MachineSettingsSection of a Siemens machine', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('the warning for Security None with a username, before the save', () => {
    it('appears when the user sets Security to None with a username', () => {
      renderSection(siemens({ opcuaUser: 'OpcUaClient' }));
      expect(warning()).not.toBeInTheDocument();

      setSecurity('none');

      expect(warning()).toHaveTextContent(OPCUA_NO_ENCRYPTION_WARNING);
    });

    it('appears when the user types a username with Security None, and goes when the user removes it', () => {
      renderSection(siemens({ opcuaSecurity: 'none' }));
      expect(warning()).not.toBeInTheDocument();

      type('OPC UA username (empty: anonymous)', 'OpcUaClient');
      expect(warning()).toBeInTheDocument();

      type('OPC UA username (empty: anonymous)', '  ');
      expect(warning()).not.toBeInTheDocument();
    });

    it('goes when the user sets Security to Sign and encrypt', () => {
      renderSection(siemens({ opcuaSecurity: 'none', opcuaUser: 'OpcUaClient' }));
      expect(warning()).toBeInTheDocument();

      setSecurity('signAndEncrypt');

      expect(warning()).not.toBeInTheDocument();
    });
  });

  describe('the trusted certificate of the control', () => {
    it('shows the saved SHA-256 thumbprint', () => {
      renderSection(siemens({ opcuaServerThumbprint: SHA256 }));

      expect(within(certificate()).getByText(SHOWN_SHA256)).toHaveClass('font-mono');
      expect(within(certificate()).queryByText('SHA-1')).not.toBeInTheDocument();
    });

    it.each<Role>(['operator', 'viewer'])('gives the role %s no Forget button', role => {
      renderSection(siemens({ opcuaServerThumbprint: SHA256 }), role);

      expect(screen.queryByRole('group', { name: 'Trusted certificate of the control' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Forget the saved certificate' })).not.toBeInTheDocument();
    });

    it('tells that the next connect trusts the certificate of the control when no certificate is saved', () => {
      renderSection(siemens({ opcuaServerThumbprint: null }));

      expect(within(certificate()).getByText(/Chatter trusts no certificate yet/)).toBeInTheDocument();
      expect(within(certificate()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('forgets the saved certificate after a confirm that tells what the next connect trusts', async () => {
      vi.mocked(forgetOpcuaCertificate).mockResolvedValue(siemens({ opcuaServerThumbprint: null }));
      renderSection(siemens({ opcuaServerThumbprint: SHA256 }));

      fireEvent.click(within(certificate()).getByRole('button', { name: 'Forget the saved certificate' }));
      const box = await screen.findByRole('alertdialog');
      expect(within(box).getByText(/If the control shows a certificate then, Chatter trusts it/)).toBeInTheDocument();
      expect(within(box).getByText(/If the control shows no certificate, Chatter trusts nothing/)).toBeInTheDocument();
      fireEvent.click(within(box).getByRole('button', { name: 'Forget the certificate' }));

      expect(await screen.findByText('Chatter forgot the saved certificate. It connects to the control again now.')).toBeInTheDocument();
      expect(forgetOpcuaCertificate).toHaveBeenCalledWith('m1');
      expect(within(certificate()).queryByText(SHOWN_SHA256)).not.toBeInTheDocument();
    });

    it('keeps the certificate when the Admin cancels', async () => {
      renderSection(siemens({ opcuaServerThumbprint: SHA256 }));

      fireEvent.click(within(certificate()).getByRole('button', { name: 'Forget the saved certificate' }));
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(forgetOpcuaCertificate).not.toHaveBeenCalled();
      expect(within(certificate()).getByText(SHOWN_SHA256)).toBeInTheDocument();
    });

    it('shows the error of the server when the forget fails', async () => {
      vi.mocked(forgetOpcuaCertificate).mockRejectedValue(new Error('Only a Siemens machine has an OPC UA certificate.'));
      renderSection(siemens({ opcuaServerThumbprint: SHA256 }));

      fireEvent.click(within(certificate()).getByRole('button', { name: 'Forget the saved certificate' }));
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Forget the certificate' }));

      expect(await screen.findByText('Only a Siemens machine has an OPC UA certificate.')).toBeInTheDocument();
      expect(within(certificate()).getByText(SHOWN_SHA256)).toBeInTheDocument();
    });

    it('does not send the form when the Admin clicks Forget', async () => {
      const onUpdate = vi.fn();
      render(
        <CurrentUserContext.Provider value={{ username: 'sam', role: 'admin' }}>
          <Dialog.Provider>
            <MachineSettingsSection machine={siemens({ opcuaServerThumbprint: SHA256 })} onUpdate={onUpdate} />
          </Dialog.Provider>
        </CurrentUserContext.Provider>,
      );

      fireEvent.click(within(certificate()).getByRole('button', { name: 'Forget the saved certificate' }));

      await screen.findByRole('alertdialog');
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });
});
