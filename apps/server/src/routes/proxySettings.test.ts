import { beforeAll, describe, expect, it } from 'vitest';
import { ProxySettings } from '../auth/proxySettings.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { Auth } from '../auth/Auth.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { errorOf, testApp, type TestApp } from './testSupport.js';

const PROXY = '127.0.0.1';
const USER = '192.168.1.20';
/** What the Node server gives each request: here, a connection from the proxy */
const fromProxy = { incoming: { socket: { remoteAddress: PROXY } } };

describe('proxy settings routes', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  let cookie: string;

  beforeAll(async () => {
    ({ auth, accounts, cookie } = await loggedInAuth());
  });

  function appWith(proxySettings: ProxySettings) {
    return testApp({ auth, accounts, proxySettings });
  }

  /** A request that the proxy sends on for a logged-in user */
  function send(app: TestApp, method: string, body?: object) {
    return app.request('/api/settings/proxy', {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Forwarded-For': USER, 'X-Forwarded-Proto': 'https' },
      body: body && JSON.stringify(body),
    }, fromProxy);
  }

  it('needs a login', async () => {
    const res = await appWith(ProxySettings.inMemory()).request('/api/settings/proxy');
    expect(res.status).toBe(401);
  });

  it('tells how this page came, and which computers sent proxy headers', async () => {
    const res = await send(appWith(ProxySettings.inMemory(PROXY)), 'GET');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      addresses: [PROXY],
      isLocked: true,
      senders: [{ address: PROXY, lastSeen: expect.any(String), isTrusted: true }],
      connection: { address: USER, isHttps: true, proxyAddress: PROXY },
    });
  });

  it('trusts a new list at once', async () => {
    const res = await send(appWith(ProxySettings.inMemory()), 'PUT', { addresses: [PROXY] });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { addresses: string[]; connection: object };
    expect(body.addresses).toEqual([PROXY]);
    expect(body.connection).toEqual({ address: USER, isHttps: true, proxyAddress: PROXY });
  });

  it('refuses a change when TRUST_PROXY sets the list', async () => {
    const res = await send(appWith(ProxySettings.inMemory(PROXY)), 'PUT', { addresses: ['10.0.0.1'] });

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toContain('TRUST_PROXY');
  });

  it.each([
    [{ addresses: ['localhost'] }, '"localhost" is not an IP address'],
    [{ addresses: [' '] }, 'cannot be empty'],
    [{ addresses: '127.0.0.1' }, 'must be a list'],
  ])('refuses a bad list: %j', async (body, error) => {
    const res = await send(appWith(ProxySettings.inMemory()), 'PUT', body);

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toContain(error);
  });
});
