import { Hono } from 'hono';
import { LOCK_MINUTES, MAX_FAILURES, MAX_USER_FAILURES, type LoginLimiter } from '../auth/LoginLimiter.js';
import type { LoginLog } from '../auth/loginLog.js';
import { maskedOnce, usernameForLog } from '../auth/unknownUsername.js';
import { requirePermission, type LoggedInEnv } from '../auth/authRoutes.js';
import type { ProxySettings } from '../auth/proxySettings.js';
import { originOf } from '../auth/requestOrigin.js';
import { createLogger } from '../logging/logger.js';
import { checkedJson } from './checks.js';
import { unlockSchema } from './schemas.js';

const log = createLogger('auth');

interface LoginSettingsParts {
  auth: { hasUser(username: string): boolean };
  limiter: LoginLimiter;
  loginLog: LoginLog;
  proxySettings: ProxySettings;
}

/**
 * One row for each address and masked name. Two unknown usernames can have the same masked name, and the web page
 * uses the name as a key. The row keeps the lock that ends last. An unlock removes the locks of all such usernames.
 */
function oneRowEach<Locked extends { address?: string; username: string; until: Date }>(rows: Locked[]): Locked[] {
  const byName = new Map<string, Locked>();
  for (const row of rows) {
    const key = JSON.stringify([row.address, row.username]);
    const kept = byName.get(key);
    if (!kept || row.until > kept.until) byName.set(key, row);
  }
  return [...byName.values()];
}

/** What the Settings page shows on the "Logins" tab */
function loginsReport({ auth, limiter, loginLog }: LoginSettingsParts) {
  // An unknown username can be a password, so the lists show it masked, as the login log does
  const shown = <Locked extends { username: string; until: Date }>(locked: Locked[]) =>
    oneRowEach(locked.map(row => ({ ...row, username: usernameForLog(auth, row.username) })))
      .map(row => ({ ...row, until: row.until.toISOString() }));
  return {
    limits: { maxWrongPasswords: MAX_FAILURES, maxWrongPasswordsForUser: MAX_USER_FAILURES, lockMinutes: LOCK_MINUTES },
    locked: shown(limiter.lockedAddresses()),
    lockedUsers: shown(limiter.lockedUsers()),
    tries: loginLog.recent().map(loginTry => ({
      ...loginTry,
      username: unknownInRow(auth, loginTry) ? maskedOnce(loginTry.username) : loginTry.username,
      at: loginTry.at.toISOString(),
    })),
  };
}

/**
 * True when the username of the row is not a user. An older version saved such a username in full, in a row with the
 * result no-such-user or locked. Now the row has it masked, and maskedOnce keeps that as it is.
 */
const unknownInRow = (auth: LoginSettingsParts['auth'], loginTry: { username: string; result: string }): boolean =>
  loginTry.result === 'no-such-user' || (loginTry.result === 'locked' && !auth.hasUser(loginTry.username));

/** Read the last password tries, and unlock a computer or a user after too many wrong passwords. Only an admin can do this. */
export function loginSettingsRoutes(parts: LoginSettingsParts) {
  const canManageChatter = requirePermission('manage-chatter');
  return new Hono<LoggedInEnv>()
    .get('/settings/logins', canManageChatter, c => c.json(loginsReport(parts)))

    .post('/settings/logins/unlock', canManageChatter, checkedJson(unlockSchema), c => {
      const { address, username } = c.req.valid('json');
      if (address !== undefined) parts.limiter.unlock(address);
      if (username !== undefined) unlockUser(parts, username);
      // An unlock lets someone guess again, so the log keeps who did it
      log.info('Login lock removed', {
        by: c.var.user.username, from: originOf(c, parts.proxySettings).address, address, username,
      });
      return c.json(loginsReport(parts));
    });
}

/**
 * Unlock the user with this username. The list shows an unknown username masked, so the Unlock button gives the masked text.
 * Then unlock each locked user whose masked name is this text. A masked name can fit more than one unknown username.
 */
function unlockUser({ auth, limiter }: LoginSettingsParts, username: string): void {
  limiter.unlockUser(username);
  for (const locked of limiter.lockedUsers()) {
    if (usernameForLog(auth, locked.username) === username) limiter.unlockUser(locked.username);
  }
}
