import { writeAudit } from '../logging/audit.js';
import { createLogger } from '../logging/logger.js';
import type { LoginLog } from './loginLog.js';
import type { SessionStore } from './sessionStore.js';
import type { NewUser, UserStore } from './userStore.js';

const log = createLogger('auth');

/** 'created': a new user. 'promoted': a user who was not an Admin is now the Admin. */
export type AdminReset = 'created' | 'promoted';

/** The address in the login log: the command runs on the computer that runs Chatter, not in a browser */
export const RESET_ADDRESS = 'server terminal';

/** The stores that the reset changes. They must use one database, so the reset is one transaction. */
export interface AdminResetStores {
  users: UserStore;
  sessions: SessionStore;
  loginLog: LoginLog;
}

/** The username belongs to an Operator or a Viewer, and the person did not confirm that this user becomes the Admin */
export class PromoteNotConfirmedError extends Error {
  constructor(username: string) {
    super(`The user ${username} exists already, and is not an Admin.`);
  }
}

/**
 * The password reset from the command line: replace the Admins with one new Admin, and log out each browser.
 *
 * The old Admin accounts are removed, not made into Viewers. Nobody knows their password, or a person who should not
 * have it knows it. A removed account cannot log in again. The new Admin is always a new account, also when it has
 * the name of an old Admin, so the old logins of that name cannot come back.
 * The Operators and Viewers stay, but no browser is a known browser any more.
 *
 * When `username` belongs to an Operator or a Viewer, that user becomes the Admin with the new password,
 * but only with `promote` (the person typed PROMOTE). Else it throws PromoteNotConfirmedError.
 *
 * It is one transaction: when a step fails, nothing changes. An Admin exists before and after it,
 * so the first-run setup does not open.
 * Only a person with access to the server can do this, but it changes who controls Chatter. So the reset also adds
 * a row to the login log (Settings > Logins), and writes a warn line in the log and a line in the audit log.
 * Returns the stored username: the username has no case, so a promoted user keeps the case of its name.
 */
export function resetAdmins(
  { users, sessions, loginLog }: AdminResetStores,
  { username, passwordHash }: Omit<NewUser, 'role'>,
  { promote = false }: { promote?: boolean } = {},
): { reset: AdminReset; username: string } {
  const result = users.inTransaction(() => {
    const existing = users.findByName(username);
    if (existing && existing.role !== 'admin' && !promote) throw new PromoteNotConfirmedError(existing.username);
    users.removeAdmins();
    sessions.deleteAll();
    users.forgetAllDevices();
    const promoted = users.findByName(username);
    const reset: AdminReset = promoted ? 'promoted' : 'created';
    if (promoted) {
      users.setRole(promoted.id, 'admin');
      users.setPasswordHash(promoted.id, passwordHash);
    } else {
      users.add({ username, passwordHash, role: 'admin' });
    }
    const stored = promoted?.username ?? username;
    loginLog.record({ username: stored, address: RESET_ADDRESS, result: 'reset-password' });
    return { reset, username: stored };
  });
  const details = { username: result.username, promoted: result.reset === 'promoted' };
  log.warn('reset-password made a new Admin', details);
  writeAudit('reset-password made a new Admin', details);
  return result;
}
