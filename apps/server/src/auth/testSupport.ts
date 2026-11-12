import Database from 'better-sqlite3';
import { Auth } from './Auth.js';
import { SESSION_COOKIE } from './authRoutes.js';
import { SessionStore } from './sessionStore.js';
import { UserAccounts } from './userAccounts.js';
import { UserStore } from './userStore.js';

/** For tests: the login parts on one database, as index.ts makes them */
export function authParts(db: Database.Database = new Database(':memory:'), now?: () => number) {
  const users = new UserStore(db, now);
  const sessions = new SessionStore(db, now);
  return { users, sessions, auth: new Auth(users, sessions), accounts: new UserAccounts(users, sessions) };
}

/** For tests: an admin, and the cookie of a browser where the admin is logged in */
export const TEST_LOGIN = { username: 'admin', password: 'test-password' };

export async function loggedInAuth() {
  const parts = authParts();
  const token = await parts.auth.setUp(TEST_LOGIN, { userAgent: 'test browser', address: '127.0.0.1' });
  return { ...parts, cookie: `${SESSION_COOKIE}=${token}` };
}
