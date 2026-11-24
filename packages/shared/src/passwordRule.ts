import { COMMON_PASSWORDS } from './commonPasswords.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './requests.js';

/** The same text for a password and a username: no case, and no spaces at the two ends */
const comparable = (text: string) => text.trim().toLowerCase();

/**
 * The rule for a new password: in the first-run setup, for a new user, for a new password, and in `reset-password`.
 * The server, the web forms and `reset-password` all use it. Login does not use it, so an old password keeps working.
 * Returns the problem, or null when the password is good.
 */
export function newPasswordProblem(password: string, username: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `The password must have at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return 'The password is too long';
  const candidate = comparable(password);
  if (candidate === comparable(username)) return 'The password cannot be the username';
  if (COMMON_PASSWORDS.has(candidate)) return 'The password is too common. Use a different password';
  return null;
}
