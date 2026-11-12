import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { getAuthStatus, logIn, setUpAccount } from '../api/auth';
import { onLoginCheckNeeded } from '../api/client';
import { CurrentUserContext, type CurrentUser } from './CurrentUser';
import { Wordmark } from './layout/Logo';
import { newPasswordProblem, PasswordField, UsernameField, useSubmitState } from './PasswordForm';
import { Button } from './ui/Button';
import { Notice } from './ui/Notice';

type GateState =
  | { kind: 'checking' }
  | { kind: 'setup' }
  | { kind: 'login' }
  | { kind: 'open'; user: CurrentUser | null }
  | { kind: 'unreachable' };

type AuthStatus = Awaited<ReturnType<typeof getAuthStatus>>;

function gateStateFor(status: AuthStatus): GateState {
  if (status.setupNeeded) return { kind: 'setup' };
  if (status.loggedIn) return { kind: 'open', user: status.user };
  return { kind: 'login' };
}

/**
 * Shows its children only after a login.
 * On the first run it asks for a new username and password. After that it asks for them to log in.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' });

  const checkLogin = useCallback(async () => {
    try {
      setState(gateStateFor(await getAuthStatus()));
    } catch {
      setState({ kind: 'unreachable' });
    }
  }, []);

  useEffect(() => {
    checkLogin();
    return onLoginCheckNeeded(checkLogin);
  }, [checkLogin]);

  switch (state.kind) {
    case 'open':
      return <CurrentUserContext.Provider value={state.user}>{children}</CurrentUserContext.Provider>;
    case 'setup':
      return <SetupPage onSuccess={checkLogin} />;
    case 'login':
      return <LoginPage onSuccess={checkLogin} />;
    case 'unreachable':
      return <AuthMessage>Cannot reach the Chatter server. Reload the page to try again.</AuthMessage>;
    case 'checking':
      return <AuthMessage>Loading…</AuthMessage>;
  }
}

/** One line of text in place of a form, such as while the login check runs */
function AuthMessage({ children }: { children: ReactNode }) {
  return (
    <AuthLayout>
      <p className="m-0 text-center text-zinc-200">{children}</p>
    </AuthLayout>
  );
}

/** The word mark above a centered card, on an empty dark page */
function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-[25rem] flex-col gap-6">
        <div className="flex justify-center">
          <Wordmark size={32} cutClassName="bg-zinc-950" byline />
        </div>
        {children}
      </div>
    </div>
  );
}

interface AuthFormProps {
  title: string;
  intro?: ReactNode;
  error: string | null;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}

function AuthForm({ title, intro, error, onSubmit, children }: AuthFormProps) {
  return (
    <form
      aria-labelledby="auth-title"
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-7"
    >
      <h1 id="auth-title" className="m-0 font-display text-[1.375rem] font-extrabold">{title}</h1>
      {intro && <p className="m-0 text-zinc-200">{intro}</p>}
      {children}
      {error && <Notice tone="error" title={error} />}
    </form>
  );
}

interface SubmitButtonProps {
  isBusy: boolean;
  /** The text while the form is sent, such as "Saving…" */
  busyText: string;
  children: ReactNode;
}

function SubmitButton({ isBusy, busyText, children }: SubmitButtonProps) {
  return (
    <Button type="submit" variant="primary" disabled={isBusy} className="min-h-11 justify-center">
      {isBusy ? busyText : children}
    </Button>
  );
}

function SetupPage({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const { error, isSubmitting, submit, setError } = useSubmitState();

  const handleSubmit = async (event: FormEvent) => {
    const problem = newPasswordProblem(password, confirmation);
    if (problem) {
      event.preventDefault();
      setError(problem);
      return;
    }
    if (await submit(event, () => setUpAccount({ username, password }))) onSuccess();
  };

  return (
    <AuthLayout>
      <AuthForm
        title="Welcome to Chatter"
        intro="Make an account to get started."
        error={error}
        onSubmit={handleSubmit}
      >
        <UsernameField value={username} onChange={setUsername} />
        <PasswordField id="new-password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" />
        <PasswordField id="confirm-password" label="Password again" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
        <SubmitButton isBusy={isSubmitting} busyText="Saving…">Create account</SubmitButton>
      </AuthForm>
    </AuthLayout>
  );
}

function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { error, isSubmitting, submit } = useSubmitState();

  const handleSubmit = async (event: FormEvent) => {
    if (await submit(event, () => logIn({ username, password }))) onSuccess();
  };

  return (
    <AuthLayout>
      <AuthForm title="Log in to Chatter" error={error} onSubmit={handleSubmit}>
        <UsernameField value={username} onChange={setUsername} />
        <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <SubmitButton isBusy={isSubmitting} busyText="Logging in…">Log in</SubmitButton>
      </AuthForm>
    </AuthLayout>
  );
}

export default AuthGate;
