import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Auth } from '../auth/Auth.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { LoginLog } from '../auth/loginLog.js';
import { loggedInAuth, TEST_LOGIN } from '../auth/testSupport.js';
import { captureLog, type CapturedLog } from '../logging/testSupport.js';
import { errorOf, testApp, type TestApp } from './testSupport.js';

const ATTACKER = '192.168.1.66';
/** The computer of the admin */
const ADMIN_COMPUTER = '192.168.1.20';
/** A connection from this address, as the Node server gives it */
const from = (address: string) => ({ incoming: { socket: { remoteAddress: address } } });

interface LoginsReport {
  limits: { maxWrongPasswords: number; maxWrongPasswordsForUser: number; lockMinutes: number };
  locked: { address: string; username: string; until: string }[];
  lockedUsers: { username: string; until: string }[];
  tries: { at: string; username: string; address: string; result: string }[];
}

describe('login settings routes', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  let cookie: string;
  let app: TestApp;
  let loginLog: LoginLog;

  beforeAll(async () => {
    ({ auth, accounts, cookie } = await loggedInAuth());
  });

  beforeEach(() => {
    loginLog = LoginLog.inMemory();
    app = testApp({ auth, accounts, loginLog });
  });

  function logIn(username: string, password: string, address = ATTACKER) {
    return app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }, from(address));
  }

  function asAdmin(path: string, body?: object) {
    return app.request(path, {
      method: body ? 'POST' : 'GET',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    }, from(ADMIN_COMPUTER));
  }

  async function lockOut(address: string) {
    for (let i = 0; i < 10; i++) await logIn('sam', 'wrong-password', address);
  }

  it('needs a login', async () => {
    expect((await app.request('/api/settings/logins')).status).toBe(401);
  });

  it('lists the tries, the newest first', async () => {
    await logIn('sam', 'wrong-password');
    await logIn(TEST_LOGIN.username, TEST_LOGIN.password);

    const report = (await (await asAdmin('/api/settings/logins')).json()) as LoginsReport;
    expect(report.tries).toEqual([
      { at: expect.any(String), username: TEST_LOGIN.username, address: ATTACKER, result: 'logged-in' },
      { at: expect.any(String), username: 's… (3 characters)', address: ATTACKER, result: 'no-such-user' },
    ]);
    expect(report.locked).toEqual([]);
    expect(report.lockedUsers).toEqual([]);
    expect(report.limits).toEqual({ maxWrongPasswords: 10, maxWrongPasswordsForUser: 30, lockMinutes: 15 });
  });

  it('masks an unknown username in a row that an older version saved in full', async () => {
    // An older version saved the text in full, and it can be a password
    loginLog.record({ username: 'My-Secret-Pa55', address: ATTACKER, result: 'no-such-user' });
    await logIn('john-secret1', 'wrong-password');

    const report = (await (await asAdmin('/api/settings/logins')).json()) as LoginsReport;
    expect(report.tries.map(loginTry => loginTry.username)).toEqual(['jo… (12 characters)', 'My… (14 characters)']);
  });

  it('shows the username of a user that exists in full', async () => {
    loginLog.record({ username: TEST_LOGIN.username, address: ATTACKER, result: 'wrong-password' });
    loginLog.record({ username: TEST_LOGIN.username, address: ATTACKER, result: 'locked' });
    const report = (await (await asAdmin('/api/settings/logins')).json()) as LoginsReport;
    expect(report.tries.map(loginTry => loginTry.username)).toEqual([TEST_LOGIN.username, TEST_LOGIN.username]);
  });

  it('masks an unknown username in a locked row that an older version saved in full', async () => {
    // An older version saved the text of a locked try in full too
    loginLog.record({ username: 'My-Secret-Pa55', address: ATTACKER, result: 'locked' });
    for (let i = 0; i < 11; i++) await logIn('john-secret1', 'wrong-password');

    const report = (await (await asAdmin('/api/settings/logins')).json()) as LoginsReport;
    expect(report.tries[0]).toMatchObject({ username: 'jo… (12 characters)', result: 'locked' });
    expect(report.tries.at(-1)).toMatchObject({ username: 'My… (14 characters)', result: 'locked' });
    expect(JSON.stringify(report)).not.toContain('Secret');
  });

  it('shows one row for unknown usernames with the same masked name', async () => {
    // The same 2 first characters and the same length
    for (let i = 0; i < 10; i++) await logIn('My-Secret-Pa55', 'wrong-password');
    for (let i = 0; i < 10; i++) await logIn('My-Other-Pa55!', 'wrong-password');
    for (let i = 0; i < 30; i++) await logIn('My-Secret-Pa55', 'wrong-password', `192.168.2.${Math.floor(i / 5)}`);
    for (let i = 0; i < 30; i++) await logIn('My-Other-Pa55!', 'wrong-password', `192.168.4.${Math.floor(i / 5)}`);

    const report = (await (await asAdmin('/api/settings/logins')).json()) as LoginsReport;
    // The web page uses the names as keys, so each name shows one time
    expect(report.locked).toEqual([{ address: ATTACKER, username: 'my… (14 characters)', until: expect.any(String) }]);
    expect(report.lockedUsers).toEqual([{ username: 'my… (14 characters)', until: expect.any(String) }]);
  });

  it('lists a locked computer, and unlocks it', async () => {
    await lockOut(ATTACKER);
    const before = (await (await asAdmin('/api/settings/logins')).json()) as LoginsReport;
    // No user has the username "sam", and an unknown username can be a password, so the list masks it
    expect(before.locked).toEqual([{ address: ATTACKER, username: 's… (3 characters)', until: expect.any(String) }]);

    const res = await asAdmin('/api/settings/logins/unlock', { address: ATTACKER });

    expect(res.status).toBe(200);
    expect(((await res.json()) as LoginsReport).locked).toEqual([]);
    expect((await logIn('sam', 'wrong-password')).status).toBe(401);
  });

  it('lists a locked computer with the full name of a user that exists', async () => {
    for (let i = 0; i < 10; i++) await logIn(TEST_LOGIN.username, 'wrong-password');
    const report = (await (await asAdmin('/api/settings/logins')).json()) as LoginsReport;
    expect(report.locked).toEqual([{ address: ATTACKER, username: TEST_LOGIN.username, until: expect.any(String) }]);
  });

  it('unlocks only the IPv4 address that the admin gives', async () => {
    await lockOut(ATTACKER);
    await lockOut('192.168.1.67');

    await asAdmin('/api/settings/logins/unlock', { address: ATTACKER });

    expect((await logIn('sam', 'wrong-password')).status).toBe(401);
    expect((await logIn('sam', 'wrong-password', '192.168.1.67')).status).toBe(429);
  });

  it('lists a user that is locked on all addresses, and unlocks it', async () => {
    for (let i = 0; i < 30; i++) await logIn('sam', 'wrong-password', `192.168.2.${Math.floor(i / 5)}`);
    const before = (await (await asAdmin('/api/settings/logins')).json()) as LoginsReport;
    expect(before.lockedUsers).toEqual([{ username: 's… (3 characters)', until: expect.any(String) }]);

    const res = await asAdmin('/api/settings/logins/unlock', { username: 'Sam' });

    expect(res.status).toBe(200);
    expect(((await res.json()) as LoginsReport).lockedUsers).toEqual([]);
    expect((await logIn('sam', 'wrong-password', '192.168.3.1')).status).toBe(401);
  });

  it('unlocks a user with an unknown username by the masked name that the list shows', async () => {
    // The limiter keeps the username in lower case, as the login reads it
    for (let i = 0; i < 30; i++) await logIn('My-Secret-Pa55', 'wrong-password', `192.168.2.${Math.floor(i / 5)}`);
    const before = (await (await asAdmin('/api/settings/logins')).json()) as LoginsReport;
    expect(before.lockedUsers).toEqual([{ username: 'my… (14 characters)', until: expect.any(String) }]);

    const res = await asAdmin('/api/settings/logins/unlock', { username: 'my… (14 characters)' });

    expect(((await res.json()) as LoginsReport).lockedUsers).toEqual([]);
    expect((await logIn('My-Secret-Pa55', 'wrong-password', '192.168.3.1')).status).toBe(401);
  });

  it('unlocks each unknown username that fits the masked name, but not a user that exists', async () => {
    for (let i = 0; i < 30; i++) await logIn('My-Secret-Pa55', 'wrong-password', `192.168.2.${Math.floor(i / 5)}`);
    for (let i = 0; i < 30; i++) await logIn('My-Other-Pa55!', 'wrong-password', `192.168.4.${Math.floor(i / 5)}`);
    for (let i = 0; i < 30; i++) await logIn(TEST_LOGIN.username, 'wrong-password', `192.168.5.${Math.floor(i / 5)}`);

    const res = await asAdmin('/api/settings/logins/unlock', { username: 'my… (14 characters)' });

    expect(((await res.json()) as LoginsReport).lockedUsers).toEqual([{ username: TEST_LOGIN.username, until: expect.any(String) }]);
    expect((await logIn('My-Secret-Pa55', 'wrong-password', '192.168.3.1')).status).toBe(401);
    expect((await logIn('My-Other-Pa55!', 'wrong-password', '192.168.3.1')).status).toBe(401);
    expect((await logIn(TEST_LOGIN.username, TEST_LOGIN.password, '192.168.3.1')).status).toBe(429);
  });

  describe('log', () => {
    let log: CapturedLog;

    beforeEach(() => {
      log = captureLog();
    });

    afterEach(() => {
      log.restore();
    });

    it('writes who unlocked a computer, from which address', async () => {
      await asAdmin('/api/settings/logins/unlock', { address: ATTACKER });

      const text = log.text('info');
      expect(text).toContain('Login lock removed');
      expect(text).toContain(`by=${TEST_LOGIN.username}`);
      expect(text).toContain(`from=${ADMIN_COMPUTER}`);
      expect(text).toContain(`address=${ATTACKER}`);
    });

    it('writes who unlocked a user, from which address', async () => {
      const otherCase = TEST_LOGIN.username.toUpperCase();
      await asAdmin('/api/settings/logins/unlock', { username: otherCase });

      const text = log.text('info');
      expect(text).toContain('Login lock removed');
      expect(text).toContain(`by=${TEST_LOGIN.username}`);
      expect(text).toContain(`from=${ADMIN_COMPUTER}`);
      expect(text).toContain(`username=${otherCase}`);
    });

    it('masks an unknown username that an admin types for an unlock, but not the masked name of the list', async () => {
      await asAdmin('/api/settings/logins/unlock', { username: 'My-Secret-Pa55' });
      await asAdmin('/api/settings/logins/unlock', { username: 'my… (14 characters)' });

      const lines = log.lines.filter(line => line.text.includes('Login lock removed')).map(line => line.text);
      expect(lines).toEqual([
        expect.stringContaining('username="My… (14 characters)"'),
        expect.stringContaining('username="my… (14 characters)"'),
      ]);
      expect(log.text()).not.toContain('Secret');
    });

    it('writes nothing for an unlock that the check refuses', async () => {
      await asAdmin('/api/settings/logins/unlock', {});
      expect(log.text()).not.toContain('Login lock removed');
    });
  });

  it('refuses an unlock with no address', async () => {
    const res = await asAdmin('/api/settings/logins/unlock', { address: ' ' });
    expect(res.status).toBe(400);
  });

  it('refuses an unlock with no address and no username', async () => {
    const res = await asAdmin('/api/settings/logins/unlock', {});
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Give an address or a username to unlock');
  });
});
