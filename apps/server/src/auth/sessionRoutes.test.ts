import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { HardwarePoller } from '../polling/poller.js';
import { noHistory } from '../recording/testSupport.js';
import { SESSION_COOKIE } from './authRoutes.js';
import { SEEN_INTERVAL_MS } from './sessionStore.js';
import { authParts, loggedInAuth, TEST_LOGIN } from './testSupport.js';

const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0.0.0 Safari/537.36';

interface SessionsReport {
  sessions: { device: string; address: string; lastSeenAt: string; isThisBrowser: boolean }[];
}

describe('session routes', () => {
  let app: ReturnType<typeof createApp>;
  let setupCookie: string;

  beforeEach(async () => {
    const { auth, accounts, cookie } = await loggedInAuth();
    setupCookie = cookie;
    app = createApp({ poller: new HardwarePoller(new Database(':memory:')), auth, accounts, history: noHistory() });
  });

  /** Log in from another browser, and give its cookie */
  async function logInFromChrome(): Promise<string> {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': MAC_CHROME },
      body: JSON.stringify(TEST_LOGIN),
    });
    return (res.headers.get('Set-Cookie') ?? '').split(';')[0];
  }

  const withCookie = (cookie: string, method = 'GET') => ({ method, headers: { Cookie: cookie } });

  it('needs a browser login', async () => {
    expect((await app.request('/api/auth/sessions')).status).toBe(401);
    expect((await app.request('/api/auth/sessions/log-out-others', { method: 'POST' })).status).toBe(401);
  });

  it('lists each browser, and marks this one', async () => {
    const chromeCookie = await logInFromChrome();
    expect(chromeCookie).toContain(`${SESSION_COOKIE}=`);

    const report = (await (await app.request('/api/auth/sessions', withCookie(chromeCookie))).json()) as SessionsReport;
    expect(report.sessions).toHaveLength(2);
    expect(report.sessions.find(session => session.isThisBrowser)?.device).toBe('Chrome on Mac');
  });

  it('logs out every other browser', async () => {
    const chromeCookie = await logInFromChrome();

    const res = await app.request('/api/auth/sessions/log-out-others', withCookie(chromeCookie, 'POST'));

    expect(((await res.json()) as SessionsReport).sessions).toEqual([expect.objectContaining({ isThisBrowser: true })]);
    expect((await app.request('/api/machines', withCookie(setupCookie))).status).toBe(401);
    expect((await app.request('/api/machines', withCookie(chromeCookie))).status).toBe(200);
  });

  it('saves when a browser was last used', async () => {
    let now = Date.parse('2026-11-09T10:00:00Z');
    const db = new Database(':memory:');
    const { auth, accounts } = authParts(db, () => now);
    const token = await auth.setUp(TEST_LOGIN, { userAgent: MAC_CHROME, address: '127.0.0.1' });
    const clockedApp = createApp({ poller: new HardwarePoller(db), auth, accounts, history: noHistory() });
    const cookie = `${SESSION_COOKIE}=${token}`;

    now += SEEN_INTERVAL_MS;
    await clockedApp.request('/api/machines', withCookie(cookie));

    const report = (await (await clockedApp.request('/api/auth/sessions', withCookie(cookie))).json()) as SessionsReport;
    expect(report.sessions[0].lastSeenAt).toBe(new Date(now).toISOString());
  });
});
