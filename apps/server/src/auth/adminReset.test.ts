import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { captureAudit, captureLog } from '../logging/testSupport.js';
import { PromoteNotConfirmedError, resetAdmins } from './adminReset.js';
import { LoginLog } from './loginLog.js';
import { hashPassword } from './passwords.js';
import { authParts } from './testSupport.js';

const BROWSER = { userAgent: 'test browser', address: '192.168.1.20' };

/** The parts on one database, with an Admin, an Operator and a Viewer that are each logged in on one browser */
async function shop() {
  const db = new Database(':memory:');
  const parts = { ...authParts(db), loginLog: new LoginLog(db) };
  const { auth, accounts, users } = parts;
  const adminSession = (await auth.setUp({ username: 'admin', password: 'admin-password' }, BROWSER))!;
  const sam = await accounts.add({ username: 'sam', password: 'sam-password', role: 'operator' });
  const vic = await accounts.add({ username: 'vic', password: 'vic-password', role: 'viewer' });
  const samSession = (await auth.logIn({ username: 'sam', password: 'sam-password' }, BROWSER))!;
  const samDevice = auth.deviceCookieFor('sam');
  return { ...parts, admin: users.findByName('admin')!, sam, vic, adminSession, samSession, samDevice };
}

const newAdmin = async (username: string, password = 'new-admin-password') =>
  ({ username, passwordHash: await hashPassword(password) });

const roles = (users: ReturnType<typeof authParts>['users']) =>
  users.list().map(({ username, role }) => `${username}: ${role}`);

describe('resetAdmins (npm run reset-password)', () => {
  it('replaces the Admins with one new Admin, logs out each browser, and stops each device cookie', async () => {
    const { users, sessions, loginLog, auth, sam, admin, samSession, adminSession, samDevice } = await shop();

    expect(resetAdmins({ users, sessions, loginLog }, await newAdmin('boss'))).toEqual({ reset: 'created', username: 'boss' });

    expect(roles(users)).toEqual(['boss: admin', 'sam: operator', 'vic: viewer']);
    expect(users.find(admin.id)).toBeNull();
    expect(users.find(sam.id)).not.toBeNull();
    expect(auth.sessionOf(samSession)).toBeNull();
    expect(auth.sessionOf(adminSession)).toBeNull();
    expect(auth.knownDeviceOf(samDevice, 'sam')).toBeNull();
    expect(await auth.logIn({ username: 'boss', password: 'new-admin-password' }, BROWSER)).not.toBeNull();
    expect(await auth.logIn({ username: 'admin', password: 'admin-password' }, BROWSER)).toBeNull();
  });

  it('keeps the setup closed', async () => {
    const { users, sessions, loginLog, auth } = await shop();

    resetAdmins({ users, sessions, loginLog }, await newAdmin('boss'));

    expect(auth.isSetUp()).toBe(true);
    expect(await auth.setUp({ username: 'intruder', password: 'intruder-password' }, BROWSER)).toBeNull();
  });

  it('gives the name of the old Admin to a new account, so the old logins cannot come back', async () => {
    const { users, sessions, loginLog, auth, admin } = await shop();

    resetAdmins({ users, sessions, loginLog }, await newAdmin('admin'));

    const replaced = users.findByName('admin')!;
    expect(replaced.role).toBe('admin');
    expect(replaced.id).not.toBe(admin.id);
    expect(await auth.logIn({ username: 'admin', password: 'new-admin-password' }, BROWSER)).not.toBeNull();
  });

  it('removes each Admin when there are more than one', async () => {
    const { users, sessions, loginLog, accounts } = await shop();
    await accounts.add({ username: 'second-admin', password: 'second-password', role: 'admin' });

    resetAdmins({ users, sessions, loginLog }, await newAdmin('boss'));

    expect(users.list().filter(user => user.role === 'admin').map(user => user.username)).toEqual(['boss']);
  });

  it('promotes an Operator to Admin with the new password when the person confirmed it', async () => {
    const { users, sessions, loginLog, auth, sam, samSession } = await shop();

    expect(resetAdmins({ users, sessions, loginLog }, await newAdmin('SAM'), { promote: true }))
      .toEqual({ reset: 'promoted', username: 'sam' });

    expect(roles(users)).toEqual(['sam: admin', 'vic: viewer']);
    expect(users.find(sam.id)!.role).toBe('admin');
    expect(auth.sessionOf(samSession)).toBeNull();
    expect(await auth.logIn({ username: 'sam', password: 'sam-password' }, BROWSER)).toBeNull();
    expect(await auth.logIn({ username: 'sam', password: 'new-admin-password' }, BROWSER)).not.toBeNull();
  });

  it('changes nothing when the name belongs to a Viewer and the person did not confirm the promotion', async () => {
    const { users, sessions, loginLog, auth, vic, adminSession } = await shop();
    const before = roles(users);

    expect(() => resetAdmins({ users, sessions, loginLog }, { username: 'vic', passwordHash: 'x' })).toThrow(PromoteNotConfirmedError);

    expect(roles(users)).toEqual(before);
    expect(users.find(vic.id)!.passwordHash).not.toBe('x');
    expect(auth.sessionOf(adminSession)).not.toBeNull();
  });

  it('changes nothing when a step fails', async () => {
    const { users, sessions, loginLog, auth, adminSession, samDevice } = await shop();
    const before = roles(users);
    const admin = await newAdmin('boss');
    vi.spyOn(users, 'add').mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => resetAdmins({ users, sessions, loginLog }, admin)).toThrow('disk full');

    expect(roles(users)).toEqual(before);
    expect(auth.sessionOf(adminSession)).not.toBeNull();
    expect(auth.knownDeviceOf(samDevice, 'sam')).not.toBeNull();
    expect(loginLog.recent()).toEqual([]);
  });

  it('changes nothing when the new password of a promoted user cannot be saved', async () => {
    const { users, sessions, loginLog, auth, samSession } = await shop();
    const before = roles(users);
    const admin = await newAdmin('sam');
    vi.spyOn(users, 'setPasswordHash').mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => resetAdmins({ users, sessions, loginLog }, admin, { promote: true })).toThrow('disk full');

    expect(roles(users)).toEqual(before);
    expect(auth.sessionOf(samSession)).not.toBeNull();
  });

  it('writes the new Admin in the audit log, but not the password', async () => {
    const { users, sessions, loginLog } = await shop();
    const audit = captureAudit();
    try {
      const admin = await newAdmin('sam', 'secret-password');
      resetAdmins({ users, sessions, loginLog }, admin, { promote: true });

      expect(audit.lines).toEqual([expect.stringMatching(/\[audit\] reset-password made a new Admin username=sam promoted=true$/)]);
      expect(audit.lines.join('\n')).not.toContain('secret-password');
      expect(audit.lines.join('\n')).not.toContain(admin.passwordHash);
    } finally {
      audit.restore();
    }
  });

  it('writes a warn line with the name of the new Admin, but not the password', async () => {
    const { users, sessions, loginLog } = await shop();
    const log = captureLog();
    try {
      const admin = await newAdmin('boss', 'secret-password');
      resetAdmins({ users, sessions, loginLog }, admin);

      const lines = log.lines.filter(line => line.level === 'warn');
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toContain('username=boss');
      expect(lines[0].text).toContain('promoted=false');
      expect(log.text()).not.toContain('secret-password');
      expect(log.text()).not.toContain(admin.passwordHash);
    } finally {
      log.restore();
    }
  });

  it('writes the stored name of a promoted user and promoted=true in the warn line', async () => {
    const { users, sessions, loginLog } = await shop();
    const log = captureLog();
    try {
      resetAdmins({ users, sessions, loginLog }, await newAdmin('SAM'), { promote: true });

      const lines = log.lines.filter(line => line.level === 'warn');
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toContain('username=sam');
      expect(lines[0].text).toContain('promoted=true');
    } finally {
      log.restore();
    }
  });

  it('adds a row to the login log, so an Admin sees the reset in Settings > Logins', async () => {
    const { users, sessions, loginLog } = await shop();

    resetAdmins({ users, sessions, loginLog }, await newAdmin('SAM'), { promote: true });

    expect(loginLog.recent()).toEqual([
      expect.objectContaining({ username: 'sam', address: 'server terminal', result: 'reset-password' }),
    ]);
  });
});
