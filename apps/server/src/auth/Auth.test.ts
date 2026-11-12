import { beforeEach, describe, expect, it } from 'vitest';
import type { Auth } from './Auth.js';
import { authParts } from './testSupport.js';
import type { UserAccounts } from './userAccounts.js';
import type { UserStore } from './userStore.js';

const ADMIN = { username: 'admin', password: 'right-password' };
const SAM = { username: 'sam', password: 'sam-password' };
const BROWSER = { userAgent: 'test browser', address: '192.168.1.20' };

describe('Auth', () => {
  let users: UserStore;
  let accounts: UserAccounts;
  let auth: Auth;

  beforeEach(() => {
    ({ users, accounts, auth } = authParts());
  });

  it('needs setup before the first admin', () => {
    expect(auth.isSetUp()).toBe(false);
  });

  it('lets only the first visitor make the admin', async () => {
    expect(await auth.setUp(ADMIN, BROWSER)).toEqual(expect.any(String));
    expect(await auth.setUp({ username: 'other', password: 'other-password' }, BROWSER)).toBeNull();
    expect(await auth.logIn(ADMIN, BROWSER)).toEqual(expect.any(String));
    expect(users.findByName('admin')?.role).toBe('admin');
  });

  it('allows only one of two setups at the same time', async () => {
    const results = await Promise.all([
      auth.setUp({ username: 'one', password: 'password-one' }, BROWSER),
      auth.setUp({ username: 'two', password: 'password-two' }, BROWSER),
    ]);
    expect(results.filter(token => token !== null)).toHaveLength(1);
  });

  it('gives a session for the right username and password only', async () => {
    await auth.setUp(ADMIN, BROWSER);
    expect(await auth.logIn({ ...ADMIN, password: 'wrong-password' }, BROWSER)).toBeNull();
    expect(await auth.logIn({ ...ADMIN, username: 'someone' }, BROWSER)).toBeNull();

    const token = await auth.logIn(ADMIN, BROWSER);
    expect(auth.sessionOf(token!)?.user).toMatchObject({ username: 'admin', role: 'admin' });
  });

  it('lets each user log in with their own password', async () => {
    await auth.setUp(ADMIN, BROWSER);
    await accounts.add({ ...SAM, role: 'operator' });

    expect(await auth.logIn({ ...SAM, password: ADMIN.password }, BROWSER)).toBeNull();
    const token = await auth.logIn(SAM, BROWSER);
    expect(auth.sessionOf(token!)?.user).toMatchObject({ username: 'sam', role: 'operator' });
  });

  it('saves the time of the last login', async () => {
    await auth.setUp(ADMIN, BROWSER);
    await accounts.add({ ...SAM, role: 'viewer' });
    expect(users.findByName('sam')?.lastLoginAt).toBeNull();

    await auth.logIn(SAM, BROWSER);
    expect(users.findByName('sam')?.lastLoginAt).toEqual(expect.any(Date));
  });

  it('does not care about the case of the username', async () => {
    await auth.setUp(ADMIN, BROWSER);
    expect(await auth.logIn({ ...ADMIN, username: 'Admin' }, BROWSER)).toEqual(expect.any(String));
  });

  it('accepts the login from a program, also the second time', async () => {
    await auth.setUp(ADMIN, BROWSER);
    expect(await auth.userOf(ADMIN)).toMatchObject({ username: 'admin', role: 'admin' });
    expect(auth.knownUserOf({ ...ADMIN, username: 'ADMIN' })?.username).toBe('admin');
    expect(await auth.userOf({ ...ADMIN, password: 'wrong-password' })).toBeNull();
    expect(auth.knownUserOf({ ...ADMIN, username: 'someone' })).toBeNull();
  });

  it('knows the program logins of two users at the same time', async () => {
    await auth.setUp(ADMIN, BROWSER);
    await accounts.add({ ...SAM, role: 'operator' });
    await auth.userOf(ADMIN);
    await auth.userOf(SAM);

    expect(auth.knownUserOf(ADMIN)?.username).toBe('admin');
    expect(auth.knownUserOf(SAM)?.username).toBe('sam');
    expect(auth.knownUserOf({ ...SAM, password: ADMIN.password })).toBeNull();
  });

  it('gives the new role at once, also for a known program login', async () => {
    await auth.setUp(ADMIN, BROWSER);
    const sam = await accounts.add({ ...SAM, role: 'operator' });
    const token = await auth.logIn(SAM, BROWSER);
    await auth.userOf(SAM);

    accounts.changeRole(sam.id, 'viewer');

    expect(auth.sessionOf(token!)?.user.role).toBe('viewer');
    expect(auth.knownUserOf(SAM)?.role).toBe('viewer');
  });

  it('stops the old sessions of the user and the old program login when the password changes', async () => {
    const oldSession = await auth.setUp(ADMIN, BROWSER);
    await accounts.add({ ...SAM, role: 'operator' });
    const samSession = await auth.logIn(SAM, BROWSER);
    await auth.userOf(ADMIN);
    const admin = auth.sessionOf(oldSession!)!.user;

    expect(await auth.changePassword(admin, { currentPassword: 'wrong-password', newPassword: 'new-password' }, BROWSER)).toBeNull();
    const newSession = await auth.changePassword(admin, { currentPassword: ADMIN.password, newPassword: 'new-password' }, BROWSER);

    expect(auth.sessionOf(oldSession!)).toBeNull();
    expect(auth.sessionOf(newSession!)?.user.username).toBe('admin');
    expect(auth.sessionOf(samSession!)?.user.username).toBe('sam');
    expect(await auth.userOf(ADMIN)).toBeNull();
    expect((await auth.userOf({ username: 'admin', password: 'new-password' }))?.username).toBe('admin');
  });

  it('logs out a user who is removed', async () => {
    await auth.setUp(ADMIN, BROWSER);
    const sam = await accounts.add({ ...SAM, role: 'operator' });
    const token = await auth.logIn(SAM, BROWSER);
    await auth.userOf(SAM);

    accounts.remove(sam.id);

    expect(auth.sessionOf(token!)).toBeNull();
    expect(auth.knownUserOf(SAM)).toBeNull();
  });

  it('needs setup again after a reset, and keeps the users who are not admins', async () => {
    const session = await auth.setUp(ADMIN, BROWSER);
    await accounts.add({ ...SAM, role: 'operator' });
    await auth.userOf(ADMIN);

    users.removeAdmins();

    expect(auth.isSetUp()).toBe(false);
    expect(auth.sessionOf(session!)).toBeNull();
    expect(await auth.userOf(ADMIN)).toBeNull();
    expect(await auth.logIn(SAM, BROWSER)).toEqual(expect.any(String));
  });

  it('does not let a session of a removed admin log in to the new admin', async () => {
    const oldSession = await auth.setUp(ADMIN, BROWSER);
    users.removeAdmins();
    await auth.setUp({ username: 'new-admin', password: 'new-password' }, BROWSER);

    expect(auth.sessionOf(oldSession!)).toBeNull();
  });

  it('starts no session when the password changes during the slow password check', async () => {
    await auth.setUp(ADMIN, BROWSER);
    const login = auth.logIn(ADMIN, BROWSER);
    // Another browser saves a new password while the check runs
    users.setPasswordHash(users.findByName('admin')!.id, 'the hash of a new password');

    expect(await login).toBeNull();
  });
});
