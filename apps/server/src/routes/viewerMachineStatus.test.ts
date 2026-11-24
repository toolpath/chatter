import net from 'node:net';
import Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@local-chatter/shared';
import type { Auth } from '../auth/Auth.js';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import type { ConnectionHealth } from '../logging/ConnectionLog.js';
import { HardwarePoller } from '../polling/poller.js';
import { applySchema } from '../storage/schema.js';
import { testApp, type TestApp } from './testSupport.js';

/** A port on this computer where nothing listens, so each poll fails at once with the address in its error */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise(resolve => server.close(resolve));
  return port;
}

const HOST = '127.0.0.1';
const FTP_USER = 'zq-ftp-user';
const OPCUA_USER = 'zq-opcua-user';
/** The keys of the connection settings. None of them goes to a Viewer (D4). */
const SETTING_KEYS = [
  'host', 'dataPort', 'queryPort', 'ftpPort', 'ftpUser', 'hasFtpPassword', 'opcuaPort', 'opcuaUser', 'hasOpcuaPassword',
  'opcuaSecurity', 'opcuaServerThumbprint',
];

/** What a Viewer must never see of the seeded machines */
function expectNoSettings(text: string, port: number, what: string): void {
  for (const secret of [HOST, `:${port}`, FTP_USER, OPCUA_USER, ...SETTING_KEYS.map(key => `"${key}"`)]) {
    expect(text, `${what} has ${secret}`).not.toContain(secret);
  }
}

/** The first chunks of a live stream, until it has this text, then close it */
async function readStreamUntil(res: Response, needle: string): Promise<string> {
  const reader = res.body!.getReader();
  let text = '';
  try {
    while (!text.includes(needle)) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
  } finally {
    await reader.cancel();
  }
  return text;
}

// Decision D4: a Viewer sees the machines, but not their connection settings
describe('the machine status that a Viewer gets', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  let adminCookie: string;
  const cookies = {} as Record<Exclude<Role, 'admin'>, string>;
  let db: Database.Database;
  let poller: HardwarePoller;
  let port: number;
  let brotherId: string;
  let siemensId: string;

  beforeAll(async () => {
    ({ auth, accounts, cookie: adminCookie } = await loggedInAuth());
    for (const role of ['viewer', 'operator'] as const) {
      const login = { username: role, password: 'test-password' };
      await accounts.add({ ...login, role });
      // Not the address of the machine, so the login list of the account does not have it
      cookies[role] = `${SESSION_COOKIE}=${await auth.logIn(login, { userAgent: 'test browser', address: '198.51.100.5' })}`;
    }
  });

  beforeEach(async () => {
    db = new Database(':memory:');
    applySchema(db);
    poller = new HardwarePoller(db);
    port = await closedPort();
    brotherId = (await poller.addMachine({
      type: 'brother', name: 'Speedio', host: HOST, dataPort: port, ftpPort: port, ftpUser: FTP_USER, ftpPassword: 'ftp-secret',
    })).id;
    siemensId = (await poller.addMachine({
      type: 'siemens', name: 'DMU', host: HOST, opcuaPort: port, opcuaUser: OPCUA_USER, opcuaPassword: 'opcua-secret',
      opcuaSecurity: 'none', ftpUser: FTP_USER,
    })).id;
    // The error of the poll has the address, so the test shows that the Viewer gets it without the address
    await poller.poll();
    expect(poller.getMachine(brotherId)?.errors.join(' ')).toContain(`${HOST}:${port}`);
  });

  afterEach(() => poller.stop());

  const connections = {
    // The connection log of each machine tells its own address and username
    health: (id: string): ConnectionHealth => ({
      offlineSince: null,
      lastError: { text: `connect ECONNREFUSED ${HOST}:${port}`, time: '2026-11-23T10:00:00.000Z' },
      events: [{ time: '2026-11-23T10:00:00.000Z', text: `Machine went offline: login of ${id === siemensId ? OPCUA_USER : FTP_USER} at ${HOST}`, tone: 'bad' }],
    }),
  };
  const app = (): TestApp => testApp({ auth, accounts, poller, connections });
  const get = (path: string, cookie: string) => app().request(path, { headers: { Cookie: cookie } });

  it('has no connection setting, no address and no username in any GET route that a Viewer can read', async () => {
    const paths = new Set(app().routes.filter(route => route.method === 'GET' && route.path.startsWith('/api/')).map(route => route.path));
    let read = 0;
    for (const routePath of paths) {
      const url = routePath.replace(':id', siemensId).replace(/:\w+/g, '1');
      for (const id of [siemensId, brotherId]) {
        const res = await get(url.replace(siemensId, id), cookies.viewer);
        if (res.status === 403) {
          await res.body?.cancel();
          continue;
        }
        read++;
        const live = res.headers.get('content-type')?.includes('text/event-stream');
        const text = live ? await readStreamUntil(res, 'event:') : await res.text();
        expectNoSettings(text, port, `${routePath} (${id})`);
      }
    }
    // The walk read the routes of the machine status: the list, the machine, the health and the live events, at least
    expect(read).toBeGreaterThanOrEqual(8);
  });

  it('gives a Viewer the machine with its state, its data and its errors, with "the machine address" in place of the address', async () => {
    const listed = (await (await get('/api/machines', cookies.viewer)).json()) as Record<string, unknown>[];
    const brother = listed.find(machine => machine.id === brotherId)!;

    expect(brother).toMatchObject({ id: brotherId, name: 'Speedio', type: 'brother', connected: false });
    expect(brother.data).toBeTypeOf('object');
    expect((brother.errors as string[]).join(' ')).toContain('the machine address');
    for (const key of SETTING_KEYS) expect(brother).not.toHaveProperty(key);
  });

  it('gives a Viewer the health of the machine with no address and no username in its texts', async () => {
    const text = await (await get(`/api/machine/${siemensId}/health`, cookies.viewer)).text();
    expect(text).toContain('connect ECONNREFUSED the machine address');
    expect(text).toContain('login of the user at the machine address');
  });

  it('gives a Viewer the security warning of a Siemens machine', async () => {
    const machine = (await (await get(`/api/machine/${siemensId}`, cookies.viewer)).json()) as Record<string, unknown>;
    expect(machine.opcuaSecurityWarning).toMatch(/^Security is None\./);
    expect(machine).not.toHaveProperty('opcuaUser');
  });

  it('sends no setting to a Viewer in a live change of a machine', async () => {
    const res = await get('/api/events', cookies.viewer);
    const reader = res.body!.getReader();
    let text = '';
    try {
      // The first event is the list. Then a change of the machine comes as one event.
      while (!text.includes('event:')) text += new TextDecoder().decode((await reader.read()).value);
      await poller.updateMachine(siemensId, { name: 'DMU 2' });
      while (!text.includes('DMU 2')) text += new TextDecoder().decode((await reader.read()).value);
    } finally {
      await reader.cancel();
    }
    expectNoSettings(text, port, 'the live events');
  });

  it.each(['operator', 'admin'] as const)('gives an %s the connection settings, as before', async role => {
    const cookie = role === 'admin' ? adminCookie : cookies[role];
    const machine = (await (await get(`/api/machine/${siemensId}`, cookie)).json()) as Record<string, unknown>;
    expect(machine).toMatchObject({ host: HOST, opcuaPort: port, opcuaUser: OPCUA_USER, hasOpcuaPassword: true, opcuaSecurity: 'none' });
    const text = await (await get(`/api/machine/${siemensId}/health`, cookie)).text();
    expect(text).toContain(`${HOST}:${port}`);
    const events = await readStreamUntil(await get('/api/events', cookie), 'event:');
    expect(events).toContain(OPCUA_USER);
  });
});
