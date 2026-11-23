import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { HardwarePoller } from '../polling/poller.js';
import { noHistory } from '../recording/testSupport.js';
import { Hono } from 'hono';
import type { Auth } from './Auth.js';
import { isStillLoggedIn, SESSION_COOKIE } from './authRoutes.js';
import { MAX_LOGGED_UNKNOWN_USERS } from './LoginLimiter.js';
import { LoginLog } from './loginLog.js';
import { ProxySettings } from './proxySettings.js';
import { SEEN_INTERVAL_MS, SESSION_IDLE_MS, SESSION_LIFETIME_SECONDS } from './sessionStore.js';
import { authParts } from './testSupport.js';
import { resetAdmins } from './adminReset.js';
import { hashPassword } from './passwords.js';
import { captureAudit, captureLog, type CapturedAudit, type CapturedLog } from '../logging/testSupport.js';

/** A database that has no machines */
const emptyDb = {
  prepare: () => ({ run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }),
} as unknown as Database.Database;

const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN = { username: 'admin', password: 'first-password' };
/** The HTTP Basic header that a program sends */
const basic = (username: string, password: string) =>
  ({ headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } });

describe('auth routes', () => {
  let app: ReturnType<typeof createApp>;
  let loginLog: LoginLog;

  beforeEach(() => {
    const { auth, accounts } = authParts();
    loginLog = LoginLog.inMemory();
    app = createApp({ poller: new HardwarePoller(emptyDb), auth, accounts, history: noHistory(), loginLog });
  });

  /** The results in the login log, the oldest first */
  const loggedResults = () => loginLog.recent().map(({ username, result }) => `${username}: ${result}`).reverse();

  function post(path: string, body: object, headers: Record<string, string> = {}) {
    return app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  /** The "name=value" part of the session cookie that the reply sets */
  function sessionCookie(res: Response): string {
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    return cookie.split(';')[0];
  }

  async function sendWrongPasswords(times: number): Promise<void> {
    for (let i = 0; i < times; i++) await post('/api/auth/login', { ...ADMIN, password: 'wrong-password' });
  }

  async function setUp(): Promise<string> {
    const res = await post('/api/auth/setup', ADMIN);
    expect(res.status).toBe(200);
    return sessionCookie(res);
  }

  it('keeps the health check open', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it('says that setup is needed at first', async () => {
    const res = await app.request('/api/auth/status');
    expect(await res.json()).toEqual({ setupNeeded: true, loggedIn: false, user: null });
  });

  it('refuses the machine list without a login', async () => {
    const res = await app.request('/api/machines');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Log in first' });
  });

  it('logs in the first visitor with a safe cookie', async () => {
    const res = await post('/api/auth/setup', ADMIN);
    const cookie = res.headers.get('Set-Cookie')!;

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    const status = await app.request('/api/auth/status', { headers: { Cookie: sessionCookie(res) } });
    expect(await status.json()).toEqual({ setupNeeded: false, loggedIn: true, user: { username: 'admin', role: 'admin' } });
  });

  it('refuses a second setup, and does not write that it made an Admin', async () => {
    await setUp();
    const log = captureLog();
    try {
      const res = await post('/api/auth/setup', { username: 'attacker', password: 'attacker-password' });

      expect(res.status).toBe(409);
      expect(log.text()).not.toContain('made a new Admin');
      expect(log.text()).not.toContain('username=attacker');
    } finally {
      log.restore();
    }
  });

  it('gives the same 409 reply when the setup is closed and when the username is taken, so it does not tell which usernames exist', async () => {
    // A user who is not an Admin, and no Admin: the database of an older version after its reset-password
    const { users, auth, accounts } = authParts();
    users.add({ username: 'sam', passwordHash: 'x', role: 'operator' });
    const fresh = createApp({ poller: new HardwarePoller(emptyDb), auth, accounts, history: noHistory() });
    const setUpOn = (body: object) => fresh.request('/api/auth/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    const taken = await setUpOn({ username: 'SAM', password: 'long-enough' });
    expect((await setUpOn(ADMIN)).status).toBe(200);
    const closed = await setUpOn({ username: 'someone', password: 'long-enough' });

    expect(taken.status).toBe(409);
    expect(closed.status).toBe(409);
    const takenBody = await taken.json();
    expect(takenBody).toEqual(await closed.json());
    expect(JSON.stringify(takenBody)).not.toMatch(/username|exists/i);
  });

  it('keeps the setup closed after reset-password', async () => {
    const { users, sessions, auth, accounts } = authParts();
    const fresh = createApp({ poller: new HardwarePoller(emptyDb), auth, accounts, history: noHistory() });
    await auth.setUp(ADMIN, { userAgent: 'test browser', address: '192.168.1.20' });

    const boss = { username: 'boss', passwordHash: await hashPassword('new-admin-password') };
    resetAdmins({ users, sessions, loginLog: LoginLog.inMemory() }, boss);

    expect(await (await fresh.request('/api/auth/status')).json()).toMatchObject({ setupNeeded: false });
    const res = await fresh.request('/api/auth/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'intruder', password: 'intruder-password' }),
    });
    expect(res.status).toBe(409);
    expect(users.findByName('intruder')).toBeNull();
  });

  it('refuses a short password', async () => {
    const res = await post('/api/auth/setup', { username: 'admin', password: 'short' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'The password must have at least 8 characters' });
  });

  it('refuses a setup without a username', async () => {
    const res = await post('/api/auth/setup', { username: '  ', password: 'long-enough' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Username is required' });
  });

  it('logs in with the right username and password only', async () => {
    await setUp();
    const wrong = await post('/api/auth/login', { ...ADMIN, password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'Wrong username or password' });
    expect((await post('/api/auth/login', { ...ADMIN, username: 'someone' })).status).toBe(401);

    const res = await post('/api/auth/login', ADMIN);
    const machines = await app.request('/api/machines', { headers: { Cookie: sessionCookie(res) } });
    expect(machines.status).toBe(200);
  });

  it('accepts the username and password from a program (HTTP Basic)', async () => {
    await setUp();
    const right = await app.request('/api/machines', basic(ADMIN.username, ADMIN.password));
    const wrong = await app.request('/api/machines', basic(ADMIN.username, 'wrong-password'));
    expect(right.status).toBe(200);
    expect(wrong.status).toBe(401);
  });

  it('blocks the caller after 10 wrong passwords', async () => {
    await setUp();
    await sendWrongPasswords(10);

    const res = await post('/api/auth/login', ADMIN);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: 'Too many wrong passwords. Try again in up to 15 minutes, or ask an Admin to unlock you in Settings > Logins.',
    });
  });

  it('does not lock a user after 30 good logins', async () => {
    await setUp();
    for (let i = 0; i < 30; i++) expect((await post('/api/auth/login', ADMIN)).status).toBe(200);

    expect((await post('/api/auth/login', ADMIN)).status).toBe(200);
  });

  it('counts the wrong passwords of a program (HTTP Basic) and of the login form together', async () => {
    await setUp();
    for (let i = 0; i < 5; i++) await app.request('/api/machines', basic(ADMIN.username, 'wrong-password'));
    await sendWrongPasswords(4);
    expect((await post('/api/auth/login', { ...ADMIN, password: 'wrong-password' })).status).toBe(401);

    expect((await post('/api/auth/login', ADMIN)).status).toBe(429);
    expect((await app.request('/api/machines', basic(ADMIN.username, 'wrong-password'))).status).toBe(429);
  });

  it('reads the Basic header in any case, with a colon in the password', async () => {
    const login = { username: 'admin', password: 'pass:word:1' };
    await post('/api/auth/setup', login);
    const encoded = Buffer.from(`${login.username}:${login.password}`).toString('base64');

    const res = await app.request('/api/machines', { headers: { Authorization: `basic ${encoded}` } });
    expect(res.status).toBe(200);
  });

  it('refuses the old Bearer form', async () => {
    await setUp();
    const res = await app.request('/api/machines', { headers: { Authorization: `Bearer ${ADMIN.password}` } });
    expect(res.status).toBe(401);
  });

  it('refuses a username with a colon, because programs could not send it', async () => {
    const res = await post('/api/auth/setup', { username: 'ops:west', password: 'long-enough' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'The username cannot have a colon (:) in it' });
  });

  it('lets a program with the right login work while its shared address is blocked', async () => {
    await setUp();
    const programLogin = basic(ADMIN.username, ADMIN.password);
    expect((await app.request('/api/machines', programLogin)).status).toBe(200);
    // Someone at the same address (for example behind the Docker network) types wrong passwords
    await sendWrongPasswords(10);

    expect((await app.request('/api/machines', programLogin)).status).toBe(200);
  });

  it('logs out the old cookie when the password changes', async () => {
    const oldCookie = await setUp();
    const res = await post('/api/auth/password',
      { currentPassword: ADMIN.password, newPassword: 'second-password' }, { Cookie: oldCookie });

    expect(res.status).toBe(200);
    const newCookie = sessionCookie(res);
    expect((await app.request('/api/machines', { headers: { Cookie: oldCookie } })).status).toBe(401);
    expect((await app.request('/api/machines', { headers: { Cookie: newCookie } })).status).toBe(200);
  });

  it('needs a login to change the password', async () => {
    await setUp();
    const res = await post('/api/auth/password', { currentPassword: ADMIN.password, newPassword: 'second-password' });
    expect(res.status).toBe(401);
  });

  it('asks for a login before it reads the body of a password change', async () => {
    await setUp();
    const res = await app.request('/api/auth/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'this is not JSON',
    });

    expect(res.status).toBe(401);
  });

  describe('body size', () => {
    /** Larger than the 64 KB limit of a JSON body */
    const largePassword = 'x'.repeat(1024 * 1024);

    it('refuses a login body larger than 64 KB, and does not check the password', async () => {
      await setUp();
      const res = await post('/api/auth/login', { username: ADMIN.username, password: largePassword });

      expect(res.status).toBe(413);
      expect(loggedResults()).toEqual([]);
    });

    it('refuses a valid login with a body larger than 64 KB: no login, no log line and no cookie', async () => {
      await setUp();
      const res = await post('/api/auth/login', { ...ADMIN, pad: 'x'.repeat(64 * 1024) });

      expect(res.status).toBe(413);
      expect(res.headers.get('Set-Cookie')).toBeNull();
      expect(loggedResults()).toEqual([]);
    });

    it('logs in with a valid body of about 60 KB', async () => {
      await setUp();
      const res = await post('/api/auth/login', { ...ADMIN, pad: 'x'.repeat(60 * 1024) });

      expect(res.status).toBe(200);
      expect(loggedResults()).toEqual(['admin: logged-in']);
    });

    it('refuses a login with a large Content-Length before the body comes', async () => {
      await setUp();
      const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
      try {
        await once(server, 'listening');
        const socket = connect((server.address() as AddressInfo).port, '127.0.0.1');
        await once(socket, 'connect');
        socket.write('POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n'
          + `Content-Length: ${10 * 1024 * 1024}\r\n\r\n{"username":"admin"`);
        const [firstBytes] = await once(socket, 'data') as [Buffer];
        socket.destroy();

        expect(firstBytes.toString()).toMatch(/^HTTP\/1\.1 413 /);
        expect(loggedResults()).toEqual([]);
      } finally {
        server.closeAllConnections();
        server.close();
      }
    });

    it('stops a valid login with no length when its body grows larger than 64 KB', async () => {
      await setUp();
      const encoder = new TextEncoder();
      const chunks = [`{"username":"${ADMIN.username}","password":"${ADMIN.password}","pad":"`,
        ...Array.from({ length: 16 }, () => 'x'.repeat(8 * 1024)), '"}'];
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk === undefined) controller.close();
          else controller.enqueue(encoder.encode(chunk));
        },
      });
      const res = await app.request('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half',
      } as RequestInit);

      expect(res.status).toBe(413);
      expect(res.headers.get('Set-Cookie')).toBeNull();
      expect(loggedResults()).toEqual([]);
    });

    it('stops a body with no length when it grows larger than 64 KB', async () => {
      const bytes = new TextEncoder().encode(JSON.stringify({ username: ADMIN.username, password: largePassword }));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      const res = await app.request('/api/auth/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half',
      } as RequestInit);

      expect(res.status).toBe(413);
      expect(await (await app.request('/api/auth/status')).json()).toMatchObject({ setupNeeded: true });
    });
  });

  it('writes each password try in the login log', async () => {
    const cookie = await setUp();
    await post('/api/auth/login', { username: 'sam', password: 'wrong-password' });
    await post('/api/auth/login', { ...ADMIN, password: 'wrong-password' });
    await post('/api/auth/login', ADMIN);
    await post('/api/auth/password', { currentPassword: ADMIN.password, newPassword: 'second-password' }, { Cookie: cookie });

    expect(loggedResults()).toEqual([
      'sam: no-such-user',
      'admin: wrong-password',
      'admin: logged-in',
      'admin: password-changed',
    ]);
  });

  it('logs a program login one time, not with each request', async () => {
    await setUp();
    await app.request('/api/machines', basic(ADMIN.username, ADMIN.password));
    await app.request('/api/machines', basic(ADMIN.username, ADMIN.password));
    await app.request('/api/machines', basic(ADMIN.username, 'wrong-password'));

    expect(loggedResults()).toEqual(['admin: logged-in', 'admin: wrong-password']);
  });

  it('logs only the first try of a locked computer, so it cannot fill the log', async () => {
    await setUp();
    await sendWrongPasswords(10);
    for (let i = 0; i < 5; i++) await post('/api/auth/login', ADMIN);

    expect(loggedResults().filter(entry => entry.endsWith('locked'))).toEqual(['admin: locked']);
  });

  it('logs in when the login log cannot save', async () => {
    await setUp();
    vi.spyOn(loginLog, 'record').mockImplementation(() => {
      throw new Error('disk full');
    });
    const log = captureLog();

    expect((await post('/api/auth/login', ADMIN)).status).toBe(200);
    log.restore();
    expect(log.text('error')).toContain('disk full');
    // The server log still has the try
    expect(log.text('info')).toMatch(/username=admin.*result=logged-in/);
    vi.restoreAllMocks();
  });

  it('removes the cookie on logout', async () => {
    const res = await post('/api/auth/logout', {});
    expect(res.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE}=;`);
  });

  it('stops the session on logout, also when someone kept a copy of the cookie', async () => {
    const cookie = await setUp();
    await post('/api/auth/logout', {}, { Cookie: cookie });

    expect((await app.request('/api/machines', { headers: { Cookie: cookie } })).status).toBe(401);
  });
});

describe('auth routes behind a reverse proxy', () => {
  const PROXY = '127.0.0.1';
  /** What the Node server gives each request: here, a connection from the proxy */
  const fromProxy = { incoming: { socket: { remoteAddress: PROXY } } };
  const BOB = { username: 'bob', password: 'bob-password' };
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const { auth, accounts } = authParts();
    app = createApp({
      poller: new HardwarePoller(emptyDb),
      auth,
      accounts,
      history: noHistory(),
      proxySettings: ProxySettings.inMemory(PROXY),
    });
    await postFor('192.168.1.20', '/api/auth/setup', ADMIN);
    await accounts.add({ ...BOB, role: 'operator' });
  });

  /** A request that the proxy sends on for a user */
  function postFor(user: string, path: string, body: object, protocol = 'http', cookie?: string) {
    return app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': user, 'X-Forwarded-Proto': protocol, ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    }, fromProxy);
  }

  const wrongAdminPassword = (user: string) =>
    postFor(user, '/api/auth/login', { ...ADMIN, password: 'wrong-password' });

  it('blocks only the user with 10 wrong passwords, not every user of the proxy', async () => {
    for (let i = 0; i < 10; i++) await postFor('192.168.1.66', '/api/auth/login', { ...ADMIN, password: 'wrong-password' });

    expect((await postFor('192.168.1.66', '/api/auth/login', ADMIN)).status).toBe(429);
    expect((await postFor('192.168.1.20', '/api/auth/login', ADMIN)).status).toBe(200);
  });

  it('does not reset the tries against admin when another user logs in from the same address', async () => {
    for (let i = 0; i < 9; i++) await wrongAdminPassword('192.168.1.66');
    expect((await postFor('192.168.1.66', '/api/auth/login', BOB)).status).toBe(200);
    await wrongAdminPassword('192.168.1.66');

    expect((await postFor('192.168.1.66', '/api/auth/login', ADMIN)).status).toBe(429);
    expect((await postFor('192.168.1.66', '/api/auth/login', BOB)).status).toBe(200);
  });

  it('counts the tries from two IPv6 addresses in one /64 together', async () => {
    for (let i = 0; i < 5; i++) await wrongAdminPassword('2001:db8:1:2::66');
    for (let i = 0; i < 5; i++) await wrongAdminPassword('2001:db8:1:2::67');

    expect((await postFor('2001:db8:1:2::68', '/api/auth/login', ADMIN)).status).toBe(429);
    expect((await postFor('2001:db8:1:3::68', '/api/auth/login', ADMIN)).status).toBe(200);
  });

  it('blocks a username on all addresses after 30 wrong passwords from many addresses', async () => {
    for (let i = 0; i < 30; i++) await wrongAdminPassword(`192.168.2.${Math.floor(i / 5)}`);

    expect((await postFor('192.168.1.20', '/api/auth/login', ADMIN)).status).toBe(429);
    expect((await postFor('192.168.1.20', '/api/auth/login', BOB)).status).toBe(200);
  });

  it('lets only 10 of many tries sent at the same time from one address check the password', async () => {
    const replies = await Promise.all(Array.from({ length: 40 }, () => wrongAdminPassword('192.168.1.66')));
    const statuses = replies.map(reply => reply.status);

    expect(statuses.filter(status => status === 401)).toHaveLength(10);
    expect(statuses.filter(status => status === 429)).toHaveLength(30);
  });

  it('lets only 30 of many tries sent at the same time from many addresses check the password', async () => {
    const replies = await Promise.all(Array.from({ length: 60 }, (_, i) => wrongAdminPassword(`192.168.2.${i % 12}`)));
    const statuses = replies.map(reply => reply.status);

    expect(statuses.filter(status => status === 401)).toHaveLength(30);
    expect(statuses.filter(status => status === 429)).toHaveLength(30);
    expect((await postFor('192.168.1.20', '/api/auth/login', ADMIN)).status).toBe(429);
  });

  describe('server log of login tries', () => {
    let log: CapturedLog | undefined;
    afterEach(() => {
      log?.restore();
      log = undefined;
    });

    /** The log lines of one level that have this text */
    const linesWith = (level: 'info' | 'warn', text: string) =>
      log!.lines.filter(line => line.level === level && line.text.includes(text)).map(line => line.text);

    it('writes an info line for a good login, with the username and the address from the proxy', async () => {
      log = captureLog();
      const res = await postFor('192.168.1.30', '/api/auth/login', BOB);
      const token = (res.headers.get('Set-Cookie') ?? '').split(';')[0].split('=')[1];

      const lines = linesWith('info', 'result=logged-in');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('username=bob');
      expect(lines[0]).toContain('address=192.168.1.30');
      expect(log.text()).not.toContain(BOB.password);
      expect(token).toBeTruthy();
      expect(log.text()).not.toContain(token);
    });

    it('writes a warn line for a wrong password and for an unknown username, but not the password', async () => {
      log = captureLog();
      await postFor('192.168.1.66', '/api/auth/login', { ...ADMIN, password: 'secret-wrong-1' });
      await postFor('192.168.1.66', '/api/auth/login', { username: 'sam', password: 'secret-wrong-2' });

      expect(linesWith('warn', 'result=wrong-password')).toEqual([
        expect.stringMatching(/username=admin.*address=192\.168\.1\.66/),
      ]);
      expect(linesWith('warn', 'result=no-such-user')).toEqual([
        expect.stringMatching(/username=sam.*address=192\.168\.1\.66/),
      ]);
      expect(log.text()).not.toContain('secret-wrong');
    });

    it('writes only the first tries with unknown usernames from one address, then one line that it stops', async () => {
      log = captureLog();
      for (let i = 0; i < MAX_LOGGED_UNKNOWN_USERS + 5; i++) {
        await postFor('192.168.1.66', '/api/auth/login', { username: `random-${i}`, password: 'wrong-password' });
      }
      await postFor('192.168.1.67', '/api/auth/login', { username: 'other-computer', password: 'wrong-password' });
      await wrongAdminPassword('192.168.1.66');

      expect(linesWith('warn', 'address=192.168.1.66 result=no-such-user')).toHaveLength(MAX_LOGGED_UNKNOWN_USERS);
      expect(log.text()).not.toContain(`username=random-${MAX_LOGGED_UNKNOWN_USERS}`);
      expect(linesWith('warn', 'not logged')).toEqual([expect.stringMatching(/address=192\.168\.1\.66/)]);
      // Other computers and known usernames still get a line
      expect(linesWith('warn', 'username=other-computer')).toHaveLength(1);
      expect(linesWith('warn', 'result=wrong-password')).toEqual([expect.stringMatching(/username=admin.*address=192\.168\.1\.66/)]);
    });

    it('writes one warn line for the first try of a locked computer, not for each try', async () => {
      for (let i = 0; i < 10; i++) await wrongAdminPassword('192.168.1.66');
      log = captureLog();
      for (let i = 0; i < 5; i++) await postFor('192.168.1.66', '/api/auth/login', ADMIN);

      expect(linesWith('warn', 'result=locked')).toEqual([
        expect.stringMatching(/username=admin.*address=192\.168\.1\.66/),
      ]);
      expect(log.text()).not.toContain(ADMIN.password);
    });

    it('writes an info line when a user changes the password', async () => {
      const login = await postFor('192.168.1.30', '/api/auth/login', BOB);
      const cookie = (login.headers.get('Set-Cookie') ?? '').split(';')[0];
      log = captureLog();
      const res = await app.request('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.168.1.30', Cookie: cookie },
        body: JSON.stringify({ currentPassword: BOB.password, newPassword: 'bob-new-password' }),
      }, fromProxy);

      expect(res.status).toBe(200);
      expect(linesWith('info', 'result=password-changed')).toEqual([
        expect.stringMatching(/username=bob.*address=192\.168\.1\.30/),
      ]);
      expect(log.text()).not.toContain('bob-new-password');
      expect(log.text()).not.toContain(BOB.password);
    });

    it('writes a warn line for a wrong current password in a password change, but not the passwords', async () => {
      const login = await postFor('192.168.1.30', '/api/auth/login', BOB);
      const cookie = (login.headers.get('Set-Cookie') ?? '').split(';')[0];
      log = captureLog();
      const res = await app.request('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.168.1.30', Cookie: cookie },
        body: JSON.stringify({ currentPassword: 'secret-wrong-current', newPassword: 'bob-new-password' }),
      }, fromProxy);

      expect(res.status).toBe(401);
      expect(linesWith('warn', 'result=wrong-password')).toEqual([
        expect.stringMatching(/username=bob.*address=192\.168\.1\.30/),
      ]);
      expect(log.text()).not.toContain('secret-wrong-current');
      expect(log.text()).not.toContain('bob-new-password');
    });

    it('writes the login of a program (HTTP Basic) one time, not with each request', async () => {
      log = captureLog();
      const headers = { ...basic(BOB.username, BOB.password).headers, 'X-Forwarded-For': '192.168.1.40' };
      await app.request('/api/machines', { headers }, fromProxy);
      await app.request('/api/machines', { headers }, fromProxy);

      expect(linesWith('info', 'result=logged-in')).toEqual([
        expect.stringMatching(/username=bob.*address=192\.168\.1\.40/),
      ]);
    });
  });

  describe('audit log of login tries', () => {
    let audit: CapturedAudit | undefined;
    afterEach(() => {
      audit?.restore();
      audit = undefined;
    });

    const auditLines = (text: string) => audit!.lines.filter(line => line.includes(text));

    it('writes each password try, with the username, the address and the result, but not the password', async () => {
      audit = captureAudit();
      await postFor('192.168.1.30', '/api/auth/login', BOB);
      await postFor('192.168.1.66', '/api/auth/login', { ...ADMIN, password: 'secret-wrong-1' });

      expect(auditLines('Password try')).toEqual([
        expect.stringMatching(/username=bob address=192\.168\.1\.30 result=logged-in$/),
        expect.stringMatching(/username=admin address=192\.168\.1\.66 result=wrong-password$/),
      ]);
      expect(audit.lines.join('\n')).not.toContain('secret-wrong-1');
      expect(audit.lines.join('\n')).not.toContain(BOB.password);
    });

    it('writes only the first tries with unknown usernames from one address, then one line that it only counts the next tries', async () => {
      audit = captureAudit();
      for (let i = 0; i < MAX_LOGGED_UNKNOWN_USERS + 5; i++) {
        await postFor('192.168.1.66', '/api/auth/login', { username: `random-${i}`, password: 'wrong-password' });
      }
      await postFor('192.168.1.67', '/api/auth/login', { username: 'other-computer', password: 'wrong-password' });
      await wrongAdminPassword('192.168.1.66');

      expect(auditLines('address=192.168.1.66 result=no-such-user')).toHaveLength(MAX_LOGGED_UNKNOWN_USERS);
      expect(audit.lines.join('\n')).not.toContain(`username=random-${MAX_LOGGED_UNKNOWN_USERS} `);
      expect(auditLines('not logged one by one')).toEqual([expect.stringMatching(/address=192\.168\.1\.66 minutes=15$/)]);
      // Other computers and known usernames still get a line
      expect(auditLines('username=other-computer')).toHaveLength(1);
      expect(auditLines('result=wrong-password')).toEqual([expect.stringMatching(/username=admin address=192\.168\.1\.66/)]);
    });

    it('cuts a long username to 64 characters, so a try with a long name cannot fill the log', async () => {
      audit = captureAudit();
      const log = captureLog();
      try {
        await postFor('192.168.1.66', '/api/auth/login', { username: `${'u'.repeat(64)}`, password: 'wrong-password' });
        const res = await app.request('/api/status', {
          headers: { ...basic(`${'a'.repeat(64)}${'b'.repeat(300)}`, 'x').headers, 'X-Forwarded-For': '192.168.1.66' },
        }, fromProxy);
        expect(res.status).toBe(401);
        expect(log.text()).toMatch(/ username=a{64}… address=192\.168\.1\.66/);
      } finally {
        log.restore();
      }

      expect(auditLines('Password try')).toEqual([
        expect.stringMatching(/ username=u{64} address=/),
        expect.stringMatching(/ username=a{64}… address=192\.168\.1\.66 result=no-such-user$/),
      ]);
    });

    describe('when the time of a flood of unknown usernames ends', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('writes one line with the count of the tries that had no line, so each try is counted', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // A new app, so its login limiter reads the fake time
        const { auth, accounts } = authParts();
        app = createApp({ poller: new HardwarePoller(emptyDb), auth, accounts, history: noHistory(), proxySettings: ProxySettings.inMemory(PROXY) });
        audit = captureAudit();
        for (let i = 0; i < MAX_LOGGED_UNKNOWN_USERS + 7; i++) {
          await postFor('192.168.1.66', '/api/auth/login', { username: `random-${i}`, password: 'wrong-password' });
        }
        expect(auditLines('had no line')).toEqual([]);

        vi.advanceTimersByTime(15 * 60 * 1000 + 1);
        // The next password try from any address writes the count
        await postFor('192.168.1.20', '/api/auth/login', { username: 'nobody', password: 'wrong-password' });

        expect(auditLines('had no line')).toEqual([expect.stringMatching(/address=192\.168\.1\.66 count=7$/)]);
      });
    });

    it('keeps a Basic username with a new line and control characters in one escaped line', async () => {
      audit = captureAudit();
      // Basic ends the username at the first colon, so the false line has no time
      const username = 'eve\r\nINFO  [audit] Change user=admin\u001b[2J';

      const res = await app.request('/api/status', { headers: { ...basic(username, 'x').headers, 'X-Forwarded-For': '192.168.1.66' } }, fromProxy);

      expect(res.status).toBe(401);
      expect(audit.lines).toEqual([expect.stringContaining('Password try username="eve\\r\\nINFO  [audit] Change user=admin\\u001b[2J" address=192.168.1.66 result=no-such-user')]);
      expect(audit.lines[0]).not.toMatch(/\p{Cc}/u);
    });

    it('writes the first try of a locked computer', async () => {
      for (let i = 0; i < 10; i++) await wrongAdminPassword('192.168.1.66');
      audit = captureAudit();
      await postFor('192.168.1.66', '/api/auth/login', ADMIN);

      expect(auditLines('Password try')).toEqual([expect.stringMatching(/username=admin address=192\.168\.1\.66 result=locked$/)]);
    });

    it('writes a password change of a logged-in user, but not the passwords', async () => {
      const login = await postFor('192.168.1.30', '/api/auth/login', BOB);
      const cookie = (login.headers.get('Set-Cookie') ?? '').split(';')[0];
      audit = captureAudit();

      const res = await app.request('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.168.1.30', Cookie: cookie },
        body: JSON.stringify({ currentPassword: BOB.password, newPassword: 'bob-new-password' }),
      }, fromProxy);

      expect(res.status).toBe(200);
      expect(auditLines('Password try')).toEqual([expect.stringMatching(/username=bob address=192\.168\.1\.30 result=password-changed$/)]);
      expect(audit.lines.join('\n')).not.toContain('bob-new-password');
      expect(audit.lines.join('\n')).not.toContain(BOB.password);
    });

    it('writes the first-run setup that made the Admin, and each setup that Chatter refuses after it', async () => {
      const { auth, accounts } = authParts();
      app = createApp({ poller: new HardwarePoller(emptyDb), auth, accounts, history: noHistory(), proxySettings: ProxySettings.inMemory(PROXY) });
      audit = captureAudit();

      expect((await postFor('192.168.1.20', '/api/auth/setup', ADMIN)).status).toBe(200);
      expect((await postFor('192.168.1.99', '/api/auth/setup', { username: 'attacker', password: 'attacker-password' })).status).toBe(409);

      expect(auditLines('setup')).toEqual([
        expect.stringMatching(/First-run setup made a new Admin username=admin address=192\.168\.1\.20$/),
        expect.stringMatching(/First-run setup refused address=192\.168\.1\.99$/),
      ]);
      expect(audit.lines.join('\n')).not.toContain(ADMIN.password);
      expect(audit.lines.join('\n')).not.toContain('attacker');
    });
  });

  it('writes a warn line when the first-run setup makes the Admin, with the address', async () => {
    const { auth, accounts } = authParts();
    const fresh = createApp({
      poller: new HardwarePoller(emptyDb), auth, accounts, history: noHistory(), proxySettings: ProxySettings.inMemory(PROXY),
    });
    const log = captureLog();
    try {
      const res = await fresh.request('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.168.1.50' },
        body: JSON.stringify(ADMIN),
      }, fromProxy);

      expect(res.status).toBe(200);
      const lines = log.lines.filter(line => line.level === 'warn' && line.text.includes('Admin'));
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toContain('username=admin');
      expect(lines[0].text).toContain('address=192.168.1.50');
      expect(log.text()).not.toContain(ADMIN.password);
    } finally {
      log.restore();
    }
  });

  it('makes the cookie HTTPS-only when the browser used HTTPS', async () => {
    const overHttps = await postFor('192.168.1.20', '/api/auth/login', ADMIN, 'https');
    const overHttp = await postFor('192.168.1.20', '/api/auth/login', ADMIN, 'http');

    expect(overHttps.headers.get('Set-Cookie')).toContain('Secure');
    expect(overHttp.headers.get('Set-Cookie')).not.toContain('Secure');
  });
});

describe('the Secure flag of a login cookie from plain HTTP', () => {
  const PROXY = '127.0.0.1';
  const USER = '192.168.1.20';
  /** What the Node server gives each request: here, a connection from the proxy, or from a computer that is not trusted */
  const fromProxy = { incoming: { socket: { remoteAddress: PROXY } } };
  const fromUntrusted = { incoming: { socket: { remoteAddress: '192.168.1.99' } } };
  let now: number;
  let app: ReturnType<typeof createApp>;
  let auth: Auth;
  let cookie: string;

  /** A request that the proxy sends on for the user, over HTTP or HTTPS */
  const viaProxy = (path: string, protocol: string, headers: Record<string, string> = {}, method = 'GET') =>
    app.request(path, { method, headers: { 'X-Forwarded-For': USER, 'X-Forwarded-Proto': protocol, ...headers } }, fromProxy);
  const withSession = (path: string, protocol: string, method = 'GET') =>
    viaProxy(path, protocol, { Cookie: cookie }, method);

  beforeEach(async () => {
    now = Date.parse('2026-11-09T10:00:00Z');
    const db = new Database(':memory:');
    const parts = authParts(db, () => now);
    auth = parts.auth;
    app = createApp({
      poller: new HardwarePoller(emptyDb),
      auth,
      accounts: parts.accounts,
      history: noHistory(),
      proxySettings: ProxySettings.inMemory(PROXY),
    });
    const login = await app.request('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': USER, 'X-Forwarded-Proto': 'http' },
      body: JSON.stringify(ADMIN),
    }, fromProxy);
    const setCookie = login.headers.get('Set-Cookie') ?? '';
    expect(setCookie).not.toContain('Secure');
    cookie = setCookie.split(';')[0];
    now += SEEN_INTERVAL_MS;
  });

  it('sets the cookie again with the Secure flag when the browser uses it over HTTPS', async () => {
    const res = await withSession('/api/machines', 'https');

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie.split(';')[0]).toBe(cookie);
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/;');
    // The login started SEEN_INTERVAL_MS ago, so the cookie keeps only the time left before the 1-year end
    expect(setCookie).toContain(`Max-Age=${SESSION_LIFETIME_SECONDS - SEEN_INTERVAL_MS / 1000};`);
    // A shared cache in the proxy must not give this cookie to other browsers
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('gives the cookie only the time left before the 1-year end of the login, not a new year', async () => {
    now += 10 * DAY_MS + 400;
    const res = await withSession('/api/machines', 'https');

    // The time left is rounded up to the next full second
    const secondsLeft = SESSION_LIFETIME_SECONDS - SEEN_INTERVAL_MS / 1000 - 10 * DAY_MS / 1000;
    expect(res.headers.get('Set-Cookie')).toContain(`Max-Age=${secondsLeft};`);
  });

  it('sets the cookie again when a visible page tells over HTTPS that its login is in use', async () => {
    const res = await withSession('/api/auth/sessions/in-use', 'https', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers.get('Set-Cookie')).toContain('Secure');
  });

  it('does not set the cookie over plain HTTP', async () => {
    const res = await withSession('/api/machines', 'http');

    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('sets the cookie at most once in each SEEN_INTERVAL_MS', async () => {
    expect((await withSession('/api/machines', 'https')).headers.get('Set-Cookie')).toContain('Secure');

    now += SEEN_INTERVAL_MS - 1;
    expect((await withSession('/api/machines', 'https')).headers.get('Set-Cookie')).toBeNull();
    now += 1;
    expect((await withSession('/api/machines', 'https')).headers.get('Set-Cookie')).toContain('Secure');
  });

  it('sets the cookie again at once when the address of the browser changes', async () => {
    expect((await withSession('/api/machines', 'https')).headers.get('Set-Cookie')).toContain('Secure');

    now += 1;
    const res = await viaProxy('/api/machines', 'https', { Cookie: cookie, 'X-Forwarded-For': '192.168.1.21' });
    expect(res.headers.get('Set-Cookie')).toContain('Secure');
  });

  it('sets the cookie again with the Secure flag for HTTPS with no proxy', async () => {
    const res = await app.request('https://chatterbox/api/machines', { headers: { Cookie: cookie } }, fromUntrusted);

    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Secure');
  });

  it('does not set the cookie, and does not fail the request, when the use cannot be saved', async () => {
    vi.spyOn(auth, 'markSeen').mockImplementation(() => {
      throw new Error('disk full');
    });
    const log = captureLog();
    try {
      const res = await withSession('/api/machines', 'https');

      expect(res.status).toBe(200);
      expect(res.headers.get('Set-Cookie')).toBeNull();
      expect(log.lines.some(line => line.level === 'error' && line.text.includes('[Sessions] Could not save when a browser was used'))).toBe(true);
    } finally {
      log.restore();
      vi.restoreAllMocks();
    }
  });

  it('does not trust the X-Forwarded-Proto header of a computer that is not a trusted proxy', async () => {
    const res = await app.request('/api/machines', {
      headers: { Cookie: cookie, 'X-Forwarded-For': USER, 'X-Forwarded-Proto': 'https' },
    }, fromUntrusted);

    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('does not set a cookie for a program that sends its password (HTTP Basic)', async () => {
    const res = await viaProxy('/api/machines', 'https', basic(ADMIN.username, ADMIN.password).headers);

    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('does not set the cookie again for a session that ended', async () => {
    auth.logOut(auth.sessionOf(cookie.split('=')[1])!);
    const res = await withSession('/api/machines', 'https');

    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('does not set the cookie again for a session that was not used for 14 days', async () => {
    now += SESSION_IDLE_MS + SEEN_INTERVAL_MS;
    const res = await withSession('/api/machines', 'https');

    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('isStillLoggedIn', () => {
  /** Tell if the login of a request with these headers is still valid */
  async function check(auth: Auth, headers: Record<string, string>): Promise<boolean> {
    const app = new Hono().get('/check', c => c.json(isStillLoggedIn(c, auth)));
    return (await app.request('/check', { headers })).json() as Promise<boolean>;
  }

  it('is true for a valid session, and false after the session ended', async () => {
    const { auth } = authParts();
    const token = await auth.setUp(ADMIN, { userAgent: 'test browser', address: '127.0.0.1' });
    const cookie = { Cookie: `${SESSION_COOKIE}=${token}` };
    expect(await check(auth, cookie)).toBe(true);

    auth.logOut(auth.sessionOf(token!)!);

    expect(await check(auth, cookie)).toBe(false);
  });

  it('is true for a program with a password (HTTP Basic), because it has no session', async () => {
    const { auth } = authParts();
    expect(await check(auth, basic(ADMIN.username, ADMIN.password).headers)).toBe(true);
  });

  it('is true, and logs the error, when it cannot read the sessions', async () => {
    const auth = { sessionOf: () => { throw new Error('database is locked'); } } as unknown as Auth;
    const log = captureLog();

    const result = await check(auth, { Cookie: `${SESSION_COOKIE}=some-token` });
    log.restore();

    expect(result).toBe(true);
    expect(log.text('error')).toContain('database is locked');
  });
});
