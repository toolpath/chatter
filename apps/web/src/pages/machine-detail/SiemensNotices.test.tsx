import type { Role } from '@local-chatter/shared';
import { Dialog } from '@toolpath/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMachine, forgetOpcuaCertificate, trustOpcuaCertificate } from '../../api/machines';
import { CurrentUserContext } from '../../components/CurrentUser';
import { testMachine } from '../../test/testMachine';
import type { Machine } from '../../types';
import { SiemensNotices } from './SiemensNotices';

vi.mock('../../api/machines', () => ({
  fetchMachine: vi.fn(),
  forgetOpcuaCertificate: vi.fn(),
  trustOpcuaCertificate: vi.fn(),
}));

const SHA256 = '0123456789abcdef'.repeat(4);
const SHA1 = 'fedcba9876543210fedcba9876543210fedcba98';
/** The thumbprints as the page shows them: upper case pairs with colons, as openssl writes them */
const SHOWN_SHA256 = '01:23:45:67:89:AB:CD:EF:'.repeat(4).slice(0, -1);
const SHOWN_SHA1 = 'FE:DC:BA:98:76:54:32:10:FE:DC:BA:98:76:54:32:10:FE:DC:BA:98';
const OTHER_SHA256 = '11'.repeat(32);
const WARNING = 'Security is None. Chatter does not sign or encrypt the OPC UA connection.';

function siemens(overrides: Record<string, unknown> = {}): Machine {
  return testMachine({ type: 'siemens', opcuaPort: 4840, opcuaSecurity: 'none', ...overrides } as never);
}

const changed = (presentedThumbprint: string | null = SHA256, presentedSha1Thumbprint: string | null = SHA1) =>
  siemens({ connected: false, opcuaServerThumbprint: OTHER_SHA256, opcuaCertificateChanged: { presentedThumbprint, presentedSha1Thumbprint } });

function renderNotices(machine: Machine, role: Role = 'admin') {
  const page = (shown: Machine) => (
    <CurrentUserContext.Provider value={{ username: 'sam', role }}>
      <Dialog.Provider>
        <SiemensNotices machine={shown} />
      </Dialog.Provider>
    </CurrentUserContext.Provider>
  );
  const { rerender } = render(page(machine));
  return { showMachine: (next: Machine) => rerender(page(next)) };
}

/** The roles that the notices use */
function shownNotices() {
  return [...screen.queryAllByRole('alert'), ...screen.queryAllByRole('status')];
}

const banner = () => screen.getByRole('alert', { name: 'Certificate changed' });
const noBanner = () => expect(screen.queryByRole('alert', { name: 'Certificate changed' })).not.toBeInTheDocument();
const confirmBox = () => screen.findByRole('alertdialog');
const TRUSTED = 'Chatter trusts the new certificate. It connects to the control again now.';

/** Clicks Trust in the banner, and gives the confirm box */
async function openTrustBox() {
  fireEvent.click(screen.getByRole('button', { name: 'Trust new certificate' }));
  return confirmBox();
}

describe('SiemensNotices', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows nothing for a Siemens machine with no certificate change and no warning', () => {
    renderNotices(siemens({ opcuaServerThumbprint: SHA256 }));

    expect(shownNotices()).toEqual([]);
    expect(screen.queryByText(/certificate|security/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  describe('the certificate changed', () => {
    it.each<Role>(['admin', 'operator', 'viewer'])('shows the banner with both thumbprints to the role %s', role => {
      renderNotices(changed(), role);

      expect(within(banner()).getByText(SHOWN_SHA256)).toBeInTheDocument();
      expect(within(banner()).getByText(SHOWN_SHA1)).toBeInTheDocument();
      expect(within(banner()).getByText(/Compare the thumbprints with the certificate on the control/)).toBeInTheDocument();
      expect(within(banner()).getByRole('link', { name: 'How to check a new certificate' }))
        .toHaveAttribute('href', expect.stringMatching(/\/guide\/siemens#check-a-new-certificate$/));
    });

    it('shows the thumbprints in a monospace font that can wrap at each colon, so they fit on a phone', () => {
      renderNotices(changed());

      const shown = within(banner()).getByText(SHOWN_SHA256);
      expect(shown).toHaveClass('font-mono');
      expect(shown.querySelectorAll('wbr')).toHaveLength(31);
    });

    it.each<Role>(['operator', 'viewer'])('gives the role %s no button to trust or forget', role => {
      renderNotices(changed(), role);

      expect(within(banner()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('gives an Admin the Trust button', () => {
      renderNotices(changed());

      expect(within(banner()).getByRole('button', { name: 'Trust new certificate' })).toBeInTheDocument();
      expect(within(banner()).queryByRole('button', { name: 'Forget the saved certificate' })).not.toBeInTheDocument();
    });

    it('repeats both thumbprints in the confirm box, and trusts nothing when the Admin cancels', async () => {
      renderNotices(changed());

      fireEvent.click(screen.getByRole('button', { name: 'Trust new certificate' }));

      const box = await confirmBox();
      expect(within(box).getByText(SHOWN_SHA256)).toBeInTheDocument();
      expect(within(box).getByText(SHOWN_SHA1)).toBeInTheDocument();
      // The thumbprints are part of the message, so a screen reader reads them with the text
      const message = within(box).getByText(/Trust it only when a thumbprint is the same/);
      expect(message).toContainElement(within(box).getByText(SHOWN_SHA256));
      expect(message).toContainElement(within(box).getByText(SHOWN_SHA1));
      fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(trustOpcuaCertificate).not.toHaveBeenCalled();
    });

    it('trusts exactly the SHA-256 thumbprint that the banner shows, and then removes the banner', async () => {
      vi.mocked(trustOpcuaCertificate).mockResolvedValue(siemens({ opcuaServerThumbprint: SHA256 }));
      renderNotices(changed());

      fireEvent.click(screen.getByRole('button', { name: 'Trust new certificate' }));
      fireEvent.click(within(await confirmBox()).getByRole('button', { name: 'Trust this certificate' }));

      expect(await screen.findByText('Chatter trusts the new certificate. It connects to the control again now.')).toBeInTheDocument();
      expect(trustOpcuaCertificate).toHaveBeenCalledWith('m1', SHA256);
      expect(screen.queryByRole('alert', { name: 'Certificate changed' })).not.toBeInTheDocument();
    });

    it('shows the text of the server and the new thumbprint when the certificate changed again (409)', async () => {
      const reason = 'The certificate of the control changed again. Chatter trusted nothing. Check the new thumbprint, then trust it.';
      vi.mocked(trustOpcuaCertificate).mockRejectedValue(new Error(reason));
      vi.mocked(fetchMachine).mockResolvedValue(changed(OTHER_SHA256, 'aa'.repeat(20)));
      renderNotices(changed());

      fireEvent.click(screen.getByRole('button', { name: 'Trust new certificate' }));
      fireEvent.click(within(await confirmBox()).getByRole('button', { name: 'Trust this certificate' }));

      expect(await screen.findByText(reason)).toBeInTheDocument();
      expect(fetchMachine).toHaveBeenCalledWith('m1');
      expect(await within(banner()).findByText('11:'.repeat(32).slice(0, -1))).toBeInTheDocument();
      expect(within(banner()).queryByText(SHOWN_SHA256)).not.toBeInTheDocument();
    });

    it('shows a new status from the server in place of the reply of an older action', async () => {
      vi.mocked(trustOpcuaCertificate).mockResolvedValue(siemens({ opcuaServerThumbprint: SHA256 }));
      const { showMachine } = renderNotices(changed());
      fireEvent.click(screen.getByRole('button', { name: 'Trust new certificate' }));
      fireEvent.click(within(await confirmBox()).getByRole('button', { name: 'Trust this certificate' }));
      await waitFor(() => expect(screen.queryByRole('alert', { name: 'Certificate changed' })).not.toBeInTheDocument());

      showMachine(changed(OTHER_SHA256));

      expect(within(banner()).getByText('11:'.repeat(32).slice(0, -1))).toBeInTheDocument();
    });

    it('shows only the SHA-256 thumbprint when the control gives no SHA-1 thumbprint', async () => {
      renderNotices(changed(SHA256, null));

      expect(within(banner()).getByText(SHOWN_SHA256)).toBeInTheDocument();
      expect(within(banner()).queryByText('SHA-1')).not.toBeInTheDocument();
      const box = await openTrustBox();
      expect(within(box).getByText(SHOWN_SHA256)).toBeInTheDocument();
      expect(within(box).queryByText('SHA-1')).not.toBeInTheDocument();
    });

    it('trusts nothing when the Admin closes the confirm box with Escape', async () => {
      renderNotices(changed());

      fireEvent.keyDown(await openTrustBox(), { key: 'Escape' });

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(trustOpcuaCertificate).not.toHaveBeenCalled();
      expect(banner()).toBeInTheDocument();
    });

    it('sends one request when the Admin clicks Trust this certificate two times', async () => {
      vi.mocked(trustOpcuaCertificate).mockResolvedValue(siemens({ opcuaServerThumbprint: SHA256 }));
      renderNotices(changed());

      const confirm = within(await openTrustBox()).getByRole('button', { name: 'Trust this certificate' });
      fireEvent.click(confirm);
      fireEvent.click(confirm);

      expect(await screen.findByText(TRUSTED)).toBeInTheDocument();
      expect(trustOpcuaCertificate).toHaveBeenCalledTimes(1);
    });

    it('opens one confirm box and sends one request when the Admin clicks Trust new certificate two times', async () => {
      vi.mocked(trustOpcuaCertificate).mockResolvedValue(siemens({ opcuaServerThumbprint: SHA256 }));
      renderNotices(changed());

      const trust = screen.getByRole('button', { name: 'Trust new certificate' });
      fireEvent.click(trust);
      fireEvent.click(trust);
      fireEvent.click(within(await confirmBox()).getByRole('button', { name: 'Trust this certificate' }));

      expect(await screen.findByText(TRUSTED)).toBeInTheDocument();
      expect(trustOpcuaCertificate).toHaveBeenCalledTimes(1);
      noBanner();
    });

    it('sends the thumbprint that the confirm box shows, also when a different certificate comes while the box is open', async () => {
      vi.mocked(trustOpcuaCertificate).mockRejectedValue(new Error('The certificate of the control changed again.'));
      vi.mocked(fetchMachine).mockResolvedValue(changed(OTHER_SHA256, 'aa'.repeat(20)));
      const { showMachine } = renderNotices(changed());
      const box = await openTrustBox();

      showMachine(changed(OTHER_SHA256, 'aa'.repeat(20)));

      expect(within(box).getByText(SHOWN_SHA256)).toBeInTheDocument();
      fireEvent.click(within(box).getByRole('button', { name: 'Trust this certificate' }));
      expect(await screen.findByText('The certificate of the control changed again.')).toBeInTheDocument();
      expect(trustOpcuaCertificate).toHaveBeenCalledTimes(1);
      expect(trustOpcuaCertificate).toHaveBeenCalledWith('m1', SHA256);
    });

    it('removes the banner after a trust, also when a new status came while the confirm box was open', async () => {
      vi.mocked(trustOpcuaCertificate).mockResolvedValue(siemens({ opcuaServerThumbprint: SHA256 }));
      const { showMachine } = renderNotices(changed());
      const box = await openTrustBox();

      // The server sends the same change again, as a new object
      showMachine(changed());
      fireEvent.click(within(box).getByRole('button', { name: 'Trust this certificate' }));

      expect(await screen.findByText(TRUSTED)).toBeInTheDocument();
      expect(trustOpcuaCertificate).toHaveBeenCalledWith('m1', SHA256);
      noBanner();
      expect(screen.queryByRole('button', { name: 'Trust new certificate' })).not.toBeInTheDocument();
    });

    it('keeps the error and the old thumbprint when the status cannot load again after an error', async () => {
      const reason = 'The certificate of the control changed again. Chatter trusted nothing. Check the new thumbprint, then trust it.';
      vi.mocked(trustOpcuaCertificate).mockRejectedValue(new Error(reason));
      vi.mocked(fetchMachine).mockRejectedValue(new Error('Network error'));
      renderNotices(changed());

      fireEvent.click(within(await openTrustBox()).getByRole('button', { name: 'Trust this certificate' }));

      expect(await screen.findByText(reason)).toBeInTheDocument();
      await waitFor(() => expect(fetchMachine).toHaveBeenCalledWith('m1'));
      expect(within(banner()).getByText(SHOWN_SHA256)).toBeInTheDocument();
      expect(screen.queryByText('Network error')).not.toBeInTheDocument();
    });

    it('removes the old "trusts" notice when a new certificate change comes later', async () => {
      vi.mocked(trustOpcuaCertificate).mockResolvedValue(siemens({ opcuaServerThumbprint: SHA256 }));
      const { showMachine } = renderNotices(changed());
      fireEvent.click(within(await openTrustBox()).getByRole('button', { name: 'Trust this certificate' }));
      expect(await screen.findByText(TRUSTED)).toBeInTheDocument();

      showMachine(changed(OTHER_SHA256));

      expect(within(banner()).getByText('11:'.repeat(32).slice(0, -1))).toBeInTheDocument();
      expect(screen.queryByText(TRUSTED)).not.toBeInTheDocument();
    });
  });

  describe('the control shows no certificate', () => {
    it.each<Role>(['admin', 'operator', 'viewer'])('tells the role %s that the control shows no certificate', role => {
      renderNotices(changed(null, null), role);

      expect(within(banner()).getByText(/The control shows no certificate now/)).toBeInTheDocument();
      expect(within(banner()).getByText(/A login with a username needs a certificate of the control/)).toBeInTheDocument();
      expect(within(banner()).queryByRole('button', { name: 'Trust new certificate' })).not.toBeInTheDocument();
    });

    it('shows no Trust button and no SHA-1 thumbprint when the control gives a SHA-1 thumbprint but no SHA-256', () => {
      renderNotices(changed(null, SHA1));

      expect(within(banner()).getByText(/The control shows no certificate now/)).toBeInTheDocument();
      expect(within(banner()).queryByText(SHOWN_SHA1)).not.toBeInTheDocument();
      expect(within(banner()).queryByRole('button', { name: 'Trust new certificate' })).not.toBeInTheDocument();
    });

    it.each<Role>(['operator', 'viewer'])('gives the role %s no Forget button', role => {
      renderNotices(changed(null, null), role);

      expect(within(banner()).queryByRole('button')).not.toBeInTheDocument();
    });

    it('lets an Admin forget the saved certificate after a confirm that tells what the next connect trusts, with and without a certificate', async () => {
      vi.mocked(forgetOpcuaCertificate).mockResolvedValue(siemens({ opcuaServerThumbprint: null }));
      renderNotices(changed(null, null));

      fireEvent.click(within(banner()).getByRole('button', { name: 'Forget the saved certificate' }));
      const box = await confirmBox();
      expect(within(box).getByText(/If the control shows a certificate then, Chatter trusts it/)).toBeInTheDocument();
      expect(within(box).getByText(/If the control shows no certificate, Chatter trusts nothing/)).toBeInTheDocument();
      expect(within(box).getByText(/a login with a username and Security None stays offline/)).toBeInTheDocument();
      expect(within(box).getByText(/192\.168\.1\.50/)).toBeInTheDocument();
      fireEvent.click(within(box).getByRole('button', { name: 'Forget the certificate' }));

      expect(await screen.findByText('Chatter forgot the saved certificate. It connects to the control again now.')).toBeInTheDocument();
      expect(forgetOpcuaCertificate).toHaveBeenCalledWith('m1');
      expect(screen.queryByRole('alert', { name: 'Certificate changed' })).not.toBeInTheDocument();
    });

    it('forgets nothing when the Admin cancels', async () => {
      renderNotices(changed(null, null));

      fireEvent.click(within(banner()).getByRole('button', { name: 'Forget the saved certificate' }));
      fireEvent.click(within(await confirmBox()).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(forgetOpcuaCertificate).not.toHaveBeenCalled();
    });
  });

  describe('the warning for Security None with a username', () => {
    it.each<Role>(['admin', 'operator', 'viewer'])('shows the warning of the server to the role %s', role => {
      renderNotices(siemens({ opcuaUser: 'OpcUaClient', opcuaSecurityWarning: WARNING }), role);

      expect(screen.getByRole('status', { name: 'Security warning' })).toHaveTextContent(WARNING);
    });

    it('shows no warning when the server sends none', () => {
      renderNotices(siemens({ opcuaUser: 'OpcUaClient', opcuaSecurity: 'signAndEncrypt' }));

      expect(screen.queryByRole('status', { name: 'Security warning' })).not.toBeInTheDocument();
    });
  });
});
