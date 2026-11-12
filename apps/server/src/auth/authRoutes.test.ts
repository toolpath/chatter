import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { HardwarePoller } from '../polling/poller.js';
import { noHistory } from '../recording/testSupport.js';
import { SESSION_COOKIE } from './authRoutes.js';
import { LoginLog } from './loginLog.js';
import { ProxySettings } from './proxySettings.js';
import { authParts } from './testSupport.js';
import { captureLog } from '../logging/testSupport.js';

/** A database that has no machines */
const emptyDb = {
  prepare: () => ({ run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }),
} as unknown as Database.Database;

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

  it('refuses a second setup', async () => {
    await setUp();
    const res = await post('/api/auth/setup', { username: 'attacker', password: 'attacker-password' });
    expect(res.status).toBe(409);
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
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const { auth, accounts } = authParts();
    app = createApp({
      poller: new HardwarePoller(emptyDb),
      auth,
      accounts,
      history: noHistory(),
      proxySettings: ProxySettings.inMemory(PROXY),
    });
  });

  /** A request that the proxy sends on for a user */
  function postFor(user: string, path: string, body: object, protocol = 'http') {
    return app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': user, 'X-Forwarded-Proto': protocol },
      body: JSON.stringify(body),
    }, fromProxy);
  }

  it('blocks only the user with 10 wrong passwords, not every user of the proxy', async () => {
    await postFor('192.168.1.20', '/api/auth/setup', ADMIN);
    for (let i = 0; i < 10; i++) await postFor('192.168.1.66', '/api/auth/login', { ...ADMIN, password: 'wrong-password' });

    expect((await postFor('192.168.1.66', '/api/auth/login', ADMIN)).status).toBe(429);
    expect((await postFor('192.168.1.20', '/api/auth/login', ADMIN)).status).toBe(200);
  });

  it('makes the cookie HTTPS-only when the browser used HTTPS', async () => {
    const overHttps = await postFor('192.168.1.20', '/api/auth/setup', ADMIN, 'https');
    const overHttp = await postFor('192.168.1.20', '/api/auth/login', ADMIN, 'http');

    expect(overHttps.headers.get('Set-Cookie')).toContain('Secure');
    expect(overHttp.headers.get('Set-Cookie')).not.toContain('Secure');
  });
});
