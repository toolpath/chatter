import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changePassword, fetchSessions, logOutOtherBrowsers, type SessionsReport } from '../../api/auth';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { AccountTab } from './AccountTab';

vi.mock('../../api/auth', () => ({
  changePassword: vi.fn(),
  fetchSessions: vi.fn(),
  logOut: vi.fn(),
  logOutOtherBrowsers: vi.fn(),
}));

const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();

function browser(device: string, isThisBrowser: boolean): SessionsReport['sessions'][number] {
  return { device, address: '192.168.1.20', createdAt: anHourAgo, lastSeenAt: anHourAgo, isThisBrowser };
}

const twoBrowsers: SessionsReport = { sessions: [browser('Chrome on Mac', true), browser('Safari on iPad', false)] };
const onlyThisBrowser: SessionsReport = { sessions: [browser('Chrome on Mac', true)] };

async function renderTab(loaded: SessionsReport) {
  vi.mocked(fetchSessions).mockResolvedValue(loaded);
  render(<ThemeProvider><AccountTab /></ThemeProvider>);
  await screen.findByText('Chrome on Mac');
}

describe('AccountTab', () => {
  beforeEach(() => {
    vi.mocked(fetchSessions).mockReset();
    vi.mocked(logOutOtherBrowsers).mockReset();
  });

  it('lists each browser, and marks this one', async () => {
    await renderTab(twoBrowsers);

    const [thisBrowser, otherBrowser] = screen.getAllByRole('listitem');
    expect(thisBrowser).toHaveTextContent('This browser');
    expect(thisBrowser).toHaveTextContent('192.168.1.20 · Active now');
    expect(otherBrowser).toHaveTextContent('Safari on iPad');
    expect(otherBrowser).toHaveTextContent('Last used 1 h ago');
  });

  it('logs out the other browsers', async () => {
    await renderTab(twoBrowsers);
    vi.mocked(logOutOtherBrowsers).mockResolvedValue(onlyThisBrowser);

    fireEvent.click(screen.getByRole('button', { name: 'Log out all other browsers' }));

    expect(await screen.findByRole('button', { name: 'Log out all other browsers' })).toBeDisabled();
    expect(screen.queryByText('Safari on iPad')).not.toBeInTheDocument();
  });

  it('turns off the button when no other browser is logged in', async () => {
    await renderTab(onlyThisBrowser);
    expect(screen.getByRole('button', { name: 'Log out all other browsers' })).toBeDisabled();
  });

  it('loads the list again after a new password, because the other browsers are logged out', async () => {
    await renderTab(twoBrowsers);
    vi.mocked(changePassword).mockResolvedValue({ ok: true });
    vi.mocked(fetchSessions).mockResolvedValue(onlyThisBrowser);

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('The password is changed')).toBeInTheDocument();
    expect(fetchSessions).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Chrome on Mac')).toBeInTheDocument();
    expect(screen.queryByText('Safari on iPad')).not.toBeInTheDocument();
  });
});
