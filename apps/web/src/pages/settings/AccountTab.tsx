import { useState, type FormEvent } from 'react';
import { changePassword, fetchSessions, logOut, logOutOtherBrowsers, type BrowserSession } from '../../api/auth';
import { useCurrentUser } from '../../components/CurrentUser';
import { newPasswordProblem, PasswordField, useSubmitState } from '../../components/PasswordForm';
import { Button } from '../../components/ui/Button';
import { LogOutIcon } from '../../components/ui/icons';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { formatAgo } from '../../utils/formatters';
import { ROLE_LABELS } from '../../utils/roleLabels';
import { AppearancePanel } from './AppearancePanel';
import { useServerReport } from './useServerReport';

/** The Chatter account: pick the colors, change the password, see where it is logged in, or log out */
export function AccountTab() {
  // A new password logs out the other browsers, so the list loads again after it
  const [passwordChanges, setPasswordChanges] = useState(0);
  return (
    <>
      <AccountCard />
      <AppearancePanel />
      <ChangePasswordPanel onChanged={() => setPasswordChanges(count => count + 1)} />
      <SessionsPanel key={passwordChanges} />
    </>
  );
}

function AccountCard() {
  const user = useCurrentUser();
  const username = user?.username;
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-4 p-5">
        <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-full bg-primary text-xl font-bold text-on-primary uppercase">
          {username?.charAt(0) ?? '?'}
        </span>
        <div className="flex flex-[1_1_12.5rem] flex-col">
          <h2 className="m-0 text-lg font-bold">{username}</h2>
          <span className="text-zinc-200">
            {user && ROLE_LABELS[user.role]}. Programs that use the API can log in with your username and password too.
          </span>
        </div>
        <Button onClick={logOut}><LogOutIcon /> Log out</Button>
      </div>
    </Panel>
  );
}

function ChangePasswordPanel({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isChanged, setIsChanged] = useState(false);
  const { error, isSubmitting, submit, setError } = useSubmitState();

  const clearPasswordFields = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmation('');
  };

  const handleSubmit = async (event: FormEvent) => {
    setIsChanged(false);
    const problem = newPasswordProblem(newPassword, confirmation);
    if (problem) {
      event.preventDefault();
      setError(problem);
      return;
    }
    if (await submit(event, () => changePassword(currentPassword, newPassword))) {
      setIsChanged(true);
      onChanged();
      clearPasswordFields();
    }
  };

  return (
    <Panel title="Change the password" description="Use 8 characters or more. After this, other browsers and programs must use the new password.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(13.75rem,1fr))] gap-3.5">
          <PasswordField id="current-password" label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
          <PasswordField id="new-password" label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordField id="confirm-password" label="New password again" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
        </div>
        {error && <Notice tone="error" title={error} />}
        {isChanged && <Notice tone="success" title="The password is changed" onClose={() => setIsChanged(false)} />}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Change password'}</Button>
        </div>
      </form>
    </Panel>
  );
}

function SessionsPanel() {
  const { report, loadError, changeError, isChanging, change } = useServerReport(fetchSessions);
  const sessions = report?.sessions ?? [];
  const hasOtherBrowsers = sessions.some(session => !session.isThisBrowser);
  const logOutOthersButton = (
    <Button onClick={() => change(logOutOtherBrowsers)} disabled={!hasOtherBrowsers || isChanging}>
      Log out all other browsers
    </Button>
  );

  return (
    <Panel
      title="Where you are logged in"
      description="A browser stays logged in for 1 year, or until you log it out. Programs that send the password are not on this list."
      actions={logOutOthersButton}
    >
      {loadError && <Notice tone="error" title={loadError} className="mx-5 my-4" />}
      {changeError && <Notice tone="error" title={changeError} className="mx-5 my-4" />}
      {!report && !loadError && <p className="m-0 px-5 py-4 text-zinc-300">Loading…</p>}
      <ul className="m-0 list-none p-0">
        {sessions.map((session, index) => (
          // Two browsers can have the same name and address, so the place in the list is the key
          <SessionRow key={index} session={session} />
        ))}
      </ul>
    </Panel>
  );
}

function SessionRow({ session }: { session: BrowserSession }) {
  return (
    <li className="flex flex-col gap-0.5 border-t border-zinc-800 px-5 py-3 first:border-t-0">
      <span className="font-semibold">
        {session.device}
        {session.isThisBrowser && <span className="ml-2 text-xs text-primary-text">This browser</span>}
      </span>
      <span className="text-xs text-zinc-300">
        <span className="font-mono">{session.address}</span>
        {' · '}
        {session.isThisBrowser ? 'Active now' : `Last used ${formatAgo(session.lastSeenAt, Date.now())}`}
      </span>
    </li>
  );
}
