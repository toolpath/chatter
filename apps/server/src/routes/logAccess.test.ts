import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@local-chatter/shared';
import type { Auth } from '../auth/Auth.js';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { HardwarePoller } from '../polling/poller.js';
import { applySchema } from '../storage/schema.js';
import { testApp } from './testSupport.js';

/** A port where nothing listens, so each poll fails at once */
const CLOSED_PORT = 1;

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

/**
 * Each GET route that a Viewer can read, with the reason. Decision D4: a Viewer sees no settings and no logs.
 * Each other GET route must refuse a Viewer with 403. A new route that a Viewer can read must come into this list,
 * so that a person decides it.
 */
const VIEWER_CAN_READ: Record<string, string> = {
  '/api/health': 'the health check of Docker, open with no login',
  '/api/auth/status': 'tells if the browser is logged in, and as which user',
  '/api/auth/sessions': 'the browsers of the own account (Your account)',
  '/api/status': 'machine status',
  '/api/machines': 'machine status',
  '/api/events': 'live machine status',
  '/api/alerts': 'the alerts that are active now, as the machine cards show them',
  '/api/machine/:id': 'machine status',
  '/api/machine/:id/health': 'machine status: the connection state, not a log (owner, 2026-11-23)',
  '/api/machine/:id/periods': 'machine history',
  '/api/machine/:id/report': 'machine history',
  '/api/machine/:id/state-timeline': 'machine history',
  '/api/machine/:id/history/:value': 'machine history',
  '/api/machine/:id/files': 'the program list of the machine page',
  // Open owner question: alert rules are settings of a machine (D4)
  '/api/machine/:id/alert-rules': 'the alert rules of the machine page',
  // Open owner question: the upload history tells who sent a program (D4, uploaded_by in PR 13)
  '/api/machine/:id/uploads': 'the upload history of the machine page',
  '/api/machine/:id/uploads/:fileId/events': 'the upload history of the machine page',
};

describe('the GET routes that a Viewer can read (D4)', () => {
  let poller: HardwarePoller | undefined;
  afterEach(() => poller?.stop());

  it('refuse a Viewer with 403, except the routes in the list', async () => {
    const { auth, accounts } = await loggedInAuth();
    const login = { username: 'vic', password: 'test-password' };
    await accounts.add({ ...login, role: 'viewer' });
    const cookie = `${SESSION_COOKIE}=${await auth.logIn(login, { userAgent: 'test browser', address: '127.0.0.1' })}`;
    const db = new Database(':memory:');
    applySchema(db);
    poller = new HardwarePoller(db);
    // A real machine, so a route that looks for the machine before the role does not give 404 in place of 403
    const machineId = (await poller.addMachine({ type: 'brother', name: 'Speedio', host: '127.0.0.1', dataPort: CLOSED_PORT })).id;
    const app = testApp({ auth, accounts, poller });

    const getPaths = new Set(app.routes.filter(route => route.method === 'GET' && route.path.startsWith('/api/')).map(route => route.path));
    const notRefused: string[] = [];
    for (const routePath of getPaths) {
      const url = routePath.replace(':id', machineId).replace(/:\w+/g, '1');
      const res = await app.request(url, { headers: { Cookie: cookie } });
      // A live stream does not end by itself
      await res.body?.cancel();
      if (res.status !== 403) notRefused.push(routePath);
    }

    expect(notRefused.sort()).toEqual(Object.keys(VIEWER_CAN_READ).sort());
    // The walk found the settings and the logs too
    expect(getPaths.size - notRefused.length).toBeGreaterThan(15);
  });
});
