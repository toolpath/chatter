import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Dialog } from '@toolpath/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addUser, changeRole, fetchUsersReport, removeUser, setUserPassword, type UsersReport } from '../../api/settings';
import { UsersTab } from './UsersTab';

vi.mock('../../api/settings', () => ({
  fetchUsersReport: vi.fn(),
  addUser: vi.fn(),
  changeRole: vi.fn(),
  setUserPassword: vi.fn(),
  removeUser: vi.fn(),
}));

const PASSWORD = 'a-good-password';
const ADMIN = { id: 1, username: 'admin', role: 'admin' as const, createdAt: '', lastLoginAt: new Date().toISOString(), isYou: true };
const SAM = { id: 2, username: 'sam', role: 'operator' as const, createdAt: '', lastLoginAt: null, isYou: false };
const report = (...users: UsersReport['users']): UsersReport => ({ users });

async function renderTab() {
  render(
    <Dialog.Provider>
      <UsersTab />
    </Dialog.Provider>,
  );
  await screen.findByText('Users');
}

const typeInto = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const rowOf = (username: string) => screen.getByRole('cell', { name: new RegExp(`^${username}`) }).closest('tr')!;
const addUserForm = () => screen.getByRole('dialog', { name: 'Add a user' });
const submitAddUserForm = () => fireEvent.click(within(addUserForm()).getByRole('button', { name: 'Add user' }));

describe('UsersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchUsersReport).mockResolvedValue(report(ADMIN, SAM));
  });

  it('lists the users with their role and last login', async () => {
    await renderTab();

    expect(rowOf('admin')).toHaveTextContent('(you)');
    expect(rowOf('sam')).toHaveTextContent('Operator');
    expect(rowOf('sam')).toHaveTextContent('Never');
  });

  it('gives no actions for yourself', async () => {
    await renderTab();

    expect(within(rowOf('admin')).queryByRole('button')).toBeNull();
    expect(within(rowOf('sam')).getAllByRole('button')).toHaveLength(3);
  });

  it('adds a user', async () => {
    vi.mocked(addUser).mockResolvedValue(report(ADMIN, SAM, { ...SAM, id: 3, username: 'jo', role: 'viewer' }));
    await renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    typeInto('Username', ' jo ');
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'viewer' } });
    typeInto('Password', PASSWORD);
    typeInto('Password again', PASSWORD);
    submitAddUserForm();

    await screen.findByRole('cell', { name: 'jo' });
    expect(addUser).toHaveBeenCalledWith({ username: 'jo', password: PASSWORD, role: 'viewer' });
    expect(screen.queryByRole('dialog', { name: 'Add a user' })).toBeNull();
  });

  it('does not send two passwords that are not the same', async () => {
    await renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    typeInto('Username', 'jo');
    typeInto('Password', PASSWORD);
    typeInto('Password again', 'another-password');
    submitAddUserForm();

    expect(screen.getByText('The two passwords are not the same')).toBeInTheDocument();
    expect(addUser).not.toHaveBeenCalled();
  });

  it('shows the reason of the server, and keeps the form open', async () => {
    vi.mocked(addUser).mockRejectedValue(new Error('A user with this username exists already'));
    await renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    typeInto('Username', 'sam');
    typeInto('Password', PASSWORD);
    typeInto('Password again', PASSWORD);
    submitAddUserForm();

    expect(await screen.findByText('A user with this username exists already')).toBeInTheDocument();
    expect(addUserForm()).toBeInTheDocument();
  });

  it('changes the role of a user', async () => {
    vi.mocked(changeRole).mockResolvedValue(report(ADMIN, { ...SAM, role: 'viewer' }));
    await renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Change the role of sam' }));
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'viewer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change role' }));

    await waitFor(() => expect(rowOf('sam')).toHaveTextContent('Viewer'));
    expect(changeRole).toHaveBeenCalledWith(2, 'viewer');
  });

  it('sets a new password for a user', async () => {
    vi.mocked(setUserPassword).mockResolvedValue(report(ADMIN, SAM));
    await renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Set a new password for sam' }));
    typeInto('Password', PASSWORD);
    typeInto('Password again', PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(setUserPassword).toHaveBeenCalledWith(2, PASSWORD));
  });

  it('removes a user after you confirm', async () => {
    vi.mocked(removeUser).mockResolvedValue(report(ADMIN));
    await renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Remove sam' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the user' }));

    await waitFor(() => expect(screen.queryByRole('cell', { name: 'sam' })).toBeNull());
    expect(removeUser).toHaveBeenCalledWith(2);
  });

  it.each([
    ['Add user', 'Add a user'],
    ['Change the role of sam', 'Change the role of sam'],
    ['Set a new password for sam', 'Set a new password for sam'],
  ])('opens %s in a modal, and closes it with the X button', async (button, title) => {
    await renderTab();

    fireEvent.click(screen.getByRole('button', { name: button }));
    const modal = screen.getByRole('dialog', { name: title });
    expect(modal).toHaveAttribute('open');

    fireEvent.click(within(modal).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open while it saves, so the X does not lose the form', async () => {
    vi.mocked(setUserPassword).mockReturnValue(new Promise(() => {}));
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Set a new password for sam' }));
    typeInto('Password', PASSWORD);
    typeInto('Password again', PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await screen.findByRole('button', { name: 'Saving…' });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByRole('dialog', { name: 'Set a new password for sam' })).toBeInTheDocument();
  });

  it('shows what each role can do', async () => {
    await renderTab();
    const table = screen.getByRole('region', { name: 'What each role can do' });

    expect(within(table).getByRole('row', { name: /Send and delete files/ })).toHaveTextContent('NoYesYes');
    expect(within(table).getByRole('row', { name: /Manage users/ })).toHaveTextContent('NoNoYes');
    expect(within(table).getByRole('row', { name: /Update Chatter/ })).toHaveTextContent('NoNoYes');
  });
});
