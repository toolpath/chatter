import Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../auth/authRoutes.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { Auth } from '../auth/Auth.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { captureAudit, captureLog, type CapturedAudit } from '../logging/testSupport.js';
import { CertificateChangedError } from '../machines/siemens/certificatePin.js';
import type { SinumerikConnectOptions, SinumerikSession } from '../machines/siemens/sinumerikClient.js';
import { MachineRepository } from '../polling/machineRepository.js';
import { HardwarePoller } from '../polling/poller.js';
import { applySchema } from '../storage/schema.js';
import { errorOf, testApp } from './testSupport.js';

/** A stand-in for the SHA-1 thumbprint of the certificate with this SHA-256 thumbprint */
const sha1Of = vi.hoisted(() => (thumbprint: string) => thumbprint.slice(0, 40));

/** The control: the certificate that it shows now, and each connect that Chatter makes */
const control = vi.hoisted(() => ({
  thumbprint: 'c'.repeat(64) as string | null,
  connects: [] as { trustedThumbprint: string | null; password?: string }[],
}));

// The SiemensConnector of the poller opens its sessions here, as the real opener does: it refuses a changed certificate
vi.mock('../machines/siemens/sinumerikClient.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../machines/siemens/sinumerikClient.js')>()),
  openSinumerikSession: async (options: SinumerikConnectOptions): Promise<SinumerikSession> => {
    if (options.trustedThumbprint && options.trustedThumbprint !== control.thumbprint) {
      throw new CertificateChangedError(control.thumbprint, options.trustedThumbprint, control.thumbprint && sha1Of(control.thumbprint));
    }
    control.connects.push({ trustedThumbprint: options.trustedThumbprint, password: options.password });
    return {
      serverThumbprint: control.thumbprint,
      read: async paths => paths.map(() => ({ value: 1, status: 'Good' })),
      watchAlarms: async () => null,
      close: async () => undefined,
    };
  },
}));

const FIRST = 'c'.repeat(64);
const SECOND = 'd'.repeat(64);
const THIRD = 'e'.repeat(64);

describe('the certificate of a Siemens control', () => {
  let auth: Auth;
  let accounts: UserAccounts;
  let cookie: string;
  let operatorCookie: string;
  let viewerCookie: string;
  let db: Database.Database;
  let poller: HardwarePoller;
  let id: string;
  let audit: CapturedAudit;

  beforeAll(async () => {
    ({ auth, accounts, cookie } = await loggedInAuth());
    const logIn = async (username: string, role: 'operator' | 'viewer') => {
      await accounts.add({ username, password: 'test-password', role });
      return `${SESSION_COOKIE}=${await auth.logIn({ username, password: 'test-password' }, { userAgent: 'test browser', address: '127.0.0.1' })}`;
    };
    operatorCookie = await logIn('operator', 'operator');
    viewerCookie = await logIn('viewer', 'viewer');
  });

  beforeEach(async () => {
    control.thumbprint = FIRST;
    control.connects = [];
    db = new Database(':memory:');
    applySchema(db);
    poller = new HardwarePoller(db);
    id = (await poller.addMachine({ type: 'siemens', name: 'DMU', host: '192.168.1.60', opcuaUser: 'u', opcuaPassword: 'secret' })).id;
    audit = captureAudit();
  });

  afterEach(() => {
    audit.restore();
    poller.stop();
  });

  const app = () => testApp({ auth, accounts, poller });
  const savedThumbprint = () =>
    (db.prepare('SELECT opcua_server_thumbprint FROM siemens_machines WHERE id = ?').get(id) as { opcua_server_thumbprint: string | null })
      .opcua_server_thumbprint;
  const machine = async () => (await (await app().request(`/api/machine/${id}`, { headers: { Cookie: cookie } })).json()) as {
    connected: boolean; opcuaServerThumbprint: string | null; opcuaCertificateChanged?: { presentedThumbprint: string | null; presentedSha1Thumbprint: string | null };
  };
  const trust = (body: unknown, as = cookie, machineId = id) => app().request(`/api/machine/${machineId}/opcua/trust-certificate`, {
    method: 'POST',
    headers: { Cookie: as, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const forget = (as = cookie, machineId = id) => app().request(`/api/machine/${machineId}/opcua/forget-certificate`, {
    method: 'POST', headers: { Cookie: as },
  });

  /** The first connect trusts FIRST. Then the control shows SECOND, and Chatter refuses it. */
  async function controlChangesItsCertificate(): Promise<void> {
    await poller.poll();
    control.thumbprint = SECOND;
    poller.getConnector(id)?.disconnect();
    await poller.poll();
  }

  it('saves the certificate of the first connect in the database', async () => {
    await poller.poll();
    expect(savedThumbprint()).toBe(FIRST);
    expect(await machine()).toMatchObject({ connected: true, opcuaServerThumbprint: FIRST });
  });

  it('keeps the trusted certificate after a restart of Chatter, and still refuses a changed certificate', async () => {
    await poller.poll();
    poller.stop();
    control.thumbprint = SECOND;

    poller = new HardwarePoller(db);
    await poller.loadFromDatabase();
    await poller.poll();

    expect(control.connects).toHaveLength(1);
    expect(await machine()).toMatchObject({
      connected: false, opcuaServerThumbprint: FIRST, opcuaCertificateChanged: { presentedThumbprint: SECOND },
    });
    expect(savedThumbprint()).toBe(FIRST);
  });

  it('still connects when the database cannot save the certificate, and logs the error', async () => {
    const log = captureLog();
    const save = vi.spyOn(MachineRepository.prototype, 'setSiemensServerThumbprint').mockImplementation(() => {
      throw new Error('disk full');
    });
    try {
      await poller.poll();
      expect(await machine()).toMatchObject({ connected: true, opcuaServerThumbprint: FIRST });
      expect(log.text('error')).toContain('Could not save the trusted OPC UA certificate');
      expect(log.text('error')).toContain('disk full');
    } finally {
      save.mockRestore();
      log.restore();
    }
  });

  it('shows a changed certificate in the status, and does not send the password to the control', async () => {
    await controlChangesItsCertificate();

    expect(await machine()).toMatchObject({
      connected: false, opcuaServerThumbprint: FIRST, opcuaCertificateChanged: { presentedThumbprint: SECOND, presentedSha1Thumbprint: sha1Of(SECOND) },
    });
    expect(control.connects).toHaveLength(1);
    expect(savedThumbprint()).toBe(FIRST);
  });

  describe('POST /api/machine/:id/opcua/trust-certificate', () => {
    it('lets an Admin trust the new certificate that the status shows, and Chatter connects again', async () => {
      await controlChangesItsCertificate();

      const res = await trust({ thumbprint: SECOND });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ opcuaServerThumbprint: SECOND });
      expect(savedThumbprint()).toBe(SECOND);
      await poller.poll();
      expect(await machine()).toMatchObject({ connected: true, opcuaServerThumbprint: SECOND });
      expect((await machine()).opcuaCertificateChanged).toBeUndefined();
      expect(control.connects.at(-1)).toEqual({ trustedThumbprint: SECOND, password: 'secret' });
    });

    it('accepts the thumbprint in capital letters', async () => {
      await controlChangesItsCertificate();
      expect((await trust({ thumbprint: SECOND.toUpperCase() })).status).toBe(200);
      expect(savedThumbprint()).toBe(SECOND);
    });

    it('writes the trusted thumbprint in the audit log', async () => {
      await controlChangesItsCertificate();
      await trust({ thumbprint: SECOND });
      const line = audit.lines.find(text => text.includes('/opcua/trust-certificate'));
      expect(line).toContain(SECOND);
      expect(line).toContain('admin');
    });

    it.each([['an Operator', () => operatorCookie], ['a Viewer', () => viewerCookie]])('refuses %s with 403, and trusts nothing', async (_role, as) => {
      await controlChangesItsCertificate();

      const res = await trust({ thumbprint: SECOND }, as());

      expect(res.status).toBe(403);
      expect(savedThumbprint()).toBe(FIRST);
      expect((await machine()).opcuaCertificateChanged).toEqual({ presentedThumbprint: SECOND, presentedSha1Thumbprint: sha1Of(SECOND) });
    });

    it('refuses a thumbprint that is not the certificate that the control shows now (it changed again)', async () => {
      await controlChangesItsCertificate();
      control.thumbprint = THIRD;
      await poller.poll();

      const res = await trust({ thumbprint: SECOND });

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('changed again');
      expect(savedThumbprint()).toBe(FIRST);
      expect((await machine()).opcuaCertificateChanged).toEqual({ presentedThumbprint: THIRD, presentedSha1Thumbprint: sha1Of(THIRD) });
    });

    it('refuses when the control shows the trusted certificate, so there is nothing new to trust', async () => {
      await poller.poll();
      const res = await trust({ thumbprint: SECOND });
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('no new certificate');
      expect(savedThumbprint()).toBe(FIRST);
    });

    it('tells how to go on when the control now shows no certificate', async () => {
      await poller.poll();
      control.thumbprint = null;
      poller.getConnector(id)?.disconnect();
      await poller.poll();

      const res = await trust({ thumbprint: SECOND });

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain('/opcua/forget-certificate');
    });

    it.each([{}, { thumbprint: 'abc' }, { thumbprint: 'g'.repeat(64) }, { thumbprint: 42 }, []])('refuses the body %j with 400', async body => {
      await controlChangesItsCertificate();
      expect((await trust(body)).status).toBe(400);
      expect(savedThumbprint()).toBe(FIRST);
    });

    it('gives 404 for an unknown machine', async () => {
      expect((await trust({ thumbprint: SECOND }, cookie, 'no-such-machine')).status).toBe(404);
    });

    it('gives 400 for a machine that is not a Siemens machine', async () => {
      const brother = (await poller.addMachine({ type: 'brother', name: 'B', host: '192.168.1.61' })).id;
      const res = await trust({ thumbprint: SECOND }, cookie, brother);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toContain('Siemens');
    });
  });

  describe('POST /api/machine/:id/opcua/forget-certificate', () => {
    it('lets an Admin forget the trusted certificate, and the next connect trusts the certificate that it gets', async () => {
      await controlChangesItsCertificate();

      const res = await forget();

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ opcuaServerThumbprint: null });
      expect(savedThumbprint()).toBeNull();
      expect((await machine()).opcuaCertificateChanged).toBeUndefined();
      await poller.poll();
      expect(control.connects.at(-1)).toEqual({ trustedThumbprint: null, password: 'secret' });
      expect(savedThumbprint()).toBe(SECOND);
      expect(await machine()).toMatchObject({ connected: true, opcuaServerThumbprint: SECOND });
    });

    it('lets an Admin go on with a control that now shows no certificate', async () => {
      await poller.poll();
      control.thumbprint = null;
      poller.getConnector(id)?.disconnect();
      await poller.poll();
      expect((await machine()).opcuaCertificateChanged).toEqual({ presentedThumbprint: null, presentedSha1Thumbprint: null });

      expect((await forget()).status).toBe(200);
      await poller.poll();

      expect(await machine()).toMatchObject({ connected: true, opcuaServerThumbprint: null });
    });

    it('writes the forget in the audit log, with the user', async () => {
      await poller.poll();
      await forget();
      const line = audit.lines.find(text => text.includes('/opcua/forget-certificate'));
      expect(line).toContain('admin');
    });

    it.each([['an Operator', () => operatorCookie], ['a Viewer', () => viewerCookie]])('refuses %s with 403, and forgets nothing', async (_role, as) => {
      await poller.poll();
      expect((await forget(as())).status).toBe(403);
      expect(savedThumbprint()).toBe(FIRST);
    });

    it('gives 404 for an unknown machine', async () => {
      expect((await forget(cookie, 'no-such-machine')).status).toBe(404);
    });

    it('gives 400 for a machine that is not a Siemens machine', async () => {
      const brother = (await poller.addMachine({ type: 'brother', name: 'B', host: '192.168.1.61' })).id;
      const res = await forget(cookie, brother);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toContain('Siemens');
    });
  });

  describe('PUT /api/machine/:id', () => {
    it('forgets the trusted certificate when the IP address changes, so the next connect trusts the new device', async () => {
      await poller.poll();
      const res = await app().request(`/api/machine/${id}`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '192.168.1.99', opcuaPassword: 'secret' }),
      });

      expect(res.status).toBe(200);
      expect(savedThumbprint()).toBeNull();
      expect(await machine()).toMatchObject({ opcuaServerThumbprint: null });
      control.thumbprint = SECOND;
      await poller.poll();
      expect(savedThumbprint()).toBe(SECOND);
    });

    it('keeps the trusted certificate when only the name changes', async () => {
      await poller.poll();
      await app().request(`/api/machine/${id}`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      });
      expect(savedThumbprint()).toBe(FIRST);
    });
  });
});
