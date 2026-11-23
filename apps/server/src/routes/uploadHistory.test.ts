import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@local-chatter/shared';
import type { Auth } from '../auth/Auth.js';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { closeDatabase, getUploadEvents, getUploadFiles, initDatabase, recordUpload } from '../storage/database.js';
import { testApp, type TestApp } from './testSupport.js';

const PROGRAM_TEXT = 'G00 X0';
const SENDER = { username: 'sender-ann', address: '192.168.1.20' };
const SENDER_AGAIN = { username: 'sender-bob', address: '192.168.1.30' };

// The real upload database, so that a new column in a list query shows here
describe('upload history routes', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  const cookies = {} as Record<Role, string>;
  let app: TestApp;

  beforeAll(async () => {
    let adminCookie: string;
    ({ auth, accounts, cookie: adminCookie } = await loggedInAuth());
    cookies.admin = adminCookie;
    for (const role of ['viewer', 'operator'] as const) {
      const login = { username: role, password: 'test-password' };
      await accounts.add({ ...login, role });
      cookies[role] = `${SESSION_COOKIE}=${await auth.logIn(login, { userAgent: 'test browser', address: '127.0.0.1' })}`;
    }
  });

  beforeEach(async () => {
    process.env.DATABASE_PATH = ':memory:';
    await initDatabase();
    await recordUpload('m1', 'part.nc', 'O1000.NC', '/PRG/O1000.NC', PROGRAM_TEXT, SENDER);
    await recordUpload('m1', 'part.nc', 'O1000.NC', '/PRG/O1000.NC', `${PROGRAM_TEXT}\nM30`, SENDER_AGAIN);
    app = testApp({ auth, accounts });
  });

  afterEach(async () => {
    await closeDatabase();
  });

  const as = (role: Role, path: string) => app.request(path, { headers: { Cookie: cookies[role] } });
  const eventsPath = async () => `/api/machine/m1/uploads/${(await getUploadFiles('m1'))[0].id}/events`;
  const sentEventPath = async () => {
    const [newest] = await getUploadEvents('m1', (await getUploadFiles('m1'))[0].id);
    return `/api/machine/m1/uploads/events/${newest.id}`;
  };

  describe('for a Viewer', () => {
    /** The text, and the stored (gzip) content, are not in the reply */
    function expectNoProgramText(text: string) {
      expect(text).not.toContain(PROGRAM_TEXT);
      expect(text).not.toContain('file_content');
    }

    it('gives the names and dates of the sent files, but not the program text', async () => {
      const res = await as('viewer', '/api/machine/m1/uploads');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('part.nc');
      expectNoProgramText(text);
    });

    it('gives the versions of a sent file, but not the program text', async () => {
      const res = await as('viewer', await eventsPath());
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('/PRG/O1000.NC');
      expectNoProgramText(text);
    });

    // Decision D4: a Viewer does not see who sent a program
    it('gives the action of each version, but not who did it or the address', async () => {
      const res = await as('viewer', await eventsPath());

      const events = (await res.json()) as object[];
      expect(events.map(event => Object.keys(event).sort())).toEqual([
        ['action', 'id', 'remote_path', 'target_name', 'uploaded_at'],
        ['action', 'id', 'remote_path', 'target_name', 'uploaded_at'],
      ]);
      const text = JSON.stringify(events);
      for (const hidden of ['sender-ann', 'sender-bob', '192.168.1.']) expect(text).not.toContain(hidden);
    });
  });

  describe('for an Operator', () => {
    it('gives who sent each version, but not the address', async () => {
      const res = await as('operator', await eventsPath());

      expect(res.status).toBe(200);
      const events = await res.json();
      expect(events).toEqual([
        expect.objectContaining({ action: 'sent', uploaded_by: 'sender-bob' }),
        expect.objectContaining({ action: 'sent', uploaded_by: 'sender-ann' }),
      ]);
      expect(JSON.stringify(events)).not.toContain('192.168.1.');
    });

    it('gives the program text and who sent it, but not the address, for one send', async () => {
      const res = await as('operator', await sentEventPath());

      expect(res.status).toBe(200);
      const event = await res.json();
      expect(event).toMatchObject({ file_content: `${PROGRAM_TEXT}\nM30`, uploaded_by: 'sender-bob', action: 'sent' });
      expect(event).not.toHaveProperty('address');
    });
  });

  describe('for an Admin', () => {
    it('gives who sent each version, and the address', async () => {
      const res = await as('admin', await eventsPath());

      expect(await res.json()).toEqual([
        expect.objectContaining({ uploaded_by: 'sender-bob', address: '192.168.1.30' }),
        expect.objectContaining({ uploaded_by: 'sender-ann', address: '192.168.1.20' }),
      ]);
    });

    it('gives the address for one send', async () => {
      const res = await as('admin', await sentEventPath());

      expect(await res.json()).toMatchObject({ uploaded_by: 'sender-bob', address: '192.168.1.30' });
    });
  });
});
