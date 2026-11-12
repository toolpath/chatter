import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELPER_SILENCE_LIMIT_MS, UPDATE_FILE_LIMIT_BYTES, type Role } from '@local-chatter/shared';
import { loggedInAuth } from '../auth/testSupport.js';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import type { Auth } from '../auth/Auth.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { REQUEST_FILE_NAME, UPDATE_FILE_NAME, UpdateFolder } from '../updates/UpdateFolder.js';
import { UpdateService } from '../updates/UpdateService.js';
import { ReleaseWatcher } from '../updates/ReleaseWatcher.js';
import { offlineReleases } from '../updates/testSupport.js';
import { errorOf, testApp, type TestApp } from './testSupport.js';
import { captureLog, type CapturedLog } from '../logging/testSupport.js';

/** The free space that an update must leave on the card */
const SPARE_BYTES = 200 * 1024 * 1024;

/** An update folder on a card with this much free space */
class CardFolder extends UpdateFolder {
  constructor(folder: string, private readonly free = 10 * UPDATE_FILE_LIMIT_BYTES) {
    super(folder);
  }

  override async freeBytes(): Promise<number> {
    return this.free;
  }
}

/** A request body that the test can hold open, and then end or break */
function heldStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: c => void (controller = c) });
  return {
    stream,
    send: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    end: () => controller.close(),
    break: () => controller.error(new Error('the browser went away')),
  };
}

describe('update routes', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  let cookie: string;
  let root: string;
  let inbox: string;
  let log: CapturedLog;

  const roleCookies: Partial<Record<Role, string>> = {};

  beforeAll(async () => {
    ({ auth, accounts, cookie } = await loggedInAuth());
    for (const role of ['viewer', 'operator'] as const) {
      const login = { username: role, password: 'test-password' };
      await accounts.add({ ...login, role });
      roleCookies[role] = `${SESSION_COOKIE}=${await auth.logIn(login, { userAgent: 'test browser', address: '127.0.0.1' })}`;
    }
  });

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'update-routes-'));
    inbox = path.join(root, 'inbox');
    mkdirSync(inbox);
    writeFileSync(path.join(root, 'helper.json'), '{"arch":"armv7"}');
    log = captureLog();
  });

  afterEach(() => {
    log.restore();
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  interface AppOptions {
    folder?: UpdateFolder;
    version?: string;
    releases?: ReleaseWatcher;
    idleMs?: number;
  }

  function appWith({ folder = new CardFolder(root), version = '1.2.0', releases = offlineReleases(), idleMs }: AppOptions = {}) {
    const updates = new UpdateService(folder, version, releases, idleMs);
    return testApp({ auth, accounts, updates });
  }

  /** Upload a file as the raw body, as the web app does */
  function upload(app: TestApp, body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
    const length = typeof body === 'string' ? { 'Content-Length': String(Buffer.byteLength(body)) } : {};
    return app.request('/api/updates/file', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream', ...length, ...headers },
      body,
      duplex: 'half',
    } as RequestInit);
  }

  const inboxNames = () => readdirSync(inbox);
  /** The status that the helper wrote */
  const writeStatus = (state: string, heartbeat = new Date().toISOString()) =>
    writeFileSync(path.join(root, 'status.json'), JSON.stringify({ state, version: '1.3.0', heartbeat, freeBytes: 1000 }));

  describe('roles', () => {
    /** Each update route, sent the way the web app sends it: no body, a raw file, or JSON */
    const ROUTES: Array<{ method: string; path: string; headers?: Record<string, string>; body?: string }> = [
      { method: 'GET', path: '/api/updates/status' },
      { method: 'POST', path: '/api/updates/file', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '11' }, body: 'update file' },
      { method: 'POST', path: '/api/updates/download' },
      { method: 'PUT', path: '/api/updates/settings', headers: { 'Content-Type': 'application/json' }, body: '{"checkGitHub":false}' },
      { method: 'POST', path: '/api/updates/check' },
      { method: 'POST', path: '/api/updates/install' },
    ];

    for (const role of ['viewer', 'operator'] as const) {
      it(`refuses every update route to the ${role} role, and changes nothing`, async () => {
        writeFileSync(path.join(inbox, UPDATE_FILE_NAME), 'update file');
        const app = appWith();

        for (const route of ROUTES) {
          const res = await app.request(route.path, {
            method: route.method,
            headers: { Cookie: roleCookies[role]!, ...route.headers },
            body: route.body,
          });
          expect(res.status, `${route.method} ${route.path}`).toBe(403);
        }
        expect(inboxNames()).toEqual([UPDATE_FILE_NAME]);
      });
    }
  });

  describe('GET /updates/status', () => {
    it('needs a login', async () => {
      expect((await appWith().request('/api/updates/status')).status).toBe(401);
    });

    it('tells the version, the helper, and the free space', async () => {
      const res = await appWith().request('/api/updates/status', { headers: { Cookie: cookie } });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        version: '1.2.0',
        canUpdate: true,
        helper: { arch: 'armv7' },
        status: null,
        freeBytes: 10 * UPDATE_FILE_LIMIT_BYTES,
        isReceiving: false,
        hasUpdateFile: false,
        isRequestPending: false,
        newest: { checkGitHub: true, version: null, error: null, checkedAt: null, isNewer: false },
        downloadError: null,
      });
    });

    it('says that a development build cannot update', async () => {
      const res = await appWith({ version: 'edge-1a2b3c4' }).request('/api/updates/status', { headers: { Cookie: cookie } });
      expect(await res.json()).toMatchObject({ version: 'edge-1a2b3c4', canUpdate: false });
    });

    it('finds no helper on a normal computer', async () => {
      const app = appWith({ folder: new UpdateFolder(path.join(root, 'missing')) });
      const res = await app.request('/api/updates/status', { headers: { Cookie: cookie } });
      expect(await res.json()).toMatchObject({ helper: null, freeBytes: null });
    });
  });

  describe('POST /updates/file', () => {
    it('needs a login', async () => {
      const res = await appWith().request('/api/updates/file', { method: 'POST', body: 'x' });
      expect(res.status).toBe(401);
    });

    it('saves the whole file under the name that the helper looks for', async () => {
      const res = await upload(appWith(), 'update file');

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ isReceiving: false, hasUpdateFile: true });
      expect(inboxNames()).toEqual([UPDATE_FILE_NAME]);
      expect(readFileSync(path.join(inbox, UPDATE_FILE_NAME), 'utf8')).toBe('update file');
    });

    it('accepts only the raw file', async () => {
      const res = await upload(appWith(), 'x', { 'Content-Type': 'multipart/form-data; boundary=x' });
      expect(res.status).toBe(415);
    });

    it('needs the length of the file first, so it never holds the file in memory', async () => {
      const res = await upload(appWith(), heldStream().stream);
      expect(res.status).toBe(411);
    });

    it('refuses a file larger than the limit', async () => {
      const res = await upload(appWith(), 'x', { 'Content-Length': String(UPDATE_FILE_LIMIT_BYTES + 1) });

      expect(res.status).toBe(413);
      expect(await errorOf(res)).toContain('600 MB');
    });

    it('refuses a file when the card has no room to unpack it twice and keep 200 MB free', async () => {
      const file = 'update file';
      const neededBytes = 2 * file.length + SPARE_BYTES;

      const res = await upload(appWith({ folder: new CardFolder(root, neededBytes - 1) }), file);

      expect(res.status).toBe(507);
      expect(await errorOf(res)).toBe('Not enough free space: the update needs 201 MB (two times the file, and 200 MB to spare), and the card has 200 MB.');
      expect(inboxNames()).toEqual([]);
    });

    it('takes a file when the card has room to unpack it twice and keep 200 MB free', async () => {
      const file = 'update file';

      const res = await upload(appWith({ folder: new CardFolder(root, 2 * file.length + SPARE_BYTES) }), file);

      expect(res.status).toBe(200);
    });

    it('refuses a file on a normal computer', async () => {
      const res = await upload(appWith({ folder: new UpdateFolder(path.join(root, 'missing')) }), 'update file');

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('docker compose pull');
    });

    it('refuses a file in a development build', async () => {
      const res = await upload(appWith({ version: 'development' }), 'update file');

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('Development build');
    });

    it('takes one file at a time', async () => {
      const app = appWith();
      const first = heldStream();
      const firstReply = upload(app, first.stream, { 'Content-Length': '5' });
      first.send('12');
      await vi.waitFor(() => expect(inboxNames()).toHaveLength(1));

      const second = await upload(app, 'other');
      expect(second.status).toBe(409);

      first.send('345');
      first.end();
      expect((await firstReply).status).toBe(200);
      expect(readFileSync(path.join(inbox, UPDATE_FILE_NAME), 'utf8')).toBe('12345');
    });

    it('deletes the half file when the upload stops', async () => {
      const app = appWith();
      const body = heldStream();
      const reply = upload(app, body.stream, { 'Content-Length': '100' });
      body.send('half');
      await vi.waitFor(() => expect(inboxNames()).toHaveLength(1));

      body.break();

      expect((await reply).status).toBe(500);
      expect(inboxNames()).toEqual([]);
      // The next upload can start
      expect((await upload(app, 'update file')).status).toBe(200);
    });

    it('refuses a file while the helper is busy', async () => {
      writeStatus('checking');

      const res = await upload(appWith(), 'update file');

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('busy');
      expect(inboxNames()).toEqual([]);
    });

    it('stops an upload that sends no bytes for the idle time, and deletes the half file', async () => {
      const app = appWith({ idleMs: 30 });
      const body = heldStream();
      const reply = upload(app, body.stream, { 'Content-Length': '100' });
      body.send('half');

      const res = await reply;

      expect(res.status).toBe(408);
      expect(await errorOf(res)).toContain('The update file stopped coming in: no bytes came in for');
      expect(inboxNames()).toEqual([]);
      expect((await upload(app, 'update file')).status).toBe(200);
    });
  });

  describe('POST /updates/check and /updates/install', () => {
    const ask = (app: TestApp, request: 'check' | 'install') =>
      app.request(`/api/updates/${request}`, { method: 'POST', headers: { Cookie: cookie } });
    const requestText = () => readFileSync(path.join(inbox, REQUEST_FILE_NAME), 'utf8');
    const addUpdateFile = () => writeFileSync(path.join(inbox, UPDATE_FILE_NAME), 'update file');

    it('needs a login', async () => {
      expect((await appWith().request('/api/updates/check', { method: 'POST' })).status).toBe(401);
      expect((await appWith().request('/api/updates/install', { method: 'POST' })).status).toBe(401);
    });

    it('asks the helper to check the update file, and logs who asked', async () => {
      addUpdateFile();

      const res = await ask(appWith(), 'check');

      expect(res.status).toBe(200);
      expect(requestText()).toBe('check');
      expect(await res.json()).toMatchObject({ isRequestPending: true });
      expect(log.text('info')).toContain('Update helper asked user=admin request=check');
    });

    it('refuses a check with no update file', async () => {
      const res = await ask(appWith(), 'check');

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('Upload or download an update file first');
    });

    it('asks the helper to install a file that passed the check', async () => {
      writeStatus('ready');

      const res = await ask(appWith(), 'install');

      expect(res.status).toBe(200);
      expect(requestText()).toBe('install');
      expect(log.text('info')).toContain('Update helper asked user=admin request=install');
    });

    it('refuses an install before a check passed', async () => {
      writeStatus('refused');

      const res = await ask(appWith(), 'install');

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('Check an update file first');
    });

    it('refuses a request while the helper is busy', async () => {
      addUpdateFile();
      writeStatus('installing');

      const res = await ask(appWith(), 'check');

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('busy');
    });

    it('refuses to install the file that passed the check when a new update file came in', async () => {
      writeStatus('ready');
      addUpdateFile();

      const res = await ask(appWith(), 'install');

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toBe('A new update file is here. Check it before you install it.');
      expect(inboxNames()).toEqual([UPDATE_FILE_NAME]);
    });

    it('refuses a request while another request waits for the helper, and keeps the waiting one', async () => {
      writeStatus('ready');
      const app = appWith();
      expect((await ask(app, 'install')).status).toBe(200);
      addUpdateFile();

      const res = await ask(app, 'check');

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toBe('A request already waits for the update helper. Wait until it starts.');
      expect(requestText()).toBe('install');
    });

    it('takes a request again after a busy helper went silent', async () => {
      addUpdateFile();
      writeStatus('checking', new Date(Date.now() - HELPER_SILENCE_LIMIT_MS - 1000).toISOString());

      expect((await ask(appWith(), 'check')).status).toBe(200);
    });

    it('refuses a request on a normal computer, and in a development build', async () => {
      const normal = appWith({ folder: new UpdateFolder(path.join(root, 'missing')) });
      expect((await ask(normal, 'check')).status).toBe(409);

      addUpdateFile();
      const development = await ask(appWith({ version: 'edge-1a2b3c4' }), 'check');
      expect(development.status).toBe(409);
      expect(await errorOf(development)).toContain('Development build');
    });
  });

  describe('the newest release on GitHub', () => {
    const ASSET_URL = 'https://github.com/toolpath/chatter/releases/download/v1.3.0/chatter-update-1.3.0-armv7.tar';
    const RELEASE = {
      tag_name: 'v1.3.0',
      assets: [{ name: 'chatter-update-1.3.0-armv7.tar', size: 11, browser_download_url: ASSET_URL }],
    };

    /** A watcher that asks a fake GitHub: the latest release, and its file */
    async function releasesWith(release: object, asset: () => Response = () => new Response('update file')) {
      const fetch = vi.fn(async (url: string | URL | Request) => (String(url) === ASSET_URL ? asset() : Response.json(release)));
      let saved: string | undefined;
      const store = { read: () => saved, write: (value: string) => void (saved = value) };
      const releases = new ReleaseWatcher({ repo: 'toolpath/chatter', store, fetch: fetch as typeof globalThis.fetch });
      await releases.checkNow();
      return releases;
    }

    const download = (app: TestApp) =>
      app.request('/api/updates/download', { method: 'POST', headers: { Cookie: cookie } });
    const statusOf = async (app: TestApp) =>
      (await (await app.request('/api/updates/status', { headers: { Cookie: cookie } })).json()) as Record<string, unknown>;

    it('tells the newest version, and that it is newer', async () => {
      const app = appWith({ releases: await releasesWith(RELEASE) });
      expect((await statusOf(app)).newest).toMatchObject({ checkGitHub: true, version: '1.3.0', isNewer: true, error: null });
    });

    it('downloads the update file for this processor into the inbox, and logs who asked', async () => {
      const app = appWith({ releases: await releasesWith(RELEASE) });

      const res = await download(app);

      expect(res.status).toBe(200);
      await vi.waitFor(async () => expect((await statusOf(app)).isReceiving).toBe(false));
      expect(inboxNames()).toEqual([UPDATE_FILE_NAME]);
      expect(readFileSync(path.join(inbox, UPDATE_FILE_NAME), 'utf8')).toBe('update file');
      expect(log.text('info')).toContain('Update downloaded user=admin file=chatter-update-1.3.0-armv7.tar');
    });

    it('shows why a download failed, and leaves no half file', async () => {
      const app = appWith({ releases: await releasesWith(RELEASE, () => new Response('gone', { status: 404 })) });

      expect((await download(app)).status).toBe(200);

      await vi.waitFor(async () => expect((await statusOf(app)).downloadError).toContain('HTTP 404'));
      expect(inboxNames()).toEqual([]);
    });

    it('takes no upload while a download comes in, and takes one again after it', async () => {
      const file = heldStream();
      const app = appWith({ releases: await releasesWith(RELEASE, () => new Response(file.stream)) });
      expect((await download(app)).status).toBe(200);

      expect((await upload(app, 'other')).status).toBe(409);

      file.send('update file');
      file.end();
      await vi.waitFor(async () => expect((await statusOf(app)).isReceiving).toBe(false));
      expect((await upload(app, 'other')).status).toBe(200);
    });

    it('stops a download that gives no bytes for the idle time, and leaves no half file', async () => {
      const stalled = () => new Response(heldStream().stream);
      const app = appWith({ releases: await releasesWith(RELEASE, stalled), idleMs: 30 });

      expect((await download(app)).status).toBe(200);

      await vi.waitFor(async () => expect((await statusOf(app)).downloadError).toContain('no bytes came in'));
      expect((await statusOf(app)).isReceiving).toBe(false);
      expect(inboxNames()).toEqual([]);
    });

    it('refuses a download while the helper is busy', async () => {
      writeStatus('installing');
      const app = appWith({ releases: await releasesWith(RELEASE) });

      const res = await download(app);

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('busy');
      expect(inboxNames()).toEqual([]);
    });

    it('refuses a download when no newer version is on GitHub', async () => {
      const app = appWith({ version: '1.3.0', releases: await releasesWith(RELEASE) });

      const res = await download(app);

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('No newer version');
    });

    it('refuses a download when the release has no file for this processor', async () => {
      writeFileSync(path.join(root, 'helper.json'), '{"arch":"amd64"}');
      const app = appWith({ releases: await releasesWith(RELEASE) });

      const res = await download(app);

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('no update file for amd64');
    });

    it('refuses a download when the card has too little free space', async () => {
      const assetBytes = RELEASE.assets[0].size;
      const app = appWith({ folder: new CardFolder(root, 2 * assetBytes + SPARE_BYTES - 1), releases: await releasesWith(RELEASE) });
      expect((await download(app)).status).toBe(507);
    });

    it('turns the check off and on', async () => {
      const app = appWith({ releases: await releasesWith(RELEASE) });
      const save = (checkGitHub: unknown) => app.request('/api/updates/settings', {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkGitHub }),
      });

      const off = await save(false);
      expect(off.status).toBe(200);
      expect(((await off.json()) as Record<string, unknown>).newest).toMatchObject({ checkGitHub: false, version: null });

      const on = await save(true);
      expect(((await on.json()) as Record<string, unknown>).newest).toMatchObject({ checkGitHub: true, version: '1.3.0' });

      expect((await save('yes')).status).toBe(400);
    });
  });
});
