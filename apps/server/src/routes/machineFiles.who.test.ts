import Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../auth/Auth.js';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { ProxySettings } from '../auth/proxySettings.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import { captureAudit, captureLog, type CapturedAudit, type CapturedLog } from '../logging/testSupport.js';
import { HardwarePoller } from '../polling/poller.js';
import { closeDatabase, getDb, initDatabase } from '../storage/database.js';
import { applySchema } from '../storage/schema.js';
import { testApp, type TestApp } from './testSupport.js';

// Who sent or deleted a program (F-07 of the security review): the upload history and the audit log tell it.

/** A port where nothing listens, so each poll fails at once */
const CLOSED_PORT = 1;
const PROXY = '127.0.0.1';
/** What the Node server gives each request: here, a connection from the proxy */
const fromProxy = { incoming: { socket: { remoteAddress: PROXY } } };
const COMPUTER = '192.168.1.20';

describe('who sent or deleted a program', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  let operatorCookie: string;
  let poller: HardwarePoller;
  let connector: BaseMachineConnector;
  let machineId: string;
  let app: TestApp;
  let audit: CapturedAudit;
  let log: CapturedLog;

  beforeAll(async () => {
    ({ auth, accounts } = await loggedInAuth());
    const login = { username: 'olga', password: 'test-password' };
    await accounts.add({ ...login, role: 'operator' });
    operatorCookie = `${SESSION_COOKIE}=${await auth.logIn(login, { userAgent: 'test browser', address: '127.0.0.1' })}`;
  });

  beforeEach(async () => {
    process.env.DATABASE_PATH = ':memory:';
    await initDatabase();
    const machines = new Database(':memory:');
    applySchema(machines);
    poller = new HardwarePoller(machines);
    machineId = (await poller.addMachine({ type: 'brother', name: 'Speedio', host: '127.0.0.1', dataPort: CLOSED_PORT })).id;
    connector = poller.getConnector(machineId)!;
    vi.spyOn(connector, 'uploadFile').mockResolvedValue(undefined);
    vi.spyOn(connector, 'uploadFiles').mockImplementation(async files => ({ success: files.map(({ remotePath }) => ({ remotePath })), failed: [] }));
    vi.spyOn(connector, 'deleteFile').mockResolvedValue(undefined);
    app = testApp({ auth, accounts, poller, proxySettings: ProxySettings.inMemory(PROXY) });
    audit = captureAudit();
    log = captureLog();
  });

  afterEach(async () => {
    log.restore();
    audit.restore();
    poller.stop();
    vi.restoreAllMocks();
    await closeDatabase();
  });

  /** A request that the proxy sends on for the computer COMPUTER, as the Operator olga */
  const send = (method: string, path: string, body?: FormData) => app.request(path, {
    method,
    headers: { Cookie: operatorCookie, 'X-Forwarded-For': COMPUTER },
    ...(body ? { body } : {}),
  }, fromProxy);
  const changeLines = () => audit.lines.filter(line => line.includes('[audit] Change'));
  const rows = () => getDb().prepare('SELECT target_name, remote_path, action, uploaded_by, address FROM upload_events ORDER BY id').all();

  function uploadForm(path: string): FormData {
    const form = new FormData();
    form.append('file', new File(['O1000\nM30\n'], 'part.nc'));
    form.append('path', path);
    return form;
  }

  describe('a send', () => {
    it('records the user and the address of the computer behind the proxy', async () => {
      const res = await send('POST', `/api/machine/${machineId}/files/upload`, uploadForm('/PRG/O1000.NC'));

      expect(res.status).toBe(200);
      expect(rows()).toEqual([{ target_name: 'part.nc', remote_path: '/PRG/O1000.NC', action: 'sent', uploaded_by: 'olga', address: COMPUTER }]);
    });

    it('records the user and the address for each file of a batch', async () => {
      const form = new FormData();
      form.append('files', new File(['O1000\nM30\n'], 'O1000.NC'));
      form.append('files', new File(['O2000\nM30\n'], 'O2000.NC'));
      form.append('basePath', '/PRG');

      const res = await send('POST', `/api/machine/${machineId}/files/upload-batch`, form);

      expect(res.status).toBe(200);
      expect(rows()).toEqual([
        { target_name: 'O1000.NC', remote_path: '/PRG/O1000.NC', action: 'sent', uploaded_by: 'olga', address: COMPUTER },
        { target_name: 'O2000.NC', remote_path: '/PRG/O2000.NC', action: 'sent', uploaded_by: 'olga', address: COMPUTER },
      ]);
    });
  });

  describe('a delete', () => {
    const deletePath = (path: string) => `/api/machine/${machineId}/files?path=${encodeURIComponent(path)}`;

    it('writes the name of the deleted file in the audit line', async () => {
      const res = await send('DELETE', deletePath('/PRG/O1000.NC'));

      expect(res.status).toBe(200);
      expect(changeLines()).toEqual([
        expect.stringMatching(new RegExp(` Change user=olga role=operator method=DELETE route=/api/machine/:id/files status=200 address=192\\.168\\.1\\.20 id=${machineId} file=O1000\\.NC$`)),
      ]);
    });

    it('writes the name of the file also when the machine refuses the delete', async () => {
      vi.mocked(connector.deleteFile).mockRejectedValue(new Error('550 File is in use'));

      const res = await send('DELETE', deletePath('/PRG/O1000.NC'));

      expect(res.status).not.toBe(200);
      expect(changeLines()).toEqual([expect.stringMatching(new RegExp(` status=${res.status} .* file=O1000\\.NC$`))]);
    });

    it('cuts a long file name to 64 characters and marks the cut, as the path parameters', async () => {
      const res = await send('DELETE', deletePath(`/PRG/${'a'.repeat(64)}${'b'.repeat(500)}.NC`));

      expect(res.status).toBe(200);
      expect(changeLines()).toEqual([expect.stringMatching(/ file=a{64}…$/)]);
    });

    it('keeps a file name with a space or an equals sign as one value, so it cannot add a false detail', async () => {
      const res = await send('DELETE', deletePath('/PRG/O1 user=admin.NC'));

      expect(res.status).toBe(200);
      expect(changeLines()).toEqual([expect.stringMatching(/ user=olga .* file="O1 user=admin\.NC"$/)]);
    });

    // A "deleted" row would show in the upload history of the web app as a version with no text, and "Send it again"
    // would send an empty file. So the audit log alone records a delete.
    it('adds no row to the upload history', async () => {
      await send('POST', `/api/machine/${machineId}/files/upload`, uploadForm('/PRG/O1000.NC'));

      expect((await send('DELETE', deletePath('/PRG/O1000.NC'))).status).toBe(200);

      expect(rows()).toEqual([expect.objectContaining({ action: 'sent', remote_path: '/PRG/O1000.NC' })]);
    });
  });
});
