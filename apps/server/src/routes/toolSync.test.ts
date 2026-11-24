import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { HardwarePoller } from '../polling/poller.js';
import { errorOf, testApp, type TestApp } from './testSupport.js';

const TOOL_SYNC = { lastSyncAt: '2026-11-21T08:00:00.000Z', lastAttemptAt: '2026-11-21T08:00:00.000Z', error: null, running: false };
const PASSWORD = 'a-good-password';

describe('POST /api/machine/:id/tools/sync', () => {
  let app: TestApp;
  let poller: HardwarePoller;
  let operatorCookie: string;
  let viewerCookie: string;

  /** Adds a user with this role, logs in, and gives the session cookie */
  async function cookieOf(username: string, role: 'viewer' | 'operator', accounts: UserAccounts) {
    await accounts.add({ username, password: PASSWORD, role });
    const login = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    });
    return (login.headers.get('Set-Cookie') ?? '').split(';')[0];
  }

  beforeEach(async () => {
    const parts = await loggedInAuth();
    poller = new HardwarePoller(new Database(':memory:'));
    app = testApp({ auth: parts.auth, accounts: parts.accounts, poller });
    operatorCookie = await cookieOf('jo', 'operator', parts.accounts);
    viewerCookie = await cookieOf('vi', 'viewer', parts.accounts);
  });

  const sync = (cookie = operatorCookie) => app.request('/api/machine/speedio/tools/sync', { method: 'POST', headers: { Cookie: cookie } });

  it('reads the tools for an Operator', async () => {
    const syncTools = vi.spyOn(poller, 'syncTools').mockResolvedValue({ outcome: 'synced', toolSync: TOOL_SYNC });

    const res = await sync();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ toolSync: TOOL_SYNC });
    expect(syncTools).toHaveBeenCalledWith('speedio');
  });

  // A Viewer only looks. Chatter still reads the tool table by itself for each role.
  it('refuses a Viewer, with a cookie or with HTTP Basic, and does not read the tools', async () => {
    const syncTools = vi.spyOn(poller, 'syncTools').mockResolvedValue({ outcome: 'synced', toolSync: TOOL_SYNC });
    const basic = `Basic ${Buffer.from(`vi:${PASSWORD}`).toString('base64')}`;

    const withCookie = await sync(viewerCookie);
    const withBasic = await app.request('/api/machine/speedio/tools/sync', { method: 'POST', headers: { Authorization: basic } });

    expect(withCookie.status).toBe(403);
    expect(withBasic.status).toBe(403);
    expect(syncTools).not.toHaveBeenCalled();
  });

  it('needs a login', async () => {
    expect((await sync('')).status).toBe(401);
  });

  it('gives the reason when the read fails', async () => {
    vi.spyOn(poller, 'syncTools').mockResolvedValue({ outcome: 'failed', toolSync: { ...TOOL_SYNC, error: 'No reply' } });

    const res = await sync();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'The machine did not send its tool table: No reply', outcome: 'failed', toolSync: { ...TOOL_SYNC, error: 'No reply' },
    });
  });

  it('refuses a second request within 30 seconds, and tells when to try again', async () => {
    vi.spyOn(poller, 'syncTools').mockResolvedValue({ outcome: 'too-soon', retryAfterSeconds: 12 });

    const res = await sync();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('12');
    expect(await res.json()).toEqual({
      error: 'Chatter read the tool table a short time ago. Try again in 12 seconds.', outcome: 'too-soon', retryAfterSeconds: 12,
    });
  });

  it('refuses a request while a read runs, or when the machine is not connected', async () => {
    vi.spyOn(poller, 'syncTools').mockResolvedValueOnce({ outcome: 'busy' }).mockResolvedValueOnce({ outcome: 'not-connected' });

    const busy = await sync();
    const offline = await sync();

    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: expect.stringContaining('runs now'), outcome: 'busy' });
    expect(offline.status).toBe(409);
    expect(await offline.json()).toEqual({ error: expect.stringContaining('not connected'), outcome: 'not-connected' });
  });

  it('refuses a request when the control does not report that no program runs, and tells why', async () => {
    vi.spyOn(poller, 'syncTools').mockResolvedValue({ outcome: 'program-running' });

    const res = await sync();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Chatter reads the tools only when the control reports that no program runs. Press Sync again when the program ends.',
      outcome: 'program-running',
    });
  });

  it('tells when the address changed during the read', async () => {
    vi.spyOn(poller, 'syncTools').mockResolvedValue({ outcome: 'address-changed' });

    const res = await sync();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'The address of the machine changed during the read. Chatter did not keep the result. '
        + 'Press Sync again when the machine is online at the new address.',
      outcome: 'address-changed',
    });
  });

  it('gives 404 for a machine that is not there, and 400 with the reason for a machine type with no tool table', async () => {
    vi.spyOn(poller, 'syncTools').mockResolvedValueOnce({ outcome: 'not-found' }).mockResolvedValueOnce({ outcome: 'not-supported' });

    expect((await sync()).status).toBe(404);
    const unsupported = await sync();
    expect(unsupported.status).toBe(400);
    expect(await errorOf(unsupported)).toBe('This machine type has no tool table to read.');
  });
});
