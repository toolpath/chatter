import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { gunzipSync } from 'zlib';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { Auth } from '../auth/Auth.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { ConnectionLog } from '../logging/ConnectionLog.js';
import { configureLogging, createLogger } from '../logging/logger.js';
import { LogFile } from '../logging/LogFile.js';
import { ServerLog } from '../logging/ServerLog.js';
import { Notifications } from '../notifications/Notifications.js';
import { HardwarePoller } from '../polling/poller.js';
import { applySchema } from '../storage/schema.js';
import { UpdateFolder } from '../updates/UpdateFolder.js';
import { UpdateService } from '../updates/UpdateService.js';
import { offlineReleases } from '../updates/testSupport.js';
import { testApp } from './testSupport.js';

/** The secrets of the test. None of them may be anywhere in the bundle. */
const SECRETS = ['ftp-secret-1', 'opcua-secret-2', 'hook-secret-3', 'ntfy-token-4', 'shop-topic-5', 'tg-bot-6', 'logged-pw-7', 'hooks.example.test'];

/** The files of a tar, by name */
function untar(tar: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, ''), 8);
    files.set(name, tar.subarray(offset + 512, offset + 512 + size).toString('utf8'));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

describe('GET /support-bundle', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  let cookie: string;
  let operatorCookie: string;
  let folder: string;
  let serverLog: ServerLog;
  let stopListening: () => void;
  let restoreLogging: () => void;

  beforeAll(async () => {
    ({ auth, accounts, cookie } = await loggedInAuth());
    const login = { username: 'operator', password: 'test-password' };
    await accounts.add({ ...login, role: 'operator' });
    operatorCookie = `${SESSION_COOKIE}=${await auth.logIn(login, { userAgent: 'test browser', address: '127.0.0.1' })}`;
  });

  let healthServer: Server;
  let healthUrl: string;
  let closedPort: number;

  beforeAll(async () => {
    healthServer = createServer((_request, response) => response.end('OK'));
    await new Promise<void>(resolve => healthServer.listen(0, '127.0.0.1', resolve));
    healthUrl = `http://127.0.0.1:${(healthServer.address() as AddressInfo).port}`;
    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
    closedPort = (closed.address() as AddressInfo).port;
    await new Promise(resolve => closed.close(resolve));
  });

  afterAll(() => new Promise<void>(resolve => healthServer.close(() => resolve())));

  beforeEach(() => {
    folder = mkdtempSync(path.join(os.tmpdir(), 'support-bundle-'));
    const old = configureLogging({ level: 'info', format: 'text', sink: () => {} });
    restoreLogging = () => configureLogging(old);
    serverLog = new ServerLog(new LogFile(path.join(folder, 'logs', 'chatter.log')));
    stopListening = serverLog.listen();
  });

  afterEach(async () => {
    stopListening();
    restoreLogging();
    await serverLog.file?.close();
    rmSync(folder, { recursive: true, force: true });
  });

  async function appWithSecrets() {
    const db = new Database(':memory:');
    applySchema(db);
    const poller = new HardwarePoller(db);
    await poller.addMachine({ type: 'brother', name: 'Speedio', host: '10.0.0.5', ftpPassword: 'ftp-secret-1' });
    await poller.addMachine({ type: 'siemens', name: 'DMU', host: '10.0.0.6', opcuaUser: 'op', opcuaPassword: 'opcua-secret-2' });
    const notifications = Notifications.inMemory();
    const now = Date.now();
    notifications.channels.add({
      type: 'webhook', name: 'Slack', values: { url: 'https://hooks.example.test/T0/B0/x', secret: 'hook-secret-3' },
      minSeverity: 'warning', machineIds: null, enabled: true,
    }, now);
    notifications.channels.add({
      type: 'ntfy', name: 'Phones', values: { topic: 'shop-topic-5', token: 'ntfy-token-4' },
      minSeverity: 'warning', machineIds: null, enabled: true,
    }, now);
    const log = createLogger('notifications');
    log.warn('Send failed', { url: 'https://api.telegram.org/bot987654:tg-bot-6/sendMessage', password: 'logged-pw-7' });
    log.error('Send failed: POST https://api.telegram.org/bot123:tg-bot-6/sendMessage gave 429');
    createLogger('machines').child({ machine: 'm1' }).warn('Machine went offline', { reason: 'Poll failed: timeout' });

    const updateFolder = path.join(folder, 'update');
    mkdirSync(path.join(updateFolder, 'inbox'), { recursive: true });
    writeFileSync(path.join(updateFolder, 'helper.json'), '{"arch":"armv7","capabilities":["reboot","network","log"]}');
    writeFileSync(path.join(updateFolder, 'helper.log'), '2026-11-21T10:00:00Z [request] Step: copying.\n');
    return testApp({
      auth, accounts, poller, notifications, serverLog, connections: new ConnectionLog(), version: '1.2.0',
      updates: new UpdateService(new UpdateFolder(updateFolder), '1.2.0', offlineReleases()),
      historyHealthUrls: { victoriaMetrics: `${healthUrl}/health`, vmalert: `http://127.0.0.1:${closedPort}/health` },
      system: { isInDocker: true },
    });
  }

  it('only an admin can download it', async () => {
    const app = await appWithSecrets();
    expect((await app.request('/api/support-bundle', { headers: { Cookie: operatorCookie } })).status).toBe(403);
  });

  it('is a .tar.gz with the facts of Chatter, and no secret anywhere', async () => {
    const app = await appWithSecrets();
    const res = await app.request('/api/support-bundle', { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/gzip');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="chatter-support-[0-9T-]+Z\.tar\.gz"$/);
    const tar = gunzipSync(Buffer.from(await res.arrayBuffer()));
    const raw = tar.toString('utf8');
    for (const secret of SECRETS) expect(raw, secret).not.toContain(secret);

    const files = untar(tar);
    expect([...files.keys()]).toEqual([
      'README.txt', 'system.json', 'machines.json', 'notifications.json', 'history-health.json',
      'update/status.json', 'update/helper.json', 'update/network.json', 'update/helper.log',
      'log/recent.log', 'log/chatter.log.1', 'log/chatter.log',
    ].filter(name => name !== 'log/chatter.log.1'));

    const system = JSON.parse(files.get('system.json')!);
    expect(system).toMatchObject({ version: '1.2.0', uptimeSeconds: expect.any(Number), memory: { rssBytes: expect.any(Number) } });

    const machines = JSON.parse(files.get('machines.json')!) as Record<string, unknown>[];
    expect(machines.map(machine => machine.name)).toEqual(['Speedio', 'DMU']);
    expect(machines[0]).toMatchObject({ host: '10.0.0.5', hasFtpPassword: true, health: { events: [] } });
    expect(machines[1]).toMatchObject({ opcuaUser: 'op', hasOpcuaPassword: true });

    const notifications = JSON.parse(files.get('notifications.json')!);
    expect(notifications.channels).toEqual([
      expect.objectContaining({ type: 'webhook', name: 'Slack', savedSecrets: ['secret'] }),
      expect.objectContaining({ type: 'ntfy', name: 'Phones', savedSecrets: ['token'] }),
    ]);
    expect(notifications.channels[0]).not.toHaveProperty('settings');

    const health = JSON.parse(files.get('history-health.json')!);
    expect(health.victoriaMetrics).toEqual({ url: `${healthUrl}/health`, status: 200, reply: 'OK' });
    expect(health.vmalert).toMatchObject({ error: expect.any(String) });

    expect(files.get('update/helper.log')).toContain('Step: copying.');
    expect(files.get('log/recent.log')).toContain('Machine went offline machine=m1');
    expect(files.get('log/recent.log')).toContain('gave 429');
    expect(files.get('log/chatter.log')).toContain('Machine went offline');
  });

  it('has the audit log files, the old one first, so an Admin can read who changed what', async () => {
    const auditPath = path.join(folder, 'logs', 'audit.log');
    mkdirSync(path.dirname(auditPath), { recursive: true });
    writeFileSync(`${auditPath}.1`, 'INFO  [audit] Change user=ann role=operator method=DELETE\n');
    writeFileSync(auditPath, 'INFO  [audit] Password try username=bob result=no-such-user\n');
    stopListening();
    await serverLog.file?.close();
    serverLog = new ServerLog(new LogFile(path.join(folder, 'logs', 'chatter.log')), undefined, undefined, new LogFile(auditPath));
    stopListening = serverLog.listen();
    const app = await appWithSecrets();

    const res = await app.request('/api/support-bundle', { headers: { Cookie: cookie } });

    const files = untar(gunzipSync(Buffer.from(await res.arrayBuffer())));
    expect([...files.keys()].filter(name => name.startsWith('log/audit'))).toEqual(['log/audit.log.1', 'log/audit.log']);
    expect(files.get('log/audit.log.1')).toContain('method=DELETE');
    expect(files.get('log/audit.log')).toContain('username=bob result=no-such-user');
    expect(files.get('README.txt')).toContain('audit');
  });
});
