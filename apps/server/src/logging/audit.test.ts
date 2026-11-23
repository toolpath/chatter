import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Auth } from '../auth/Auth.js';
import { SESSION_COOKIE, type LoggedInEnv } from '../auth/authRoutes.js';
import { ProxySettings } from '../auth/proxySettings.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { testApp } from '../routes/testSupport.js';
import { auditLog, configureAudit, writeAudit } from './audit.js';
import { configureLogging } from './logger.js';
import { ServerLog } from './ServerLog.js';
import { captureAudit, captureLog, type CapturedAudit, type CapturedLog } from './testSupport.js';

describe('writeAudit', () => {
  let audit: CapturedAudit;
  beforeEach(() => {
    audit = captureAudit();
  });
  afterEach(() => audit.restore());

  it('writes one text line with the time, the [audit] part and the details', () => {
    writeAudit('Password try', { username: 'ann', address: '192.168.1.20', result: 'logged-in' });

    expect(audit.lines).toEqual([
      expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z INFO {2}\[audit\] Password try username=ann address=192\.168\.1\.20 result=logged-in$/),
    ]);
  });

  it('hides a secret in the details, as the server log does', () => {
    writeAudit('Password try', { username: 'ann', password: 'secret-pw-1', note: 'https://user:secret-pw-2@example.test/' });

    expect(audit.lines.join('\n')).not.toMatch(/secret-pw/);
  });

  it('writes nothing to the server log', () => {
    const log = captureLog();
    try {
      writeAudit('Password try', { username: 'ann' });
      expect(log.lines).toEqual([]);
    } finally {
      log.restore();
    }
  });

  it('keeps the lines also when the server log level is error', () => {
    const old = configureLogging({ level: 'error', sink: () => {} });
    try {
      writeAudit('Password try', { username: 'ann' });
      expect(audit.lines).toHaveLength(1);
    } finally {
      configureLogging(old);
    }
  });
});

describe('the audit file', () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(path.join(os.tmpdir(), 'audit-file-'));
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('is logs/audit.log in the data folder, next to the server log, with one old file', () => {
    const serverLog = ServerLog.forDataFolder(folder, {});

    expect(serverLog.audit?.filePaths).toEqual([path.join(folder, 'logs', 'audit.log.1'), path.join(folder, 'logs', 'audit.log')]);
  });

  it('is off when LOG_FILE=off, as the server log file is', () => {
    expect(ServerLog.forDataFolder(folder, { LOG_FILE: 'off' }).audit).toBeNull();
  });

  it('gets the lines of writeAudit when the audit sink writes to it', async () => {
    const serverLog = ServerLog.forDataFolder(folder, {});
    const old = configureAudit(text => serverLog.audit?.write(text));
    try {
      writeAudit('Password try', { username: 'ann', result: 'no-such-user' });
    } finally {
      configureAudit(old);
    }
    await serverLog.close();

    expect(readFileSync(path.join(folder, 'logs', 'audit.log'), 'utf8')).toMatch(/\[audit\] Password try username=ann result=no-such-user\n$/);
  });
});

describe('auditLog middleware', () => {
  const PROXY = '127.0.0.1';
  /** What the Node server gives each request: here, a connection from the proxy */
  const fromProxy = { incoming: { socket: { remoteAddress: PROXY } } };
  let auth: Auth;
  let accounts: UserAccounts;
  let adminCookie: string;
  let viewerCookie: string;
  let audit: CapturedAudit;
  let log: CapturedLog;

  beforeAll(async () => {
    let cookie: string;
    ({ auth, accounts, cookie } = await loggedInAuth());
    adminCookie = cookie;
    const viewer = { username: 'vic', password: 'viewer-password' };
    await accounts.add({ ...viewer, role: 'viewer' });
    viewerCookie = `${SESSION_COOKIE}=${await auth.logIn(viewer, { userAgent: 'test browser', address: '127.0.0.1' })}`;
  });

  beforeEach(() => {
    audit = captureAudit();
    log = captureLog();
  });
  afterEach(() => {
    log.restore();
    audit.restore();
  });

  const app = () => testApp({ auth, accounts, proxySettings: ProxySettings.inMemory(PROXY) });
  /** A request that the proxy sends on for the computer 192.168.1.20 */
  const send = (method: string, url: string, cookie: string, body?: object) => app().request(url, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Forwarded-For': '192.168.1.20' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, fromProxy);
  const changeLines = () => audit.lines.filter(line => line.includes('[audit] Change'));

  it('writes the user, the role, the method, the route pattern, the status and the address of a change', async () => {
    const res = await send('PUT', '/api/logs/debug', adminCookie, { on: false });

    expect(res.status).toBe(200);
    expect(changeLines()).toEqual([
      expect.stringMatching(/ Change user=admin role=admin method=PUT route=\/api\/logs\/debug status=200 address=192\.168\.1\.20$/),
    ]);
  });

  it('writes the pattern of the route, and the values of its path parameters after the fixed details', async () => {
    const added = await accounts.add({ username: 'temp', password: 'temp-password', role: 'operator' });

    const res = await send('DELETE', `/api/settings/users/${added.id}`, adminCookie);

    expect(res.status).toBe(200);
    expect(changeLines()).toEqual([
      expect.stringContaining(`method=DELETE route=/api/settings/users/:id status=200 address=192.168.1.20 id=${added.id}`),
    ]);
  });

  it('also writes the line in the server log, at the info level', async () => {
    await send('PUT', '/api/logs/debug', adminCookie, { on: false });

    expect(log.lines.filter(line => line.text.includes('[audit] Change'))).toEqual([
      { level: 'info', text: expect.stringContaining('user=admin role=admin method=PUT route=/api/logs/debug status=200') },
    ]);
  });

  it('never writes a value of the body', async () => {
    const res = await send('POST', '/api/settings/users', adminCookie, { username: 'body-name-1', password: 'body-password-2', role: 'viewer' });

    expect(res.status).toBe(200);
    expect(changeLines()).toEqual([expect.stringContaining('method=POST route=/api/settings/users status=200')]);
    const all = [...audit.lines, ...log.lines.map(line => line.text)].join('\n');
    expect(all).not.toContain('body-name-1');
    expect(all).not.toContain('body-password-2');
  });

  it('never writes the query, the cookie or the Authorization header', async () => {
    const token = adminCookie.split('=')[1];
    await send('PUT', '/api/logs/debug?token=query-secret-3', adminCookie, { on: false });

    const all = [...audit.lines, ...log.lines.map(line => line.text)].join('\n');
    expect(all).not.toContain('query-secret-3');
    expect(all).not.toContain(token);
  });

  it('writes a change that the role of the user cannot do, with the 403', async () => {
    const res = await send('PUT', '/api/logs/debug', viewerCookie, { on: true });

    expect(res.status).toBe(403);
    expect(changeLines()).toEqual([expect.stringContaining('user=vic role=viewer method=PUT route=/api/logs/debug status=403')]);
  });

  it('writes a change to a route that does not exist, with the 404', async () => {
    const res = await send('POST', '/api/no-such-route', adminCookie, {});

    expect(res.status).toBe(404);
    expect(changeLines()).toEqual([expect.stringContaining('method=POST route=/api/* status=404')]);
  });

  it('writes nothing for a GET, which changes nothing', async () => {
    expect((await send('GET', '/api/logs/debug', adminCookie)).status).toBe(200);

    expect(audit.lines).toEqual([]);
  });

  it('writes nothing for a request with no login, because requireLogin stops it first', async () => {
    expect((await send('PUT', '/api/logs/debug', 'no-cookie=1', { on: true })).status).toBe(401);

    expect(changeLines()).toEqual([]);
  });

  describe('a route that throws', () => {
    const ANN = { id: 7, username: 'ann', role: 'operator' as const };
    const asAnn = createMiddleware<LoggedInEnv>(async (c, next) => {
      c.set('user', ANN);
      await next();
    });
    const failingApp = () => new Hono<LoggedInEnv>()
      .use(asAnn)
      .use(auditLog(ProxySettings.inMemory()))
      .post('/machine/:id/fail', () => {
        throw new Error('the route failed');
      });

    it('writes the 500 of the error reply', async () => {
      const app = failingApp().onError((_error, c) => c.json({ error: 'Something went wrong' }, 500));

      expect((await app.request('/machine/m1/fail', { method: 'POST' })).status).toBe(500);

      expect(changeLines()).toEqual([expect.stringContaining('user=ann role=operator method=POST route=/machine/:id/fail status=500')]);
    });

    it('writes a 500 also when the error goes on past the audit', async () => {
      const app = failingApp().onError(error => {
        throw error;
      });

      await expect(app.request('/machine/m1/fail', { method: 'POST' })).rejects.toThrow('the route failed');

      expect(changeLines()).toEqual([expect.stringContaining('method=POST route=/machine/:id/fail status=500 address=unknown id=m1')]);
    });
  });
});
