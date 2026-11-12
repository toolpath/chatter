import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loggedInAuth } from '../auth/testSupport.js';
import type { Auth } from '../auth/Auth.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { FocasLibraryInstaller } from '../machines/fanuc/focasLibraryInstaller.js';
import { FakeFocasLoader, X64_LIBRARY_NAME, x64Library } from '../machines/fanuc/testSupport.js';
import { errorOf, testApp, type TestApp } from './testSupport.js';

function uploadForm(file: Buffer): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(file)], X64_LIBRARY_NAME));
  return form;
}

describe('FANUC library routes', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  let cookie: string;
  let folder: string;
  let loader: FakeFocasLoader;
  let onLoaded: () => void;
  let app: TestApp;

  beforeAll(async () => {
    ({ auth, accounts, cookie } = await loggedInAuth());
  });

  beforeEach(() => {
    folder = mkdtempSync(path.join(os.tmpdir(), 'focas-routes-'));
    loader = FakeFocasLoader.inFolder(folder);
    onLoaded = vi.fn();
    const focasLibrary = new FocasLibraryInstaller(loader, onLoaded, 'linux', 'x64');
    app = testApp({ auth, accounts, focasLibrary });
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const send = (method: string, address: string, body?: FormData) =>
    app.request(`/api${address}`, { method, headers: { Cookie: cookie }, body });

  it('needs a login', async () => {
    expect((await app.request('/api/focas/status')).status).toBe(401);
    expect((await app.request('/api/focas/library', { method: 'POST', body: uploadForm(x64Library()) })).status).toBe(401);
  });

  it('names the file that this computer needs', async () => {
    const res = await send('GET', '/focas/status');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fileName: X64_LIBRARY_NAME, source: null });
  });

  it('saves and loads an uploaded library', async () => {
    const res = await send('POST', '/focas/library', uploadForm(x64Library()));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: 'uploaded', restartNeeded: false });
    expect(loader.loaded).toBe(true);
    expect(onLoaded).toHaveBeenCalledOnce();
  });

  it('refuses a library for another processor, and names the file to use', async () => {
    const arm = x64Library();
    arm[4] = 1;
    arm.writeUInt16LE(0x28, 18);

    const res = await send('POST', '/focas/library', uploadForm(arm));

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/32-bit ARM.*libfwlib32-linux-x64/);
  });

  it('refuses a form with no file', async () => {
    const res = await send('POST', '/focas/library', new FormData());

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('No file provided');
  });

  it('removes the uploaded library', async () => {
    await send('POST', '/focas/library', uploadForm(x64Library()));

    const res = await send('DELETE', '/focas/library');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: null, restartNeeded: true });
  });
});
