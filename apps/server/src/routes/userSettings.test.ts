import { ROLES, type Role } from '@local-chatter/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { errorOf, testApp, type TestApp } from './testSupport.js';

interface UsersReport {
  users: { id: number; username: string; role: Role; lastLoginAt: string | null; isYou: boolean }[];
}

const PASSWORD = 'a-good-password';

describe('user settings routes', () => {
  let app: TestApp;
  let accounts: UserAccounts;
  let adminCookie: string;

  beforeEach(async () => {
    const parts = await loggedInAuth();
    ({ accounts } = parts);
    adminCookie = parts.cookie;
    app = testApp({ auth: parts.auth, accounts });
  });

  function send(cookie: string, method: string, path: string, body?: object) {
    return app.request(`/api${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
  }

  const asAdmin = (method: string, path: string, body?: object) => send(adminCookie, method, path, body);

  /** Add a user, log them in, and give their id and browser cookie */
  async function userWithRole(username: string, role: Role) {
    const user = await accounts.add({ username, password: PASSWORD, role });
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    return { id: user.id, cookie: (res.headers.get('Set-Cookie') ?? '').split(';')[0] };
  }

  const adminId = async () => ((await (await asAdmin('GET', '/settings/users')).json()) as UsersReport).users[0].id;

  it('lists the users and marks you', async () => {
    const report = (await (await asAdmin('GET', '/settings/users')).json()) as UsersReport;
    expect(report.users).toEqual([expect.objectContaining({ username: 'admin', role: 'admin', isYou: true })]);
  });

  it('adds a user who can then log in', async () => {
    const res = await asAdmin('POST', '/settings/users', { username: 'sam', password: PASSWORD, role: 'operator' });

    const report = (await res.json()) as UsersReport;
    expect(report.users.map(user => `${user.username}: ${user.role}`)).toEqual(['admin: admin', 'sam: operator']);
    const { cookie } = await userWithRole('jo', 'viewer');
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
  });

  it('refuses a username that exists already, a short password, and an unknown role', async () => {
    const taken = await asAdmin('POST', '/settings/users', { username: 'ADMIN', password: PASSWORD, role: 'viewer' });
    expect(taken.status).toBe(409);
    expect(await errorOf(taken)).toContain('exists already');

    expect((await asAdmin('POST', '/settings/users', { username: 'sam', password: 'short', role: 'viewer' })).status).toBe(400);
    expect((await asAdmin('POST', '/settings/users', { username: 'sam', password: PASSWORD, role: 'boss' })).status).toBe(400);
  });

  it('changes the role of a user, and the new role works at once', async () => {
    const sam = await userWithRole('sam', 'operator');

    const res = await asAdmin('PUT', `/settings/users/${sam.id}/role`, { role: 'admin' });

    expect(((await res.json()) as UsersReport).users.find(user => user.id === sam.id)?.role).toBe('admin');
    expect((await send(sam.cookie, 'GET', '/settings/users')).status).toBe(200);
  });

  it('does not let you change your own role, set your own password here, or remove yourself', async () => {
    const id = await adminId();

    expect((await asAdmin('PUT', `/settings/users/${id}/role`, { role: 'viewer' })).status).toBe(400);
    expect((await asAdmin('PUT', `/settings/users/${id}/password`, { password: PASSWORD })).status).toBe(400);
    expect((await asAdmin('DELETE', `/settings/users/${id}`)).status).toBe(400);
  });

  it('lets a second admin remove the first admin', async () => {
    const sam = await userWithRole('sam', 'admin');
    const firstAdminId = await adminId();

    expect((await send(sam.cookie, 'DELETE', `/settings/users/${firstAdminId}`)).status).toBe(200);
    expect(accounts.list().map(user => user.username)).toEqual(['sam']);
  });

  it('sets a new password for a user, and logs out their browsers', async () => {
    const sam = await userWithRole('sam', 'operator');

    expect((await asAdmin('PUT', `/settings/users/${sam.id}/password`, { password: 'another-password' })).status).toBe(200);

    expect((await send(sam.cookie, 'GET', '/machines')).status).toBe(401);
  });

  it('removes a user, and logs out their browsers', async () => {
    const sam = await userWithRole('sam', 'operator');

    const res = await asAdmin('DELETE', `/settings/users/${sam.id}`);

    expect(((await res.json()) as UsersReport).users.map(user => user.username)).toEqual(['admin']);
    expect((await send(sam.cookie, 'GET', '/machines')).status).toBe(401);
  });

  it('gives 404 for a user that does not exist, and 400 for an id that is not a number', async () => {
    expect((await asAdmin('PUT', '/settings/users/999/role', { role: 'viewer' })).status).toBe(404);
    expect((await asAdmin('PUT', '/settings/users/999/password', { password: PASSWORD })).status).toBe(404);
    expect((await asAdmin('DELETE', '/settings/users/999')).status).toBe(404);
    expect((await asAdmin('DELETE', '/settings/users/abc')).status).toBe(400);
  });

  describe('roles', () => {
    const ANY_BODY = { username: 'x', password: PASSWORD, role: 'admin', addresses: [], address: '1.2.3.4', range: '192.168.1', host: '192.168.1.50', type: 'haas', name: 'x' };
    /** Each route that needs a role, and the lowest role that can use it */
    const GUARDED_ROUTES: Array<{ method: string; path: string; lowest: Role }> = [
      { method: 'POST', path: '/machine/1/files/upload', lowest: 'operator' },
      { method: 'POST', path: '/machine/1/files/upload-batch', lowest: 'operator' },
      { method: 'DELETE', path: '/machine/1/files?path=O1000.nc', lowest: 'operator' },
      { method: 'POST', path: '/machines', lowest: 'admin' },
      { method: 'PUT', path: '/machine/1', lowest: 'admin' },
      { method: 'DELETE', path: '/machine/1', lowest: 'admin' },
      { method: 'POST', path: '/mtconnect/scan-port', lowest: 'admin' },
      { method: 'GET', path: '/discovery/ranges', lowest: 'admin' },
      { method: 'POST', path: '/discovery/scan', lowest: 'admin' },
      { method: 'GET', path: '/settings/proxy', lowest: 'admin' },
      { method: 'PUT', path: '/settings/proxy', lowest: 'admin' },
      { method: 'GET', path: '/settings/logins', lowest: 'admin' },
      { method: 'POST', path: '/settings/logins/unlock', lowest: 'admin' },
      { method: 'GET', path: '/settings/users', lowest: 'admin' },
      { method: 'POST', path: '/settings/users', lowest: 'admin' },
      { method: 'PUT', path: '/settings/users/1/role', lowest: 'admin' },
      { method: 'PUT', path: '/settings/users/1/password', lowest: 'admin' },
      { method: 'DELETE', path: '/settings/users/1', lowest: 'admin' },
      { method: 'GET', path: '/focas/status', lowest: 'admin' },
      { method: 'POST', path: '/focas/library', lowest: 'admin' },
      { method: 'DELETE', path: '/focas/library', lowest: 'admin' },
      { method: 'GET', path: '/updates/status', lowest: 'admin' },
      { method: 'POST', path: '/updates/file', lowest: 'admin' },
      { method: 'POST', path: '/updates/check', lowest: 'admin' },
      { method: 'POST', path: '/updates/install', lowest: 'admin' },
      { method: 'POST', path: '/updates/download', lowest: 'admin' },
      { method: 'PUT', path: '/updates/settings', lowest: 'admin' },
    ];
    const tooLowFor = (lowest: Role) => ROLES.slice(0, ROLES.indexOf(lowest));

    it('stops each role that is too low, on each route that needs a role', async () => {
      for (const role of ['viewer', 'operator'] as const) {
        const { cookie } = await userWithRole(role, role);
        for (const route of GUARDED_ROUTES.filter(route => tooLowFor(route.lowest).includes(role))) {
          const res = await send(cookie, route.method, route.path, route.method === 'GET' ? undefined : ANY_BODY);
          expect(res.status, `${role}: ${route.method} ${route.path}`).toBe(403);
          expect(await errorOf(res)).toBe('Your role cannot do this. Ask an admin.');
        }
      }
    });

    it('lets an operator past the role check for files', async () => {
      const { cookie } = await userWithRole('sam', 'operator');
      // 404: past the role check, but there is no machine 1
      expect((await send(cookie, 'DELETE', '/machine/1/files?path=O1000.nc')).status).toBe(404);
      expect((await asAdmin('DELETE', '/machine/1')).status).toBe(404);
    });

    it('lets a viewer see the machines', async () => {
      const { cookie } = await userWithRole('jo', 'viewer');
      expect((await send(cookie, 'GET', '/machines')).status).toBe(200);
    });

    it('checks the role of a program that sends the password', async () => {
      await accounts.add({ username: 'script', password: PASSWORD, role: 'viewer' });
      const basic = { Authorization: `Basic ${Buffer.from(`script:${PASSWORD}`).toString('base64')}` };

      expect((await app.request('/api/machines', { headers: basic })).status).toBe(200);
      expect((await app.request('/api/machine/1', { method: 'DELETE', headers: basic })).status).toBe(403);
      // The second request uses the fast check of a known login. The role still counts.
      expect((await app.request('/api/machine/1', { method: 'DELETE', headers: basic })).status).toBe(403);
    });
  });

  it('shows each user only their own browsers', async () => {
    const { cookie } = await userWithRole('sam', 'operator');

    const res = await send(cookie, 'GET', '/auth/sessions');

    expect(((await res.json()) as { sessions: unknown[] }).sessions).toHaveLength(1);
  });

  it('gives the role in the login status', async () => {
    const { cookie } = await userWithRole('sam', 'operator');
    const status = await (await send(cookie, 'GET', '/auth/status')).json();
    expect(status).toMatchObject({ loggedIn: true, user: { username: 'sam', role: 'operator' } });
  });
});
