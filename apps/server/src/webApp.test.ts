import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app.js';
import { HardwarePoller } from './polling/poller.js';
import { noHistory } from './recording/testSupport.js';
import { webAppRoutes } from './webApp.js';
import { loggedInAuth } from './auth/testSupport.js';

/** A database that has no machines */
const emptyDb = {
  prepare: () => ({ run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }),
} as unknown as Database.Database;

describe('webAppRoutes', () => {
  let webDir: string;
  let app: ReturnType<typeof createApp>;
  let loggedIn: RequestInit;

  beforeAll(async () => {
    webDir = mkdtempSync(join(tmpdir(), 'chatterbox-web-'));
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'index.html'), '<div id="root"></div>');
    writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log(1)');
    const { auth, accounts, cookie } = await loggedInAuth();
    loggedIn = { headers: { Cookie: cookie } };
    app = createApp({ poller: new HardwarePoller(emptyDb), auth, accounts, history: noHistory() });
    app.route('/', webAppRoutes(webDir));
  });

  afterAll(() => rmSync(webDir, { recursive: true, force: true }));

  it('serves the index page at /', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });

  it('serves a built file', async () => {
    const res = await app.request('/assets/app.js');
    expect(await res.text()).toBe('console.log(1)');
  });

  it('serves the index page for a page of the web app', async () => {
    const res = await app.request('/machine/brother_1');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });

  it('gives 404 for a missing file, not the index page', async () => {
    const res = await app.request('/assets/index-old.js');
    expect(res.status).toBe(404);
  });

  it('still serves the API', async () => {
    const res = await app.request('/api/machines', loggedIn);
    expect(await res.json()).toEqual([]);
  });

  it('gives a JSON 404 for an unknown API address', async () => {
    const res = await app.request('/api/nothing-here', loggedIn);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
