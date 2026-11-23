import Database from 'better-sqlite3';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@local-chatter/shared';
import type { Auth } from '../auth/Auth.js';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { HardwarePoller } from '../polling/poller.js';
import { closeDatabase, getDb, initDatabase, recordUpload } from '../storage/database.js';
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
  // The route hides who sent or deleted a program, and the address, from a Viewer (D4, uploadHistory.test.ts)
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

/**
 * Who sent a program and from which address (F-07 of the security review). A Viewer does not see who sent it, and only
 * an Admin sees the address (D4). This walk reads each GET route as a Viewer and as an Operator, so a new route that
 * gives an upload row without the role filter of uploadHistory.ts fails here.
 */
describe('the GET routes do not show who sent a program to a Viewer, or the address to an Operator', () => {
  const SENDER = 'leak-sender';
  const ADDRESS = '10.99.99.99';
  let poller: HardwarePoller | undefined;

  afterEach(async () => {
    poller?.stop();
    await closeDatabase();
  });

  it('gives the user to an Operator only, and the address to nobody of these roles', async () => {
    // A test before this one can have opened the database of the data folder, so close it before the change of the path
    await closeDatabase();
    process.env.DATABASE_PATH = ':memory:';
    await initDatabase();
    const { auth, accounts } = await loggedInAuth();
    const cookies = {} as Record<Exclude<Role, 'admin'>, string>;
    for (const role of ['viewer', 'operator'] as const) {
      const login = { username: `${role}-walker`, password: 'test-password' };
      await accounts.add({ ...login, role });
      cookies[role] = `${SESSION_COOKIE}=${await auth.logIn(login, { userAgent: 'test browser', address: '127.0.0.1' })}`;
    }
    const db = new Database(':memory:');
    applySchema(db);
    poller = new HardwarePoller(db);
    const machineId = (await poller.addMachine({ type: 'brother', name: 'Speedio', host: '127.0.0.1', dataPort: CLOSED_PORT })).id;
    await recordUpload(machineId, 'part.nc', 'O1000.NC', '/PRG/O1000.NC', 'O1000\nM30\n', { username: SENDER, address: ADDRESS });
    const { fileId, eventId } = getDb().prepare('SELECT file_id AS fileId, id AS eventId FROM upload_events').get() as { fileId: number; eventId: number };
    const app = testApp({ auth, accounts, poller });

    const getPaths = new Set(app.routes.filter(route => route.method === 'GET' && route.path.startsWith('/api/')).map(route => route.path));
    const bodies = { viewer: new Map<string, string>(), operator: new Map<string, string>() };
    for (const role of ['viewer', 'operator'] as const) {
      for (const routePath of getPaths) {
        const url = routePath.replace(':id', machineId).replace(':fileId', String(fileId)).replace(':eventId', String(eventId)).replace(/:\w+/g, '1');
        const res = await app.request(url, { headers: { Cookie: cookies[role] } });
        // A live stream does not end by itself, and it sends machine status only
        if (res.headers.get('Content-Type')?.startsWith('text/event-stream')) await res.body?.cancel();
        else bodies[role].set(routePath, await res.text());
      }
    }

    const withText = (role: keyof typeof bodies, text: string) => [...bodies[role]].filter(([, body]) => body.includes(text)).map(([path]) => path);
    expect(withText('viewer', SENDER)).toEqual([]);
    expect(withText('viewer', ADDRESS)).toEqual([]);
    expect(withText('operator', ADDRESS)).toEqual([]);
    // The walk reached the upload: an Operator sees who sent it
    expect(withText('operator', SENDER).sort()).toEqual(['/api/machine/:id/uploads/:fileId/events', '/api/machine/:id/uploads/events/:eventId']);
  });
});
