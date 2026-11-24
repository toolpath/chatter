import { fireEvent, render, screen, waitFor, waitForElementToBeRemoved, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changePassword, fetchSessions, logOutOtherBrowsers, type SessionsReport } from '../../api/auth';
import { CurrentUserContext } from '../../components/CurrentUser';
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
  render(
    <CurrentUserContext.Provider value={{ username: 'machinist', role: 'operator' }}>
      <ThemeProvider><AccountTab /></ThemeProvider>
    </CurrentUserContext.Provider>,
  );
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

    // The button is off while the request runs too, so wait for the new list, not for the button
    await waitForElementToBeRemoved(() => screen.queryByText('Safari on iPad'));
    expect(logOutOtherBrowsers).toHaveBeenCalledOnce();
  });

  it('keeps the button on when no other browser is logged in, because a logged-out browser can still be a known browser', async () => {
    await renderTab(onlyThisBrowser);
    vi.mocked(logOutOtherBrowsers).mockResolvedValue(onlyThisBrowser);

    fireEvent.click(screen.getByRole('button', { name: 'Log out all other browsers' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Log out all other browsers' })).toBeEnabled());
    expect(logOutOtherBrowsers).toHaveBeenCalledOnce();
  });

  it('tells that the other browsers are new browsers for the login limits after the log out', async () => {
    await renderTab(twoBrowsers);
    const description = screen.getByText(/each other browser is a new browser for the login limits/);
    expect(description).toHaveTextContent(
      'When you click Log out all other browsers, each other browser is a new browser for the login limits.',
    );
    // The name of the button is in bold, so it reads as the name of the button
    expect(within(description).getByText('Log out all other browsers').tagName).toBe('STRONG');
  });

  it('does not send a common password, and tells the rule', async () => {
    await renderTab(twoBrowsers);
    vi.mocked(changePassword).mockReset();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'iloveyou' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'iloveyou' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('The password is too common. Use a different password')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
    expect(screen.getByText(/Do not use your username or a common password/)).toBeInTheDocument();
  });

  it('does not send the username of the user as the new password', async () => {
    await renderTab(twoBrowsers);
    vi.mocked(changePassword).mockReset();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'MACHINIST' } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'MACHINIST' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('The password cannot be the username')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
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
    // The list loads again in an effect after the notice shows, so a slow computer needs the wait
    await waitFor(() => expect(fetchSessions).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Chrome on Mac')).toBeInTheDocument();
    expect(screen.queryByText('Safari on iPad')).not.toBeInTheDocument();
  });
});
