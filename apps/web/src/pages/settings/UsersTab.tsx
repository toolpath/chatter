import { PERMISSIONS, roleCan, ROLES, type Permission, type Role } from '@local-chatter/shared';
import { cn, Dialog } from '@toolpath/ui';
import { useState } from 'react';
import {
  addUser,
  changeRole,
  fetchUsersReport,
  removeUser,
  setUserPassword,
  type ChatterUser,
  type UsersReport,
} from '../../api/settings';
import { Button } from '../../components/ui/Button';
import { PlusIcon } from '../../components/ui/icons';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import { formatAgo } from '../../utils/formatters';
import { ROLE_LABELS } from '../../utils/roleLabels';
import { ReportPending } from './ReportPending';
import { AddUserForm, ChangeRoleForm, SetPasswordForm, type FormState } from './UserForms';
import { useServerReport } from './useServerReport';

/** The form that is open: none, or one at a time */
type OpenForm =
  | { kind: 'add' }
  | { kind: 'role'; user: ChatterUser }
  | { kind: 'password'; user: ChatterUser }
  | null;

const ROLE_BADGES: Record<Role, string> = {
  admin: 'bg-primary text-on-primary',
  operator: 'bg-zinc-700 text-zinc-50',
  viewer: 'bg-zinc-800 text-zinc-200',
};

/** The rows of "What each role can do". The first rows are the same for each role. */
const EVERYONE_CAN = ['See machines and history', 'Download files'];
const PERMISSION_LABELS: Record<Permission, string> = {
  'send-files': 'Send and delete files',
  'manage-machines': 'Add, change, or remove machines',
  'manage-chatter': 'Manage users, HTTPS, the proxy, and logins',
  'manage-updates': 'Update Chatter',
};

interface RoleTableRow {
  action: string;
  can: (role: Role) => boolean;
}

/** Made from the same rules that the server checks */
const ROLE_TABLE_ROWS: RoleTableRow[] = [
  ...EVERYONE_CAN.map(action => ({ action, can: (_role: Role) => true })),
  ...PERMISSIONS.map(permission => ({ action: PERMISSION_LABELS[permission], can: (role: Role) => roleCan(role, permission) })),
];

/** The Chatter users: add them, change their roles, set a new password for them, or remove them */
export function UsersTab() {
  const { report, loadError, changeError, isChanging, change } = useServerReport(fetchUsersReport);
  const [openForm, setOpenForm] = useState<OpenForm>(null);
  const { confirm } = Dialog.useDialog();

  if (loadError || !report) return <ReportPending loadError={loadError} />;

  const saveAndClose = async (save: () => Promise<UsersReport>) => {
    if (await change(save)) setOpenForm(null);
  };
  const remove = async (user: ChatterUser) => {
    setOpenForm(null);
    if (await confirm(removeUserDialog(user))) await change(() => removeUser(user.id));
  };
  const formState = { error: changeError, isSaving: isChanging, onCancel: () => setOpenForm(null) };
  const userActions: UserActions = {
    onChangeRole: user => setOpenForm({ kind: 'role', user }),
    onSetPassword: user => setOpenForm({ kind: 'password', user }),
    onRemove: remove,
  };

  return (
    <>
      {!openForm && changeError && <Notice tone="error" title={changeError} />}
      <OpenUserForm openForm={openForm} formState={formState} saveAndClose={saveAndClose} />
      <UsersPanel users={report.users} onAdd={() => setOpenForm({ kind: 'add' })} actions={userActions} />
      <RolesPanel />
    </>
  );
}

function removeUserDialog(user: ChatterUser) {
  return (
    <Dialog variant="danger">
      <Dialog.Title>Remove {user.username}?</Dialog.Title>
      <Dialog.Message>{user.username} cannot log in after this, and each of their browsers is logged out.</Dialog.Message>
      <Dialog.Actions>
        <Dialog.Dismiss>Keep the user</Dialog.Dismiss>
        <Dialog.Confirm>Remove the user</Dialog.Confirm>
      </Dialog.Actions>
    </Dialog>
  );
}

interface OpenUserFormProps {
  openForm: OpenForm;
  formState: FormState;
  /** Runs the save, and closes the form when it worked */
  saveAndClose: (save: () => Promise<UsersReport>) => Promise<void>;
}

function OpenUserForm({ openForm, formState, saveAndClose }: OpenUserFormProps) {
  switch (openForm?.kind) {
    case 'add':
      return <AddUserForm onAdd={user => saveAndClose(() => addUser(user))} {...formState} />;
    case 'role':
      return (
        <ChangeRoleForm
          key={openForm.user.id}
          user={openForm.user}
          onChange={role => saveAndClose(() => changeRole(openForm.user.id, role))}
          {...formState}
        />
      );
    case 'password':
      return (
        <SetPasswordForm
          key={openForm.user.id}
          user={openForm.user}
          onSet={password => saveAndClose(() => setUserPassword(openForm.user.id, password))}
          {...formState}
        />
      );
    default:
      return null;
  }
}

/** What an admin can do to another user */
interface UserActions {
  onChangeRole: (user: ChatterUser) => void;
  onSetPassword: (user: ChatterUser) => void;
  onRemove: (user: ChatterUser) => void;
}

interface UsersPanelProps {
  users: ChatterUser[];
  onAdd: () => void;
  actions: UserActions;
}

function UsersPanel({ users, onAdd, actions }: UsersPanelProps) {
  const now = Date.now();
  const addButton = (
    <Button variant="primary" onClick={onAdd}>
      <PlusIcon /> Add user
    </Button>
  );
  return (
    <Panel title="Users" description="Only an admin can add users or change a role." actions={addButton}>
      <div className="overflow-x-auto">
        <table className={cn(TABLE, 'min-w-[40rem]')}>
          <thead>
            <tr className={HEAD_ROW}>
              <th scope="col" className={HEAD_CELL}>User</th>
              <th scope="col" className={HEAD_CELL}>Role</th>
              <th scope="col" className={HEAD_CELL}>Last login</th>
              <th scope="col" className={cn(HEAD_CELL, 'text-right')}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => <UserRow key={user.id} user={user} now={now} actions={actions} />)}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function UserRow({ user, now, actions }: { user: ChatterUser; now: number; actions: UserActions }) {
  return (
    <tr className={ROW}>
      <td className={cn(CELL, 'font-semibold')}>
        {user.username} {user.isYou && <span className="text-xs font-normal text-zinc-300">(you)</span>}
      </td>
      <td className={CELL}><RoleBadge role={user.role} /></td>
      <td className={cn(CELL, 'text-zinc-200')}>{user.lastLoginAt ? formatAgo(user.lastLoginAt, now) : 'Never'}</td>
      <td className={cn(CELL, 'text-right whitespace-nowrap')}>
        {/* You change your own password on Your account. You cannot change your own role or remove yourself. */}
        {!user.isYou && (
          <span className="inline-flex gap-2">
            <Button size="sm" onClick={() => actions.onChangeRole(user)} aria-label={`Change the role of ${user.username}`}>Change role</Button>
            <Button size="sm" onClick={() => actions.onSetPassword(user)} aria-label={`Set a new password for ${user.username}`}>Reset password</Button>
            <Button size="sm" variant="quiet" onClick={() => actions.onRemove(user)} aria-label={`Remove ${user.username}`}>Remove</Button>
          </span>
        )}
      </td>
    </tr>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <span className={cn('inline-flex h-6.5 items-center rounded-md px-2.5 text-xs font-bold', ROLE_BADGES[role])}>
      {ROLE_LABELS[role]}
    </span>
  );
}

/** A table of the roles and what each one can do */
function RolesPanel() {
  return (
    <Panel title="What each role can do">
      <div className="overflow-x-auto">
        <table className={cn(TABLE, 'min-w-[32rem]')}>
          <thead>
            <tr className={HEAD_ROW}>
              <th scope="col" className={HEAD_CELL}>Action</th>
              {ROLES.map(role => <th key={role} scope="col" className={cn(HEAD_CELL, 'text-center')}>{ROLE_LABELS[role]}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROLE_TABLE_ROWS.map(({ action, can }) => (
              <tr key={action} className={ROW}>
                <th scope="row" className={cn(CELL, 'text-left font-medium')}>{action}</th>
                {ROLES.map(role => (
                  <td key={role} className={cn(CELL, 'text-center', can(role) ? 'text-primary-text' : 'text-zinc-300')}>
                    {can(role) ? 'Yes' : 'No'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
