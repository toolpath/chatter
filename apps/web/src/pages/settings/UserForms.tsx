import { ROLES, type Role, type UserToAdd } from '@local-chatter/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { ChatterUser } from '../../api/settings';
import { newPasswordProblem, PasswordField } from '../../components/PasswordForm';
import { Button } from '../../components/ui/Button';
import { CloseButton } from '../../components/ui/CloseButton';
import { Field, SelectInput, TextInput } from '../../components/ui/fields';
import { Modal } from '../../components/ui/Modal';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { ROLE_LABELS } from '../../utils/roleLabels';

/** What each form has in common */
export interface FormState {
  /** The server's reason when the last save failed */
  error: string | null;
  isSaving: boolean;
  onCancel: () => void;
}

interface UserFormProps extends FormState {
  title: string;
  description?: string;
  saveLabel: string;
  /** A problem that the form finds before it sends, or null */
  problem: string | null;
  onSave: () => void;
  children: ReactNode;
}

/** A modal with a form, a Save button, a Cancel button, and an X button */
function UserForm({ title, description, saveLabel, problem, onSave, error, isSaving, onCancel, children }: UserFormProps) {
  const [shownProblem, setShownProblem] = useState<string | null>(null);
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setShownProblem(problem);
    if (!problem) onSave();
  };
  const message = shownProblem ?? error;
  // A close during a save would lose the form, and the end of the save could close another form
  const close = isSaving ? () => {} : onCancel;

  return (
    <Modal label={title} onClose={close}>
      <Panel title={title} description={description} actions={<CloseButton onClick={close} />}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-4">
          {/* 2 columns, so that the 2 password boxes are on one line */}
          <div className="grid grid-cols-1 items-end gap-3.5 sm:grid-cols-2">{children}</div>
          {message && <Notice tone="error" title={message} />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onCancel} disabled={isSaving}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSaving}>{isSaving ? 'Saving…' : saveLabel}</Button>
          </div>
        </form>
      </Panel>
    </Modal>
  );
}

function RoleField({ id, value, onChange }: { id: string; value: Role; onChange: (role: Role) => void }) {
  return (
    <Field id={id} label="Role">
      <SelectInput id={id} value={value} onChange={event => onChange(event.target.value as Role)}>
        {ROLES.map(role => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
      </SelectInput>
    </Field>
  );
}

/** A new password, typed two times */
function useNewPassword() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const fields = (
    <>
      <PasswordField id="user-password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" />
      <PasswordField id="user-password-again" label="Password again" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
    </>
  );
  return { password, problem: newPasswordProblem(password, confirmation), fields };
}

export function AddUserForm({ onAdd, ...state }: FormState & { onAdd: (user: UserToAdd) => void }) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const newPassword = useNewPassword();
  const trimmedUsername = username.trim();

  return (
    <UserForm
      title="Add a user"
      description="Give the username and the password to the person. They can change the password on Your account."
      saveLabel="Add user"
      problem={trimmedUsername ? newPassword.problem : 'Type a username'}
      onSave={() => onAdd({ username: trimmedUsername, password: newPassword.password, role })}
      {...state}
    >
      <Field id="new-username" label="Username">
        <TextInput
          id="new-username"
          value={username}
          onChange={event => setUsername(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          required
        />
      </Field>
      <RoleField id="new-user-role" value={role} onChange={setRole} />
      {newPassword.fields}
    </UserForm>
  );
}

interface ChangeRoleFormProps extends FormState {
  user: ChatterUser;
  onChange: (role: Role) => void;
}

export function ChangeRoleForm({ user, onChange, ...state }: ChangeRoleFormProps) {
  const [role, setRole] = useState<Role>(user.role);
  return (
    <UserForm
      title={`Change the role of ${user.username}`}
      description="Chatter uses the new role at once. A page that the user has open shows it after a reload."
      saveLabel="Change role"
      problem={null}
      onSave={() => onChange(role)}
      {...state}
    >
      <RoleField id="changed-role" value={role} onChange={setRole} />
    </UserForm>
  );
}

interface SetPasswordFormProps extends FormState {
  user: ChatterUser;
  onSet: (password: string) => void;
}

export function SetPasswordForm({ user, onSet, ...state }: SetPasswordFormProps) {
  const newPassword = useNewPassword();
  return (
    <UserForm
      title={`Set a new password for ${user.username}`}
      description={`Each browser of ${user.username} is logged out. Give the new password to the person.`}
      saveLabel="Set password"
      problem={newPassword.problem}
      onSave={() => onSet(newPassword.password)}
      {...state}
    >
      {newPassword.fields}
    </UserForm>
  );
}
