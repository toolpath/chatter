import Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OPCUA_NO_ENCRYPTION_WARNING } from '@local-chatter/shared';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { Auth } from '../auth/Auth.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { captureLog, type CapturedLog } from '../logging/testSupport.js';
import type { BaseMachineStatus } from '../types/index.js';
import { HardwarePoller } from '../polling/poller.js';
import { applySchema } from '../storage/schema.js';
import { testApp } from './testSupport.js';

interface MachineReply {
  id: string;
  opcuaSecurity: string;
  hasOpcuaPassword: boolean;
  opcuaSecurityWarning?: string;
}

// F-11, D6: Security None with a login is saved, but the add, the change and the status warn
describe('the warning for a Siemens login with Security None', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  let cookie: string;
  let viewerCookie: string;
  let db: Database.Database;
  let poller: HardwarePoller;
  let log: CapturedLog;

  beforeAll(async () => {
    ({ auth, accounts, cookie } = await loggedInAuth());
    const viewer = { username: 'vic', password: 'test-password' };
    await accounts.add({ ...viewer, role: 'viewer' });
    viewerCookie = `${SESSION_COOKIE}=${await auth.logIn(viewer, { userAgent: 'test browser', address: '127.0.0.1' })}`;
  });

  beforeEach(() => {
    db = new Database(':memory:');
    applySchema(db);
    poller = new HardwarePoller(db);
    log = captureLog();
  });

  afterEach(() => {
    log.restore();
    poller.stop();
  });

  const app = () => testApp({ auth, accounts, poller });
  const send = async (method: 'POST' | 'PUT', path: string, body: object) => {
    const response = await app().request(path, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as MachineReply };
  };
  const add = (body: object) => send('POST', '/api/machines', { type: 'siemens', name: 'DMU', host: '192.168.1.60', ...body });
  const update = (id: string, body: object) => send('PUT', `/api/machine/${id}`, body);
  const machine = async (id: string, as = cookie) =>
    (await (await app().request(`/api/machine/${id}`, { headers: { Cookie: as } })).json()) as MachineReply;
  const listed = async (id: string, as = cookie) =>
    ((await (await app().request('/api/machines', { headers: { Cookie: as } })).json()) as MachineReply[]).find(m => m.id === id);
  const saved = (id: string) =>
    db.prepare('SELECT opcua_security, opcua_user FROM siemens_machines WHERE id = ?').get(id) as { opcua_security: string; opcua_user: string };
  const savedSecurity = (id: string) => saved(id).opcua_security;
  const logWarnings = () => log.lines.filter(line => line.level === 'warn' && line.text.includes('Security is None'));

  it('saves a new machine with a login and Security None, and the reply warns', async () => {
    const { status, body } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'none' });

    expect(status).toBe(201);
    expect(body.opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    expect(savedSecurity(body.id)).toBe('none');
    expect((await machine(body.id)).opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    expect((await listed(body.id))?.opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    expect(logWarnings()).toHaveLength(1);
    expect(logWarnings()[0].text).not.toContain('secret');
    expect(logWarnings()[0].text).not.toContain('OpcUaClient');
  });

  it('writes the same warning text in the log as in the status, with the machine and its address', async () => {
    const { body } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'none' });

    expect(logWarnings()).toHaveLength(1);
    expect(logWarnings()[0].text).toContain(OPCUA_NO_ENCRYPTION_WARNING);
    expect(logWarnings()[0].text).toContain(body.id);
    expect(logWarnings()[0].text).toContain('192.168.1.60');
  });

  it('gives the warning to a Viewer, in the list and in the machine', async () => {
    const { body } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'none' });

    expect((await machine(body.id, viewerCookie)).opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    expect((await listed(body.id, viewerCookie))?.opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
  });

  it('gives the warning in the live status update', async () => {
    const updates: BaseMachineStatus[][] = [];
    poller.on('update', (machines: BaseMachineStatus[]) => updates.push(machines));

    const { body } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'none' });

    const live = updates.at(-1)?.find(m => m.id === body.id) as MachineReply | undefined;
    expect(live?.opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
  });

  it('does not warn for a password with no username, because Chatter then logs in with no login', async () => {
    const { body } = await add({ opcuaPassword: 'secret', opcuaSecurity: 'none' });

    expect(body.hasOpcuaPassword).toBe(true);
    expect(body).not.toHaveProperty('opcuaSecurityWarning');
    expect(logWarnings()).toHaveLength(0);
  });

  it('does not warn for a username of only spaces, and saves no username', async () => {
    const { body } = await add({ opcuaUser: '   ', opcuaPassword: 'secret', opcuaSecurity: 'none' });

    expect(body).not.toHaveProperty('opcuaSecurityWarning');
    expect(saved(body.id).opcua_user).toBe('');
    expect(logWarnings()).toHaveLength(0);
  });

  it('stops the warning after a change to a username of only spaces', async () => {
    const { body: added } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'none' });

    const { body } = await update(added.id, { opcuaUser: '  ' });

    expect(body).not.toHaveProperty('opcuaSecurityWarning');
    expect(saved(added.id).opcua_user).toBe('');
  });

  it('does not warn for a new machine with a login and Sign and encrypt', async () => {
    const { body } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'signAndEncrypt' });
    expect(body).not.toHaveProperty('opcuaSecurityWarning');
    expect(logWarnings()).toHaveLength(0);
  });

  it('does not warn for a new anonymous machine with Security None', async () => {
    const { body } = await add({});
    expect(body.opcuaSecurity).toBe('none');
    expect(body).not.toHaveProperty('opcuaSecurityWarning');
    expect(logWarnings()).toHaveLength(0);
  });

  it('saves a change from Sign and encrypt to None on a machine with a saved password, and the reply warns', async () => {
    const { body: added } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'signAndEncrypt' });

    const { status, body } = await update(added.id, { opcuaSecurity: 'none' });

    expect(status).toBe(200);
    expect(body.hasOpcuaPassword).toBe(true);
    expect(body.opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    expect(savedSecurity(added.id)).toBe('none');
    expect((await machine(added.id)).opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    expect(logWarnings()).toHaveLength(1);
    expect(logWarnings()[0].text).toContain(added.id);
  });

  it('warns when a change adds a login to an anonymous machine with Security None', async () => {
    const { body: added } = await add({});
    const { body } = await update(added.id, { opcuaUser: 'OpcUaClient', opcuaPassword: 'secret' });
    expect(body.opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    expect(logWarnings()).toHaveLength(1);
  });

  it('stops the warning after a change from None to Sign and encrypt', async () => {
    const { body: added } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'none' });

    const { body } = await update(added.id, { opcuaSecurity: 'signAndEncrypt' });

    expect(body).not.toHaveProperty('opcuaSecurityWarning');
    expect(await machine(added.id)).not.toHaveProperty('opcuaSecurityWarning');
  });

  it('keeps the warning, with no new log line, after a change of a different setting', async () => {
    const { body: added } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'none' });

    const { body } = await update(added.id, { name: 'DMU 2' });

    expect(body.opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    expect(logWarnings()).toHaveLength(1);
  });

  it('keeps the warning, with no new log line and no password in the log, after a change of only the password', async () => {
    const { body: added } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'none' });

    const { status, body } = await update(added.id, { opcuaPassword: 'new-secret' });

    expect(status).toBe(200);
    expect(body.opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    expect(logWarnings()).toHaveLength(1);
    expect(log.text()).not.toContain('new-secret');
  });

  it('writes no warning for a change that it refuses and does not save', async () => {
    const { body: added } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'signAndEncrypt' });

    // A new address needs the password again, so the server refuses the change and saves nothing
    const { status } = await update(added.id, { host: '192.168.1.61', opcuaSecurity: 'none' });

    expect(status).toBe(400);
    expect(savedSecurity(added.id)).toBe('signAndEncrypt');
    expect(logWarnings()).toHaveLength(0);
    expect(await machine(added.id)).not.toHaveProperty('opcuaSecurityWarning');
  });

  it('warns after a restart of Chatter, from the saved settings, with no new log line', async () => {
    const { body: added } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'none' });
    poller.stop();
    poller = new HardwarePoller(db);
    await poller.loadFromDatabase();

    expect((await machine(added.id)).opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    // Only the line of the add. A restart does not write the warning again (the status still gives it).
    expect(logWarnings()).toHaveLength(1);
  });
});
