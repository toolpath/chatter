import { beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@local-chatter/shared';
import type { Auth } from '../auth/Auth.js';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { testApp } from './testSupport.js';

/**
 * Each route that gives a log: the server log, the login log, the support bundle (with the server log and the audit log),
 * and the log of the update helper. Only an Admin can read a log (decision D4 of the security review).
 */
const LOG_ROUTES = [
  { method: 'GET', path: '/api/logs' },
  { method: 'GET', path: '/api/logs/stream' },
  { method: 'GET', path: '/api/logs/debug' },
  { method: 'PUT', path: '/api/logs/debug', body: { on: true } },
  { method: 'GET', path: '/api/settings/logins' },
  { method: 'GET', path: '/api/support-bundle' },
  { method: 'GET', path: '/api/updates/helper-log' },
];

describe('the routes that give a log', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  const cookies = {} as Record<Exclude<Role, 'admin'>, string>;

  beforeAll(async () => {
    ({ auth, accounts } = await loggedInAuth());
    for (const role of ['viewer', 'operator'] as const) {
      const login = { username: role, password: 'test-password' };
      await accounts.add({ ...login, role });
      cookies[role] = `${SESSION_COOKIE}=${await auth.logIn(login, { userAgent: 'test browser', address: '127.0.0.1' })}`;
    }
  });

  for (const role of ['viewer', 'operator'] as const) {
    it(`refuse a ${role === 'viewer' ? 'Viewer' : 'an Operator'} with 403`, async () => {
      const app = testApp({ auth, accounts });
      for (const { method, path, body } of LOG_ROUTES) {
        const res = await app.request(path, {
          method,
          headers: { Cookie: cookies[role], 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    });
  }
});
