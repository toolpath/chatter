import type { Role } from '@local-chatter/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CurrentUserContext } from '../../components/CurrentUser';
import { SettingsPage } from './SettingsPage';

vi.mock('./AccountTab', () => ({ AccountTab: () => <p>account tab</p> }));
vi.mock('./ProxyTab', () => ({ ProxyTab: () => <p>proxy tab</p> }));
vi.mock('./LoginsTab', () => ({ LoginsTab: () => <p>logins tab</p> }));
vi.mock('./UsersTab', () => ({ UsersTab: () => <p>users tab</p> }));
vi.mock('./UpdatesTab', () => ({ UpdatesTab: () => <p>updates tab</p> }));
vi.mock('./NotificationsTab', () => ({ NotificationsTab: () => <p>notifications tab</p> }));
vi.mock('../../api/updates', () => ({ fetchChatterVersion: vi.fn().mockResolvedValue('1.2.0') }));

function renderAt(address: string, role: Role = 'admin') {
  render(
    <CurrentUserContext.Provider value={{ username: 'sam', role }}>
      <MemoryRouter initialEntries={[address]}>
        <SettingsPage />
      </MemoryRouter>
    </CurrentUserContext.Provider>,
  );
}

describe('SettingsPage', () => {
  it('opens the account tab first', () => {
    renderAt('/settings');
    expect(screen.getByText('account tab')).toBeInTheDocument();
  });

  it('opens the tab that the address names', () => {
    renderAt('/settings?tab=proxy');
    expect(screen.getByRole('tab', { name: 'HTTPS and proxy' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('proxy tab')).toBeInTheDocument();
  });

  it('opens the account tab for an unknown tab name', () => {
    renderAt('/settings?tab=nonsense');
    expect(screen.getByText('account tab')).toBeInTheDocument();
  });

  it('changes the tab on a click', () => {
    renderAt('/settings');
    fireEvent.click(screen.getByRole('tab', { name: 'HTTPS and proxy' }));
    expect(screen.getByText('proxy tab')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Logins' }));
    expect(screen.getByText('logins tab')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Users and roles' }));
    expect(screen.getByText('users tab')).toBeInTheDocument();
  });

  it('shows the Updates tab to an admin', () => {
    renderAt('/settings?tab=updates');
    expect(screen.getByText('updates tab')).toBeInTheDocument();
  });

  it('shows the Notifications tab to an admin', () => {
    renderAt('/settings?tab=notifications');
    expect(screen.getByText('notifications tab')).toBeInTheDocument();
  });

  it('shows the Chatter version to each user', async () => {
    renderAt('/settings', 'viewer');
    expect(await screen.findByText('Chatter version 1.2.0')).toBeInTheDocument();
  });

  it('shows only Your account to a user who is not an admin', () => {
    renderAt('/settings?tab=proxy', 'operator');
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Your account']);
    expect(screen.getByText('account tab')).toBeInTheDocument();
  });
});
