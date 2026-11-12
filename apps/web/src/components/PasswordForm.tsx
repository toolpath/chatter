import { useState, type FormEvent } from 'react';
import type { AuthResult } from '../api/auth';
import { MIN_PASSWORD_LENGTH } from '../types';
import { Field, TextInput } from './ui/fields';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
}

export function PasswordField({ id, label, value, onChange, autoComplete, autoFocus }: PasswordFieldProps) {
  return (
    <Field id={id} label={label}>
      <TextInput
        id={id}
        type="password"
        value={value}
        onChange={event => onChange(event.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
      />
    </Field>
  );
}

interface UsernameFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function UsernameField({ value, onChange }: UsernameFieldProps) {
  return (
    <Field id="username" label="Username">
      <TextInput
        id="username"
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        autoFocus
        required
      />
    </Field>
  );
}

/** Returns the problem with a new password and its second copy, or null when both are good */
export function newPasswordProblem(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `The password must have at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password !== confirmation) return 'The two passwords are not the same';
  return null;
}

interface SubmitState {
  error: string | null;
  isSubmitting: boolean;
  /** Run `send` and keep its error. Returns true when it worked. */
  submit: (event: FormEvent, send: () => Promise<AuthResult>) => Promise<boolean>;
  setError: (error: string | null) => void;
}

/** The busy flag and the error text of a password form */
export function useSubmitState(): SubmitState {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent, send: () => Promise<AuthResult>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await send();
      if (!result.ok) setError(result.error ?? 'Something went wrong. Try again.');
      return result.ok;
    } catch {
      setError('Cannot reach the Chatter server. Try again.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  return { error, isSubmitting, submit, setError };
}
