import Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OPCUA_NO_ENCRYPTION_WARNING } from '@local-chatter/shared';
import { loggedInAuth } from '../auth/testSupport.js';
import type { Auth } from '../auth/Auth.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { captureLog, type CapturedLog } from '../logging/testSupport.js';
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
  let db: Database.Database;
  let poller: HardwarePoller;
  let log: CapturedLog;

  beforeAll(async () => {
    ({ auth, accounts, cookie } = await loggedInAuth());
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
  const machine = async (id: string) =>
    (await (await app().request(`/api/machine/${id}`, { headers: { Cookie: cookie } })).json()) as MachineReply;
  const listed = async (id: string) =>
    ((await (await app().request('/api/machines', { headers: { Cookie: cookie } })).json()) as MachineReply[]).find(m => m.id === id);
  const savedSecurity = (id: string) =>
    (db.prepare('SELECT opcua_security FROM siemens_machines WHERE id = ?').get(id) as { opcua_security: string }).opcua_security;
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

  it('warns after a restart of Chatter, from the saved settings', async () => {
    const { body: added } = await add({ opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'none' });
    poller.stop();
    poller = new HardwarePoller(db);
    await poller.loadFromDatabase();

    expect((await machine(added.id)).opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
  });
});
