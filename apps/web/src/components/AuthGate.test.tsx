import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthGate from './AuthGate';
import { getAuthStatus, setUpAccount } from '../api/auth';
import { requestLoginCheck } from '../api/client';

vi.mock('../api/auth', () => ({
  getAuthStatus: vi.fn(),
  logIn: vi.fn(),
  setUpAccount: vi.fn(),
}));

const mockedGetAuthStatus = vi.mocked(getAuthStatus);

const FIRST_RUN = { setupNeeded: true, loggedIn: false, user: null };
const LOGGED_OUT = { setupNeeded: false, loggedIn: false, user: null };
const LOGGED_IN_AS_ADMIN = { setupNeeded: false, loggedIn: true, user: { username: 'admin', role: 'admin' } } as const;

function renderGate() {
  render(<AuthGate><p>The dashboard</p></AuthGate>);
}

describe('AuthGate', () => {
  beforeEach(() => mockedGetAuthStatus.mockReset());

  it('asks for a new password on the first run', async () => {
    mockedGetAuthStatus.mockResolvedValue(FIRST_RUN);
    renderGate();
    expect(await screen.findByText('Welcome to Chatter')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });

  it('tells the password rule on the first run, before the user sends the form', async () => {
    mockedGetAuthStatus.mockResolvedValue(FIRST_RUN);
    renderGate();
    await screen.findByText('Welcome to Chatter');

    expect(screen.getByText(/Use 8 characters or more for the password\. Do not use the username or a common password\./)).toBeInTheDocument();
  });

  it('does not send a first-run password that is the username', async () => {
    mockedGetAuthStatus.mockResolvedValue(FIRST_RUN);
    renderGate();
    await screen.findByText('Welcome to Chatter');

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'machinist' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Machinist' } });
    fireEvent.change(screen.getByLabelText('Password again'), { target: { value: 'Machinist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('The password cannot be the username')).toBeInTheDocument();
    expect(setUpAccount).not.toHaveBeenCalled();
  });

  it('asks for the password when not logged in', async () => {
    mockedGetAuthStatus.mockResolvedValue(LOGGED_OUT);
    renderGate();
    expect(await screen.findByText('Log in to Chatter')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByText('The dashboard')).not.toBeInTheDocument();
  });

  it('shows the app after a login', async () => {
    mockedGetAuthStatus.mockResolvedValue(LOGGED_IN_AS_ADMIN);
    renderGate();
    expect(await screen.findByText('The dashboard')).toBeInTheDocument();
  });

  it('shows the login page again when the login is lost', async () => {
    mockedGetAuthStatus.mockResolvedValue(LOGGED_IN_AS_ADMIN);
    renderGate();
    await screen.findByText('The dashboard');

    mockedGetAuthStatus.mockResolvedValue(LOGGED_OUT);
    requestLoginCheck();
    expect(await screen.findByText('Log in to Chatter')).toBeInTheDocument();
  });
});
