import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { setTimeout as wait } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import type { IncomingMessage } from 'node:http';
import { createApp } from './app.js';
import { HardwarePoller } from './polling/poller.js';
import type { Auth } from './auth/Auth.js';
import type { UserAccounts } from './auth/userAccounts.js';
import { loggedInAuth, TEST_LOGIN } from './auth/testSupport.js';
import { SESSION_COOKIE } from './auth/authRoutes.js';
import { hasLongTimeLimit } from './webServerOptions.js';
import { captureLog } from './logging/testSupport.js';
import { UNEXPECTED_ERROR_TEXT } from './routes/responses.js';
import { STREAM_STOPPED_TEXT } from './routes/streamReplies.js';
import { KEEP_ALIVE_MS } from './realtime/machineEvents.js';
import type { HistorySource, RangeQuery, StateTime, WindowQuery } from './recording/MetricsReader.js';
import { StatePeriodStore } from './recording/StatePeriodStore.js';
import type { FTPClient } from './ftp/FTPClient.js';
import { type Alert, AlertStore } from './alerts/AlertStore.js';
import { FILE_LIST_CUT_SHORT_HEADER, PROGRAM_UPLOAD_LIMIT_BYTES, SUPPORTED_MACHINE_TYPES, type FTPTreeNode } from '@local-chatter/shared';

// Mock the db module
vi.mock('./storage/database.js', () => ({
  recordUpload: vi.fn().mockResolvedValue(undefined),
  getUploadFiles: vi.fn().mockResolvedValue([]),
  getUploadEvents: vi.fn().mockResolvedValue([]),
  getUploadEventById: vi.fn().mockResolvedValue(null),
}));

import { getUploadFiles, getUploadEvents, getUploadEventById, recordUpload } from './storage/database.js';

// Create a mock SQLite database
function createMockDb() {
  const mockStatement = {
    run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    get: vi.fn().mockReturnValue(undefined),
    all: vi.fn().mockReturnValue([]),
  };
  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    exec: vi.fn(),
    pragma: vi.fn().mockReturnValue([]),
  } as unknown as Database.Database;
}

/** The status and the JSON body of one reply */
interface Reply {
  status: number;
  // Each test reads the fields it needs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

function uploadForm({ withFile = false, path }: { withFile?: boolean; path?: string }): FormData {
  const form = new FormData();
  if (withFile) form.append('file', new File(['test'], 'test.nc'));
  if (path) form.append('path', path);
  return form;
}

describe('API Routes', () => {
  let app: ReturnType<typeof createApp>;
  let poller: HardwarePoller;
  let history: {
    windowAverages: ReturnType<typeof vi.fn<(...args: [WindowQuery]) => ReturnType<HistorySource['windowAverages']>>>;
    stateTime: ReturnType<typeof vi.fn<(...args: [RangeQuery]) => Promise<StateTime | null>>>;
    rangeIncrease: ReturnType<typeof vi.fn<(...args: [RangeQuery]) => Promise<number | null>>>;
  };
  let mockDb: Database.Database;
  let statePeriods: StatePeriodStore;
  let alerts: AlertStore;
  let auth: Auth;
  let accounts: UserAccounts;
  let cookie: string;

  beforeAll(async () => {
    ({ auth, accounts, cookie } = await loggedInAuth());
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    poller = new HardwarePoller(mockDb);
    history = { windowAverages: vi.fn().mockResolvedValue([]), stateTime: vi.fn().mockResolvedValue(null), rangeIncrease: vi.fn().mockResolvedValue(null) };
    statePeriods = StatePeriodStore.inMemory();
    alerts = AlertStore.inMemory();
    app = createApp({ poller, auth, accounts, history, statePeriods, alerts });
  });

  /** Send a request as a logged-in browser */
  function send(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Cookie', cookie);
    return Promise.resolve(app.request(path, { ...init, headers }));
  }

  /** Send a request to the app. A plain object is sent as JSON. */
  async function call(method: string, path: string, body?: object | FormData): Promise<Reply> {
    const init: RequestInit = { method };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    const res = await send(path, init);
    return { status: res.status, body: await res.json() };
  }

  describe('GET /api/health', () => {
    it('returns ok status', async () => {
      const res = await call('GET', '/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.uptime).toBeDefined();
    });

    it('gives the Chatter version with no login, so the update helper can check it', async () => {
      const app = createApp({ poller, auth, accounts, history, version: '1.2.0' });

      const res = await app.request('/api/health');

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ version: '1.2.0' });
    });
  });

  describe('the cache of API replies', () => {
    // A reply can set the login cookie again (authRoutes.ts), so no shared cache in a proxy may keep it for other browsers
    it('tells each cache not to keep an API reply', async () => {
      const replies = [
        await app.request('/api/health'),
        await app.request('/api/machines'),
        await send('/api/machines'),
        await send('/api/not-an-api-address'),
      ];

      expect(replies.map(res => res.status)).toEqual([200, 401, 200, 404]);
      for (const res of replies) expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('tells each cache not to keep the live events', async () => {
      const res = await send('/api/events');
      await res.body!.cancel();

      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
  });

  describe('the time limit of a large upload', () => {
    /** Each route that takes a large file. "m1" does not need to be a machine: the route marks the request first. */
    const LARGE_UPLOADS = [
      '/api/updates/file', '/api/machine/m1/history-restore', '/api/focas/library',
      '/api/machine/m1/files/upload', '/api/machine/m1/files/upload-batch',
    ];

    /** True when the route gave the request the long time limit */
    async function getsLongTime(path: string, headers: Record<string, string>): Promise<boolean> {
      const incoming = {} as IncomingMessage;
      await app.request(path, { method: 'POST', headers, body: 'x' }, { incoming });
      return hasLongTimeLimit(incoming);
    }

    it('gives the long time to each large upload, but only after the login and the role check', async () => {
      const viewer = { username: 'time-viewer', password: 'test-password' };
      await accounts.add({ ...viewer, role: 'viewer' });
      const viewerCookie = `${SESSION_COOKIE}=${await auth.logIn(viewer, { userAgent: 'test browser', address: '127.0.0.1' })}`;

      for (const path of LARGE_UPLOADS) {
        expect(await getsLongTime(path, { Cookie: cookie }), path).toBe(true);
        expect(await getsLongTime(path, { Cookie: viewerCookie }), path).toBe(false);
        expect(await getsLongTime(path, {}), path).toBe(false);
      }
    });

    it('gives the normal time to the other routes', async () => {
      expect(await getsLongTime('/api/auth/login', { 'Content-Type': 'application/json' })).toBe(false);
      expect(await getsLongTime('/api/machines', { Cookie: cookie, 'Content-Type': 'application/json' })).toBe(false);
    });
  });

  describe('GET /api/status', () => {
    it('returns empty array when no machines', async () => {
      const res = await call('GET', '/api/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns machines with status', async () => {
      await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const res = await call('GET', '/api/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Speedio');
    });
  });

  // ============================================
  // Machine Routes
  // ============================================

  describe('GET /api/machines', () => {
    it('returns empty array when no machines', async () => {
      const res = await call('GET', '/api/machines');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns all machines of all types', async () => {
      await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      await poller.addHaasMachine({ name: 'VF-2', host: '192.168.1.60' });

      const res = await call('GET', '/api/machines');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((m: { name: string }) => m.name)).toContain('Speedio');
      expect(res.body.map((m: { name: string }) => m.name)).toContain('VF-2');
    });
  });

  describe('POST /api/machines', () => {
    it('creates a new Brother machine', async () => {
      const res = await call('POST', '/api/machines', { type: 'brother', name: 'Speedio', host: '192.168.1.50' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Speedio');
      expect(res.body.host).toBe('192.168.1.50');
      expect(res.body.type).toBe('brother');
      expect(res.body.id).toMatch(/^brother_/);
    });

    it('creates a new Haas machine', async () => {
      const res = await call('POST', '/api/machines', { type: 'haas', name: 'VF-2', host: '192.168.1.60' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('VF-2');
      expect(res.body.host).toBe('192.168.1.60');
      expect(res.body.type).toBe('haas');
      expect(res.body.id).toMatch(/^haas_/);
    });

    it.each([
      { payload: { type: 'brother', host: '192.168.1.50' }, missing: 'name' },
      { payload: { type: 'brother', name: 'Speedio' }, missing: 'host' },
      { payload: { name: 'Speedio', host: '192.168.1.50' }, missing: 'type' },
    ])('returns 400 when $missing is missing', async ({ payload }) => {
      const res = await call('POST', '/api/machines', payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('returns 400 for invalid machine type', async () => {
      const res = await call('POST', '/api/machines', { type: 'unknown', name: 'Test', host: '192.168.1.50' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('brother');
      // The message names each type that Chatter supports, from the shared list
      for (const type of SUPPORTED_MACHINE_TYPES) expect(res.body.error).toContain(`"${type}"`);
    });

    it.each([
      { host: 'not-an-ip', desc: 'non-numeric' },
      { host: '192.168.1', desc: 'incomplete' },
      { host: '192.168.1.256', desc: 'octet > 255' },
      { host: '192.168.1.1.1', desc: 'too many octets' },
      { host: '192.168.01.1', desc: 'leading zeros' },
    ])('returns 400 for invalid IP: $desc', async ({ host }) => {
      const res = await call('POST', '/api/machines', { type: 'brother', name: 'Test', host });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('IP address');
    });

    it('trims whitespace from name and host', async () => {
      const res = await call('POST', '/api/machines', { type: 'brother', name: '  Speedio  ', host: '  192.168.1.50  ' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Speedio');
      expect(res.body.host).toBe('192.168.1.50');
    });

    it('returns 409 for the same IP address and the same data port', async () => {
      await call('POST', '/api/machines', { type: 'brother', name: 'Machine 1', host: '192.168.1.50' });

      const res = await call('POST', '/api/machines', { type: 'brother', name: 'Machine 2', host: '192.168.1.50', dataPort: 10000 });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('192.168.1.50');
      expect(res.body.error).toContain('10000');
      expect(res.body.error).toContain('already exists');
    });

    it('allows the same IP address with a different data port', async () => {
      await call('POST', '/api/machines', { type: 'mtconnect', name: 'Okuma', host: '192.168.1.50', mtConnectPort: 5000 });

      const res = await call('POST', '/api/machines', { type: 'mtconnect', name: 'DMG Mori', host: '192.168.1.50', mtConnectPort: 5001 });

      expect(res.status).toBe(201);
    });

    it('compares against the default port when the request gives no port', async () => {
      await call('POST', '/api/machines', { type: 'haas', name: 'VF-2', host: '192.168.1.60', dataPort: 9998 });

      const res = await call('POST', '/api/machines', { type: 'haas', name: 'VF-4', host: '192.168.1.60' });

      expect(res.status).toBe(409);
    });

    it('uses default values for Brother', async () => {
      const res = await call('POST', '/api/machines', { type: 'brother', name: 'Speedio', host: '192.168.1.50' });

      expect(res.body.dataPort).toBe(10000);
      expect(res.body.ftpPort).toBe(21);
    });

    it('uses default values for Haas', async () => {
      const res = await call('POST', '/api/machines', { type: 'haas', name: 'VF-2', host: '192.168.1.60' });

      expect(res.body.dataPort).toBe(9998);
      expect(res.body.queryPort).toBe(5051);
    });

    it('adds a Siemens machine with port 4840 and no security by default, and never sends back its password', async () => {
      const res = await call('POST', '/api/machines', {
        type: 'siemens', name: 'DNM 6700', host: '192.168.1.70', opcuaUser: 'OpcUaClient', opcuaPassword: 'secret',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ type: 'siemens', opcuaPort: 4840, opcuaUser: 'OpcUaClient', hasOpcuaPassword: true, opcuaSecurity: 'none' });
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });

    it('returns 409 for a second Siemens machine on the same address and OPC UA port', async () => {
      await call('POST', '/api/machines', { type: 'siemens', name: 'M1', host: '192.168.1.70' });
      const res = await call('POST', '/api/machines', { type: 'siemens', name: 'M2', host: '192.168.1.70', opcuaPort: 4840 });
      expect(res.status).toBe(409);
    });

    it('returns 400 for an OPC UA security mode it does not know', async () => {
      const res = await call('POST', '/api/machines', { type: 'siemens', name: 'M', host: '192.168.1.70', opcuaSecurity: 'sign' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('opcuaSecurity');
    });
  });

  describe('GET /api/machine/:id', () => {
    it('returns a specific machine', async () => {
      const machine = await poller.addBrotherMachine({
        name: 'Speedio',
        host: '192.168.1.50'
      });

      const res = await call('GET', `/api/machine/${machine.id}`);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Speedio');
      expect(res.body.type).toBe('brother');
    });

    it('returns 404 for non-existent machine', async () => {
      const res = await call('GET', '/api/machine/non-existent');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('PUT /api/machine/:id', () => {
    it('updates an existing Brother machine', async () => {
      const machine = await poller.addBrotherMachine({
        name: 'Speedio',
        host: '192.168.1.50'
      });

      const res = await call('PUT', `/api/machine/${machine.id}`, { name: 'Speedio Updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Speedio Updated');
    });

    it('updates an existing Haas machine', async () => {
      const machine = await poller.addHaasMachine({
        name: 'VF-2',
        host: '192.168.1.60'
      });

      const res = await call('PUT', `/api/machine/${machine.id}`, { name: 'VF-2 Updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('VF-2 Updated');
    });

    it('returns 404 for non-existent machine', async () => {
      const res = await call('PUT', '/api/machine/non-existent', { name: 'Test' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('updates multiple fields', async () => {
      const machine = await poller.addBrotherMachine({
        name: 'Speedio',
        host: '192.168.1.50'
      });

      const res = await call('PUT', `/api/machine/${machine.id}`, {
          name: 'New Name',
          host: '192.168.1.100',
          ftpPort: 2121
        });

      expect(res.body.name).toBe('New Name');
      expect(res.body.host).toBe('192.168.1.100');
      expect(res.body.ftpPort).toBe(2121);
    });

    it('returns 400 for an IP address that is not valid', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const res = await call('PUT', `/api/machine/${machine.id}`, { host: '999.1.1.1' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid IP address format');
    });

    it('returns 400 for a port that is not a number', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const res = await call('PUT', `/api/machine/${machine.id}`, { ftpPort: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('ftpPort must be a number');
    });
  });

  describe('GET /api/machine/:id/state-timeline', () => {
    it('returns the machine state over the range, from the state periods', async () => {
      vi.useFakeTimers({ now: Date.UTC(2026, 10, 19, 12, 0), toFake: ['Date'] });
      try {
        const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
        const now = Date.now();
        statePeriods.open(machine.id, 'run-state', 'ACTIVE', now - 30 * 60_000);
        statePeriods.open(machine.id, 'alarm', '1001 DOOR OPEN', now - 10 * 60_000);
        statePeriods.close(machine.id, 'alarm', now - 5 * 60_000);

        const res = await call('GET', `/api/machine/${machine.id}/state-timeline?range=-1h`);

        const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          machineId: machine.id, range: '-1h', from: at(60), to: at(0), more: false,
          data: [
            { state: 'offline', start: at(60), end: at(30) },
            { state: 'running', start: at(30), end: at(10) },
            { state: 'alarm', start: at(10), end: at(5), detail: '1001 DOOR OPEN' },
            { state: 'running', start: at(5), end: at(0) },
          ],
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows the last 24 hours when no range is given', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const res = await call('GET', `/api/machine/${machine.id}/state-timeline`);

      expect(res.body.range).toBe('-24h');
      expect(res.body.data.map((segment: { state: string }) => segment.state)).toEqual(['offline']);
    });

    it('returns 404 for an unknown machine, and 400 for a bad range', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const badRange = await call('GET', `/api/machine/${machine.id}/state-timeline?range=yesterday`);
      const noMachine = await call('GET', '/api/machine/nonexistent/state-timeline');

      expect(badRange.status).toBe(400);
      expect(noMachine.status).toBe(404);
    });

    it('shows the time before `end` when it is given, so the chart can go back in time', async () => {
      vi.useFakeTimers({ now: Date.UTC(2026, 10, 19, 12, 0), toFake: ['Date'] });
      try {
        const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
        statePeriods.open(machine.id, 'run-state', 'START', Date.UTC(2026, 10, 19, 9, 0));
        statePeriods.close(machine.id, 'run-state', Date.UTC(2026, 10, 19, 10, 0));

        const res = await call('GET', `/api/machine/${machine.id}/state-timeline?range=-1h&end=2026-11-19T10:30:00.000Z`);

        expect(res.body).toMatchObject({ from: '2026-11-19T09:30:00.000Z', to: '2026-11-19T10:30:00.000Z' });
        expect(res.body.data.map((segment: { state: string }) => segment.state)).toEqual(['running', 'offline']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('treats an `end` in the future as now, and returns 400 for an `end` that is not a time', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const future = await call('GET', `/api/machine/${machine.id}/state-timeline?range=-1h&end=2999-01-01T00:00:00.000Z`);
      const bad = await call('GET', `/api/machine/${machine.id}/state-timeline?range=-1h&end=yesterday`);
      // Without a zone, the time would be the local time of the server
      const noZone = await call('GET', `/api/machine/${machine.id}/state-timeline?range=-1h&end=2026-11-19T10:30:00`);
      const offset = await call('GET', `/api/machine/${machine.id}/state-timeline?range=-1h&end=2026-11-19T10:30:00%2B01:00`);

      expect(Date.parse(future.body.to)).toBeLessThanOrEqual(Date.now());
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('end must be a time with a zone, such as 2026-11-19T15:00:00Z');
      expect(noZone.status).toBe(400);
      expect(offset.body.to).toBe('2026-11-19T09:30:00.000Z');
    });

    it('returns 400 for a range longer than 31 days', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const tooLong = await call('GET', `/api/machine/${machine.id}/state-timeline?range=-32d`);
      const longest = await call('GET', `/api/machine/${machine.id}/state-timeline?range=-31d`);

      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error).toBe('range can go back at most 31 days');
      expect(longest.status).toBe(200);
    });
  });

  describe('GET /api/machine/:id/periods', () => {
    it('returns the state periods of the last day, newest first', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const hourAgo = Date.now() - 3_600_000;
      statePeriods.open(machine.id, 'program', 'O1', hourAgo);
      statePeriods.close(machine.id, 'program', hourAgo + 60_000);
      statePeriods.open(machine.id, 'program', 'O2', hourAgo + 60_000);
      statePeriods.open(machine.id, 'tool', '3', Date.now() - 3 * 86_400_000);
      statePeriods.close(machine.id, 'tool', Date.now() - 2 * 86_400_000);

      const res = await call('GET', `/api/machine/${machine.id}/periods`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        machineId: machine.id, range: '-1d', more: false,
        data: [
          { kind: 'program', value: 'O2', start: new Date(hourAgo + 60_000).toISOString(), end: null },
          { kind: 'program', value: 'O1', start: new Date(hourAgo).toISOString(), end: new Date(hourAgo + 60_000).toISOString() },
        ],
      });
    });

    it('returns only one kind when it is asked', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      statePeriods.open(machine.id, 'program', 'O1', Date.now() - 1000);
      statePeriods.open(machine.id, 'alarm', '1001', Date.now() - 1000);

      const res = await call('GET', `/api/machine/${machine.id}/periods?range=-1h&kind=alarm`);

      expect(res.body.data.map((period: { kind: string }) => period.kind)).toEqual(['alarm']);
    });

    it('returns 400 for an unknown kind, and 404 for an unknown machine', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const badKind = await call('GET', `/api/machine/${machine.id}/periods?kind=spindle`);
      const noMachine = await call('GET', '/api/machine/nonexistent/periods');

      expect(badKind.status).toBe(400);
      expect(badKind.body.error).toContain('kind must be one of: program');
      expect(noMachine.status).toBe(404);
    });
  });

  describe('GET /api/machine/:id/report', () => {
    it('returns the time watched, online and running, the parts made, and the alarms of the last day', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      history.stateTime.mockImplementation(async ({ metric }) =>
        (metric === 'chatter_connected' ? { onMs: 7_000_000, knownMs: 8_000_000 } : { onMs: 5_000_000, knownMs: 7_000_000 }));
      history.rangeIncrease.mockResolvedValue(42);
      const hourAgo = Date.now() - 3_600_000;
      statePeriods.open(machine.id, 'alarm', '1001 DOOR OPEN', hourAgo);
      statePeriods.close(machine.id, 'alarm', hourAgo + 60_000);

      const res = await call('GET', `/api/machine/${machine.id}/report`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        machineId: machine.id, range: '-1d', watchedMs: 8_000_000, onlineMs: 7_000_000, runningMs: 5_000_000, partsMade: 42,
        alarms: { count: 1, totalMs: 60_000, values: [{ value: '1001 DOOR OPEN', count: 1, totalMs: 60_000 }] },
      });
      expect(Date.parse(res.body.to) - Date.parse(res.body.from)).toBe(86_400_000);
    });

    it('asks for a range that ends one whole minute ago, because vmalert saves a minute average up to 1 minute late', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const startOfMinute = Math.floor(Date.now() / 60_000) * 60_000;
      vi.useFakeTimers({ toFake: ['Date'], now: startOfMinute + 20_000 });

      try {
        await call('GET', `/api/machine/${machine.id}/report?range=-7d`);
      } finally {
        vi.useRealTimers();
      }

      const [{ metric, machineId, from, to }] = history.rangeIncrease.mock.calls[0];
      expect({ metric, machineId }).toEqual({ metric: 'chatter_part_count', machineId: machine.id });
      expect(to).toBe(startOfMinute - 60_000);
      expect(to - from).toBe(7 * 86_400_000);
    });

    it('returns null for a value that the machine does not send', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const res = await call('GET', `/api/machine/${machine.id}/report`);

      expect(res.body).toMatchObject({ watchedMs: null, onlineMs: null, runningMs: null, partsMade: null });
    });

    it('returns 503 when the history cannot be read, 400 for a bad range, and 404 for an unknown machine', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      history.stateTime.mockRejectedValue(new Error('connection refused'));

      expect((await call('GET', `/api/machine/${machine.id}/report`)).status).toBe(503);
      expect((await call('GET', `/api/machine/${machine.id}/report?range=1d`)).status).toBe(400);
      expect((await call('GET', `/api/machine/${machine.id}/report?range=-30s`)).status).toBe(400);
      expect((await call('GET', `/api/machine/${machine.id}/report?range=-53w`)).status).toBe(400);
      expect((await call('GET', '/api/machine/nonexistent/report')).status).toBe(404);
    });
  });

  describe('GET /api/alerts', () => {
    function alert(values: Partial<Alert>): Alert {
      const now = Date.now();
      return {
        name: 'SpindleTooFast', machineId: 'm1', labels: { alertname: 'SpindleTooFast', machine: 'm1' },
        annotations: { summary: 'Spindle speed is 9000' }, startsAt: now - 60_000, endsAt: now + 60_000, resolved: false, ...values,
      };
    }

    it('returns the alerts of the last week, newest first, and no end time for an alert that fires', async () => {
      const now = Date.now();
      alerts.save([
        alert({ startsAt: now - 3_600_000, endsAt: now - 1_800_000, resolved: true }),
        alert({ startsAt: now - 60_000, endsAt: now + 60_000 }),
        alert({ startsAt: now - 9 * 86_400_000, endsAt: now - 8 * 86_400_000, resolved: true }),
      ], now);

      const res = await call('GET', '/api/alerts');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        range: '-7d', more: false,
        data: [
          { name: 'SpindleTooFast', machineId: 'm1', labels: { alertname: 'SpindleTooFast', machine: 'm1' },
            annotations: { summary: 'Spindle speed is 9000' }, start: new Date(now - 60_000).toISOString(), end: null, firing: true },
          { name: 'SpindleTooFast', machineId: 'm1', labels: { alertname: 'SpindleTooFast', machine: 'm1' },
            annotations: { summary: 'Spindle speed is 9000' }, start: new Date(now - 3_600_000).toISOString(),
            end: new Date(now - 1_800_000).toISOString(), firing: false },
        ],
      });
    });

    it('returns only the alerts that fire, of one machine, when asked', async () => {
      const now = Date.now();
      alerts.save([
        alert({ name: 'Ended', endsAt: now - 1000, resolved: true, labels: { alertname: 'Ended' } }),
        alert({ name: 'Other machine', machineId: 'm2', labels: { alertname: 'Other machine' } }),
        alert({ name: 'Firing', labels: { alertname: 'Firing' } }),
      ], now);

      const res = await call('GET', '/api/alerts?state=firing&machine=m1');

      expect(res.body.data.map((found: { name: string }) => found.name)).toEqual(['Firing']);
    });

    it('shows an alert as firing in the grace time after its end time, like the messages, until vmalert says that it ended', async () => {
      const now = Date.now();
      alerts.save([alert({ name: 'Late', startsAt: now - 120_000, endsAt: now - 60_000, labels: { alertname: 'Late' } })], now);
      expect((await call('GET', '/api/alerts')).body.data).toMatchObject([{ name: 'Late', firing: true, end: null }]);

      alerts.save([alert({ name: 'Late', startsAt: now - 120_000, endsAt: now - 30_000, resolved: true, labels: { alertname: 'Late' } })], now);
      expect((await call('GET', '/api/alerts')).body.data).toMatchObject([
        { name: 'Late', firing: false, end: new Date(now - 30_000).toISOString() },
      ]);
    });

    it('returns 400 for an unknown state', async () => {
      const res = await call('GET', '/api/alerts?state=open');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('state must be "firing" or "all"');
    });

    it('needs a login', async () => {
      expect((await app.request('/api/alerts')).status).toBe(401);
    });
  });

  describe('GET /api/machine/:id/history/:value', () => {
    it('returns the spindle speed history of a machine', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const time = Date.UTC(2026, 10, 9, 9, 0);
      history.windowAverages.mockResolvedValue([{ time, value: 8000 }]);

      const res = await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-5m&window=10s`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        machineId: machine.id, value: 'spindle-speed', range: '-5m', window: '10s',
        data: [{ time: new Date(time).toISOString(), value: 8000 }],
      });
    });

    it('reads the metric of the value in the address', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const res = await call('GET', `/api/machine/${machine.id}/history/part-count`);

      expect(res.status).toBe(200);
      expect(history.windowAverages.mock.calls[0][0].metric).toBe('chatter_part_count');
    });

    it('asks for the last value in each window of the tool number, and the average of the spindle speed', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      await call('GET', `/api/machine/${machine.id}/history/tool-number`);
      await call('GET', `/api/machine/${machine.id}/history/spindle-speed`);

      expect(history.windowAverages.mock.calls.map(([query]) => query.windowValue)).toEqual(['last', 'average']);
    });

    it('counts the extra window at the start in the most points of one reply', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const tooMany = await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-5000s&window=1s`);
      const most = await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-4999s&window=1s`);

      expect([tooMany.status, most.status]).toEqual([400, 200]);
    });

    it('returns 400 for a value that has no history', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const res = await call('GET', `/api/machine/${machine.id}/history/program`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('value must be one of: spindle-speed');
      expect(history.windowAverages).not.toHaveBeenCalled();
    });

    it('asks for whole windows of the spindle speed of that machine', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-5m&window=10s`);

      const query = history.windowAverages.mock.calls[0][0];
      expect(query).toMatchObject({ metric: 'chatter_spindle_speed', machineId: machine.id, windowMs: 10_000 });
      expect(query.from % 10_000).toBe(0);
      expect(query.to - query.from).toBeGreaterThanOrEqual(5 * 60_000);
    });

    it('reads the windows before `end` when it is given', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-10m&window=10s&end=2026-11-19T10:30:00.000Z`);

      const query = history.windowAverages.mock.calls[0][0];
      expect(query.to).toBe(Date.UTC(2026, 10, 19, 10, 30));
      expect(query.from).toBe(Date.UTC(2026, 10, 19, 10, 20));
    });

    it('reads an `end` with an offset as that time, and an `end` in the future as now', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-10m&window=10s&end=2026-11-19T10:30:00%2B01:00`);
      await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-10m&window=10s&end=2999-01-01T00:00:00Z`);

      expect(history.windowAverages.mock.calls[0][0].to).toBe(Date.UTC(2026, 10, 19, 9, 30));
      expect(history.windowAverages.mock.calls[1][0].to).toBeLessThanOrEqual(Date.now());
    });

    it('returns 400 for an `end` that is not a time with a zone', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const bad = await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-10m&end=yesterday`);
      const noZone = await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-10m&end=2026-11-19T10:30:00`);

      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('end must be a time with a zone, such as 2026-11-19T15:00:00Z');
      expect(noZone.status).toBe(400);
      expect(history.windowAverages).not.toHaveBeenCalled();
    });

    it('returns 503 when the history cannot be read', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      history.windowAverages.mockRejectedValue(new Error('fetch failed'));

      const res = await call('GET', `/api/machine/${machine.id}/history/spindle-speed`);

      expect(res.status).toBe(503);
      expect(res.body.error).toContain('not available');
    });

    it('chooses a window that gives at most 1000 points when none is given', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const res = await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-1d`);

      expect(res.body.window).toBe('5m');
      expect(res.body.data).toEqual([]);
    });

    it('returns 404 for an unknown machine', async () => {
      const res = await call('GET', '/api/machine/nonexistent/history/spindle-speed');

      expect(res.status).toBe(404);
    });

    it('returns 400 for a window that gives too many points', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const res = await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-1d&window=1s`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('The window is too small');
    });

    it('returns 400 for a range that is too long for any window', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });

      const res = await call('GET', `/api/machine/${machine.id}/history/spindle-speed?range=-99999w`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('The range is too long');
    });

    it('returns 400 for a range that is not a plain duration', async () => {
      const res = await call('GET', '/api/machine/any/history/spindle-speed?range=-1h) |> drop()');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('range must look like -1h');
    });

    it('returns 400 for a window of zero', async () => {
      const res = await call('GET', '/api/machine/any/history/spindle-speed?window=0s');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('window must look like 10s');
    });
  });

  describe('DELETE /api/machine/:id', () => {
    it('removes an existing machine', async () => {
      const machine = await poller.addBrotherMachine({
        name: 'Speedio',
        host: '192.168.1.50'
      });

      const res = await call('DELETE', `/api/machine/${machine.id}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('removed');
    });

    it('returns 404 for non-existent machine', async () => {
      const res = await call('DELETE', '/api/machine/non-existent');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('GET /api/machine/:id/files', () => {
    it('returns 404 for non-existent machine', async () => {
      const res = await call('GET', '/api/machine/non-existent/files');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    // Each folder level is a LIST on the machine, so a deep tree can keep the machine and Chatter busy for a long time
    it.each(['0', '6', '50', '99999999999', 'abc', '-1', '1.5'])('refuses depth=%s and sends nothing to the machine', async depth => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      // A mock, so a test that fails does not wait for a machine that is not there
      const readFileTree = vi.spyOn(poller.getConnector(machine.id)!, 'readFileTree').mockResolvedValue({ nodes: [], isCutShort: false });

      const res = await call('GET', `/api/machine/${machine.id}/files?depth=${depth}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('depth must be a whole number from 1 to 5');
      expect(readFileTree).not.toHaveBeenCalled();
    });

    it.each([['1', 1], ['3', 3], ['5', 5]])('lists the tree for depth=%s', async (depth, expectedDepth) => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const readFileTree = vi.spyOn(poller.getConnector(machine.id)!, 'readFileTree').mockResolvedValue({ nodes: [], isCutShort: false });

      const res = await call('GET', `/api/machine/${machine.id}/files?path=/PRG&depth=${depth}`);

      expect(res.status).toBe(200);
      expect(readFileTree).toHaveBeenCalledWith('/PRG', expectedDepth, expect.any(AbortSignal));
    });

    // The web app shows a note when the list is cut short. The body stays a plain list, as the API docs show it.
    const PROGRAM: FTPTreeNode = { name: 'O1000', type: 'file', size: 10, path: '/O1000' };

    it('tells the web app in a header when the list was cut short', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'readFileTree').mockResolvedValue({ nodes: [PROGRAM], isCutShort: true });

      const res = await send(`/api/machine/${machine.id}/files`, { method: 'GET' });

      expect(res.status).toBe(200);
      expect(res.headers.get(FILE_LIST_CUT_SHORT_HEADER)).toBe('true');
      expect(await res.json()).toEqual([PROGRAM]);
    });

    // The connector must pass the flag of the FTP client on to the route
    it('sends the cut-short header when the FTP client cut the list short', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const { ftpClient } = poller.getConnector(machine.id) as unknown as { ftpClient: FTPClient };
      const readFileTree = vi.spyOn(ftpClient, 'readFileTree').mockResolvedValue({ nodes: [PROGRAM], isCutShort: true });

      const res = await send(`/api/machine/${machine.id}/files?depth=2`, { method: 'GET' });

      expect(res.status).toBe(200);
      expect(res.headers.get(FILE_LIST_CUT_SHORT_HEADER)).toBe('true');
      expect(await res.json()).toEqual([PROGRAM]);
      expect(readFileTree).toHaveBeenCalledWith('.', 2, expect.any(AbortSignal));
    });

    it('sends no cut-short header for a full list', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'readFileTree').mockResolvedValue({ nodes: [PROGRAM], isCutShort: false });

      const res = await send(`/api/machine/${machine.id}/files`, { method: 'GET' });

      expect(res.status).toBe(200);
      expect(res.headers.get(FILE_LIST_CUT_SHORT_HEADER)).toBeNull();
      expect(await res.json()).toEqual([PROGRAM]);
    });
  });

  describe('GET /api/machine/:id/files/download', () => {
    it('returns 400 when path is missing', async () => {
      const machine = await poller.addBrotherMachine({
        name: 'Speedio',
        host: '192.168.1.50'
      });

      const res = await call('GET', `/api/machine/${machine.id}/files/download`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('path');
    });

    it('returns 404 for non-existent machine', async () => {
      const res = await call('GET', '/api/machine/non-existent/files/download?path=/test.nc');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/machine/:id/files/upload', () => {
    it('returns 400 when no file provided', async () => {
      const machine = await poller.addBrotherMachine({
        name: 'Speedio',
        host: '192.168.1.50'
      });

      const res = await call('POST', `/api/machine/${machine.id}/files/upload`, uploadForm({ path: '/test.nc' }));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('file');
    });

    it('returns 400 when path is missing', async () => {
      const machine = await poller.addBrotherMachine({
        name: 'Speedio',
        host: '192.168.1.50'
      });

      const res = await call('POST', `/api/machine/${machine.id}/files/upload`, uploadForm({ withFile: true }));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('path');
    });

    it('returns 404 for non-existent machine', async () => {
      const res = await call('POST', '/api/machine/non-existent/files/upload', uploadForm({ withFile: true, path: '/test.nc' }));

      expect(res.status).toBe(404);
    });
  });

  describe('the size limit of program uploads', () => {
    // A Pi has only 512 MB, and the server holds each file in memory while it sends it
    it.each(['upload', 'upload-batch'])('refuses a %s body that is larger than the limit, before it reads it', async route => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const uploadFile = vi.spyOn(poller.getConnector(machine.id)!, 'uploadFile');
      const uploadFiles = vi.spyOn(poller.getConnector(machine.id)!, 'uploadFiles');

      const res = await send(`/api/machine/${machine.id}/files/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(PROGRAM_UPLOAD_LIMIT_BYTES + 1) },
        body: '--x--',
      });

      expect(res.status).toBe(413);
      expect(((await res.json()) as { error: string }).error).toBe('The files are too large. Send at most 32 MB at one time.');
      expect(uploadFile).not.toHaveBeenCalled();
      expect(uploadFiles).not.toHaveBeenCalled();
    });

    it('stops reading a body with no length at the limit', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const uploadFiles = vi.spyOn(poller.getConnector(machine.id)!, 'uploadFiles');
      const chunk = new Uint8Array(1024 * 1024);
      let sent = 0;
      // A stream with no Content-Length, as a client sends when it does not say the size first
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent > PROGRAM_UPLOAD_LIMIT_BYTES * 2) return controller.close();
          sent += chunk.length;
          controller.enqueue(chunk);
        },
      });

      const res = await send(`/api/machine/${machine.id}/files/upload-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
        body,
        duplex: 'half',
      } as RequestInit);

      expect(res.status).toBe(413);
      expect(sent).toBeLessThan(PROGRAM_UPLOAD_LIMIT_BYTES * 2);
      expect(uploadFiles).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/machine/:id/files', () => {
    it('returns 400 when path is missing', async () => {
      const machine = await poller.addBrotherMachine({
        name: 'Speedio',
        host: '192.168.1.50'
      });

      const res = await call('DELETE', `/api/machine/${machine.id}/files`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('path');
    });

    it('returns 404 for non-existent machine', async () => {
      const res = await call('DELETE', '/api/machine/non-existent/files?path=/test.nc');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/machine/:id/uploads', () => {
    it('returns upload files from database', async () => {
      const mockFiles = [
        { id: 1, file_name: 'part1.nc', event_count: '3' },
        { id: 2, file_name: 'part2.nc', event_count: '1' },
      ];
      vi.mocked(getUploadFiles).mockResolvedValue(mockFiles as never);

      const res = await call('GET', '/api/machine/machine1/uploads');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockFiles);
      expect(getUploadFiles).toHaveBeenCalledWith('machine1', 50);
    });

    it('respects limit parameter', async () => {
      vi.mocked(getUploadFiles).mockResolvedValue([]);

      await call('GET', '/api/machine/machine1/uploads?limit=10');

      expect(getUploadFiles).toHaveBeenCalledWith('machine1', 10);
    });
  });

  describe('GET /api/machine/:id/uploads/:fileId/events', () => {
    it('returns events for a file', async () => {
      const mockEvents = [
        { id: 1, target_name: 'O0100.NC', remote_path: '/TEST/O0100.NC' },
      ];
      vi.mocked(getUploadEvents).mockResolvedValue(mockEvents as never);

      const res = await call('GET', '/api/machine/machine1/uploads/42/events');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockEvents);
      expect(getUploadEvents).toHaveBeenCalledWith('machine1', 42);
    });

    it.each(['abc', '0', '007', '-1', '1.5', '12345678901234567'])('returns 400 when the file id is %s', async fileId => {
      const res = await call('GET', `/api/machine/machine1/uploads/${fileId}/events`);

      expect(res.status).toBe(400);
      expect(getUploadEvents).not.toHaveBeenCalled();
    });

    it('accepts the largest file id, 16 digits', async () => {
      const res = await call('GET', '/api/machine/machine1/uploads/1234567890123456/events');

      expect(res.status).toBe(200);
      expect(getUploadEvents).toHaveBeenCalledWith('machine1', 1234567890123456);
    });
  });

  describe('GET /api/machine/:id/uploads/events/:eventId', () => {
    it('returns event with content', async () => {
      const mockEvent = {
        id: 1,
        file_name: 'test.nc',
        file_content: 'G00 X0 Y0'
      };
      vi.mocked(getUploadEventById).mockResolvedValue(mockEvent as never);

      const res = await call('GET', '/api/machine/machine1/uploads/events/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockEvent);
      expect(getUploadEventById).toHaveBeenCalledWith('machine1', 1);
    });

    it('returns 400 when the event id is not a whole number', async () => {
      const res = await call('GET', '/api/machine/machine1/uploads/events/1;DROP');

      expect(res.status).toBe(400);
      expect(getUploadEventById).not.toHaveBeenCalled();
    });

    it('returns 404 when event not found', async () => {
      vi.mocked(getUploadEventById).mockResolvedValue(null);

      const res = await call('GET', '/api/machine/machine1/uploads/events/999');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('file transfer through the connector', () => {
    it('downloads a file as an attachment', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'downloadFile')
        .mockImplementation(async (_path, output) => { output.write('G00 X0'); });

      const res = await send(`/api/machine/${machine.id}/files/download?path=/PRG/O1000.NC`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="O1000.NC"; filename*=UTF-8''O1000.NC`);
      expect(await res.text()).toBe('G00 X0');
    });

    it('downloads a file whose name has a quote and letters outside ASCII', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'downloadFile')
        .mockImplementation(async (_path, output) => { output.write('G00 X0'); });

      const res = await send(`/api/machine/${machine.id}/files/download?path=${encodeURIComponent('/PRG/Teil "A" €.nc')}`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition'))
        .toBe(`attachment; filename="Teil _A_ _.nc"; filename*=UTF-8''Teil%20%22A%22%20%E2%82%AC.nc`);
    });

    it('logs one line when the download fails in the middle, and stops the file', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'downloadFile').mockImplementation(async (_path, output) => {
        output.write('G00 X0');
        throw new Error('FTP download error: connection reset');
      });
      const log = captureLog();

      const res = await send(`/api/machine/${machine.id}/files/download?path=/PRG/O1000.NC`);
      const failure = await res.text().then(() => null, (error: Error) => error);
      log.restore();

      expect(res.status).toBe(200);
      expect(failure?.message).toBe(STREAM_STOPPED_TEXT);
      expect(log.lines.filter(line => line.level === 'error')).toHaveLength(1);
      expect(log.text('error')).toContain('connection reset');
    });

    it('returns 500 when the machine refuses the download', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'downloadFile')
        .mockRejectedValue(new Error('FTP download error: 550'));

      const res = await call('GET', `/api/machine/${machine.id}/files/download?path=/PRG/O1000.NC`);

      expect(res.status).toBe(500);
      // The reply of the machine tells the user what went wrong
      expect(res.body.error).toContain('550');
    });

    it('keeps the text of the machine when it refuses to delete a file, and logs it', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'deleteFile').mockRejectedValue(new Error('FTP delete error: 550 Permission denied'));
      const log = captureLog();

      const res = await call('DELETE', `/api/machine/${machine.id}/files?path=/PRG/O1000.NC`);
      log.restore();

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('FTP delete error: 550 Permission denied');
      expect(log.text('error')).toContain('550 Permission denied');
    });

    // The signal of the request takes a waiting delete out of the queue when the browser leaves
    it('gives the signal of the request to the delete', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const deleteFile = vi.spyOn(poller.getConnector(machine.id)!, 'deleteFile').mockResolvedValue();

      const res = await call('DELETE', `/api/machine/${machine.id}/files?path=/PRG/O1000.NC`);

      expect(res.status).toBe(200);
      expect(deleteFile).toHaveBeenCalledWith('/PRG/O1000.NC', expect.any(AbortSignal));
    });

    it('uploads one file and records it', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const uploadFile = vi.spyOn(poller.getConnector(machine.id)!, 'uploadFile').mockResolvedValue();
      const form = uploadForm({ withFile: true, path: '/PRG/O1000.NC' });
      form.append('overwrite', 'true');

      const res = await call('POST', `/api/machine/${machine.id}/files/upload`, form);

      expect(res.status).toBe(200);
      expect(uploadFile).toHaveBeenCalledWith('/PRG/O1000.NC', Buffer.from('test'), true, expect.any(AbortSignal));
      expect(recordUpload).toHaveBeenCalledWith(machine.id, 'test.nc', 'test.nc', '/PRG/O1000.NC', 'test', { username: 'admin', address: 'unknown' });
    });

    it('replies with success when the file is on the machine but the upload history cannot be saved, and logs the error', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'uploadFile').mockResolvedValue();
      vi.mocked(recordUpload).mockRejectedValueOnce(new Error('SQLITE_FULL: database or disk is full'));
      const log = captureLog();

      const res = await call('POST', `/api/machine/${machine.id}/files/upload`, uploadForm({ withFile: true, path: '/PRG/O1000.NC' }));
      log.restore();

      expect(res.status).toBe(200);
      expect(res.body.path).toBe('/PRG/O1000.NC');
      expect(JSON.stringify(res.body)).not.toContain('SQLITE');
      expect(log.lines.filter(line => line.level === 'error')).toHaveLength(1);
      expect(log.text('error')).toContain('SQLITE_FULL');
    });

    it('returns 409 when the file already exists', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'uploadFile')
        .mockRejectedValue(new Error('File already exists: /PRG/O1000.NC'));

      const res = await call('POST', `/api/machine/${machine.id}/files/upload`, uploadForm({ withFile: true, path: '/PRG/O1000.NC' }));

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/machine/:id/files/upload-batch', () => {
    it('sends each file with its name on the machine', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const uploadFiles = vi.spyOn(poller.getConnector(machine.id)!, 'uploadFiles')
        .mockResolvedValue({ success: [{ remotePath: '/PRG/O0100.NC' }, { remotePath: '/PRG/b.nc' }], failed: [] });
      const form = new FormData();
      form.append('files', new File(['G00'], 'a.nc'));
      form.append('files', new File(['G01'], 'b.nc'));
      form.append('basePath', '/PRG');
      form.append('targetNames', JSON.stringify({ 'a.nc': 'O0100.NC' }));

      const res = await call('POST', `/api/machine/${machine.id}/files/upload-batch`, form);

      expect(res.status).toBe(200);
      expect(uploadFiles).toHaveBeenCalledWith(
        [
          { remotePath: '/PRG/O0100.NC', source: Buffer.from('G00') },
          { remotePath: '/PRG/b.nc', source: Buffer.from('G01') },
        ],
        false,
        expect.any(AbortSignal),
      );
      expect(res.body.success).toEqual([
        { filename: 'a.nc', targetName: 'O0100.NC', path: '/PRG/O0100.NC' },
        { filename: 'b.nc', targetName: 'b.nc', path: '/PRG/b.nc' },
      ]);
    });

    it('replies with the sent files when the upload history cannot be saved, and logs the error', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'uploadFiles').mockResolvedValue({ success: [{ remotePath: '/PRG/a.nc' }], failed: [] });
      vi.mocked(recordUpload).mockRejectedValueOnce(new Error('SQLITE_FULL: database or disk is full'));
      const form = new FormData();
      form.append('files', new File(['G00'], 'a.nc'));
      form.append('basePath', '/PRG');
      const log = captureLog();

      const res = await call('POST', `/api/machine/${machine.id}/files/upload-batch`, form);
      log.restore();

      expect(res.status).toBe(200);
      expect(res.body.success).toEqual([{ filename: 'a.nc', targetName: 'a.nc', path: '/PRG/a.nc' }]);
      expect(JSON.stringify(res.body)).not.toContain('SQLITE');
      expect(log.lines.filter(line => line.level === 'error')).toHaveLength(1);
      expect(log.text('error')).toContain('SQLITE_FULL');
    });

    it('returns 400 when no files are given', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const form = new FormData();
      form.append('basePath', '/PRG');

      const res = await call('POST', `/api/machine/${machine.id}/files/upload-batch`, form);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No files');
    });
  });

  // FTP sends each path in a command line. A line break in a path would add a second command, for example DELE.
  describe('control characters in a path on the machine', () => {
    const CONTROL_CHARACTER_ERROR = 'A path or a file name on the machine cannot have a line break or another control character';
    const BAD_PATHS = ['O1000\r\nDELE O1234', 'O1000\nDELE O1234', 'O1000\0', 'O1000\tX', 'O1000\x7f'];
    /** The error of a body that the FormData parser of Node 22 cannot read */
    const MALFORMED_FORM_DATA = 'Malformed FormData';

    async function brotherConnector() {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      return { id: machine.id, connector: poller.getConnector(machine.id)! };
    }

    function batchForm({ basePath = '/PRG', targetNames, fileName = 'a.nc' }: { basePath?: string; targetNames?: string; fileName?: string }) {
      const form = new FormData();
      form.append('files', new File(['G00'], fileName));
      form.append('basePath', basePath);
      if (targetNames !== undefined) form.append('targetNames', targetNames);
      return form;
    }

    // A raw multipart body, because a File object cannot set the encoded file name that a client can send.
    function sendBatchWithFileName(fileNameParameter: string, id: string) {
      const body = [
        '--x', `Content-Disposition: form-data; name="files"; ${fileNameParameter}`, '', 'G00',
        '--x', 'Content-Disposition: form-data; name="basePath"', '', '/PRG',
        '--x--', '',
      ].join('\r\n');
      return send(`/api/machine/${id}/files/upload-batch`, {
        method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body,
      });
    }

    it.each(BAD_PATHS)('refuses a download of %j and sends nothing to the machine', async path => {
      const { id, connector } = await brotherConnector();
      const downloadFile = vi.spyOn(connector, 'downloadFile');

      const res = await call('GET', `/api/machine/${id}/files/download?path=${encodeURIComponent(path)}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(CONTROL_CHARACTER_ERROR);
      expect(downloadFile).not.toHaveBeenCalled();
    });

    it.each(BAD_PATHS)('refuses a file list of the folder %j', async path => {
      const { id, connector } = await brotherConnector();
      const readFileTree = vi.spyOn(connector, 'readFileTree').mockResolvedValue({ nodes: [], isCutShort: false });

      const res = await call('GET', `/api/machine/${id}/files?path=${encodeURIComponent(`/PRG/${path}`)}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(CONTROL_CHARACTER_ERROR);
      expect(readFileTree).not.toHaveBeenCalled();
    });

    it.each(BAD_PATHS)('refuses a delete of %j', async path => {
      const { id, connector } = await brotherConnector();
      const deleteFile = vi.spyOn(connector, 'deleteFile');

      const res = await call('DELETE', `/api/machine/${id}/files?path=${encodeURIComponent(path)}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(CONTROL_CHARACTER_ERROR);
      expect(deleteFile).not.toHaveBeenCalled();
    });

    it.each([
      ['path', { path: 'O1000\r\nDELE O1234' }],
      ['targetName', { path: '/PRG/O1000.NC', targetName: 'O1000\r\nDELE O1234' }],
    ])('refuses an upload with a line break in the %s', async (_field, fields: Record<string, string>) => {
      const { id, connector } = await brotherConnector();
      const uploadFile = vi.spyOn(connector, 'uploadFile');
      const form = uploadForm({ withFile: true });
      for (const [name, value] of Object.entries(fields)) form.append(name, value);

      const res = await call('POST', `/api/machine/${id}/files/upload`, form);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(CONTROL_CHARACTER_ERROR);
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it.each([
      ['a basePath with a line break', { basePath: '/PRG\r\nDELE O1234' }, CONTROL_CHARACTER_ERROR],
      ['a name on the machine with a line break', { targetNames: JSON.stringify({ 'a.nc': 'O1\r\nDELE O1234' }) }, CONTROL_CHARACTER_ERROR],
      ['a file name key with a line break', { targetNames: JSON.stringify({ 'a.nc\r\nDELE O1234': 'O1' }) }, CONTROL_CHARACTER_ERROR],
      ['targetNames that are null', { targetNames: 'null' }, 'targetNames must give a name on the machine for each file name'],
      ['targetNames that are a list', { targetNames: '["O1"]' }, 'targetNames must give a name on the machine for each file name'],
      ['a name on the machine that is not text', { targetNames: '{"a.nc":5}' }, 'targetNames must give a name on the machine for each file name'],
      ['targetNames that are not JSON', { targetNames: '{a.nc' }, 'targetNames must be JSON text'],
    ])('refuses a batch upload with %s', async (_case, fields, error) => {
      const { id, connector } = await brotherConnector();
      const uploadFiles = vi.spyOn(connector, 'uploadFiles');

      const res = await call('POST', `/api/machine/${id}/files/upload-batch`, batchForm(fields));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(error);
      expect(uploadFiles).not.toHaveBeenCalled();
    });

    // The file name goes into the path when targetNames gives no other name. The FormData parser decodes
    // %0D%0A in a quoted filename to a line break on each Node version, so the route must refuse it.
    it('refuses a batch upload of a file whose own name has a line break', async () => {
      const { id, connector } = await brotherConnector();
      const uploadFiles = vi.spyOn(connector, 'uploadFiles');

      const res = await sendBatchWithFileName('filename="O1%0D%0ADELE%20O1234"', id);

      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(CONTROL_CHARACTER_ERROR);
      expect(uploadFiles).not.toHaveBeenCalled();
    });

    // Node 24 decodes filename* to a line break, and the route refuses it. Node 22 cannot parse filename*,
    // and refuses the body as malformed. Each way, no file goes to the machine.
    it('refuses a batch upload of a file whose filename* has a line break', async () => {
      const { id, connector } = await brotherConnector();
      const uploadFiles = vi.spyOn(connector, 'uploadFiles');

      const res = await sendBatchWithFileName("filename*=utf-8''O1%0D%0ADELE%20O1234", id);

      expect(res.status).toBe(400);
      const { error } = (await res.json()) as { error: string };
      // When the body parses, only the check of the route can give the 400
      if (!error.includes(MALFORMED_FORM_DATA)) expect(error).toBe(CONTROL_CHARACTER_ERROR);
      expect(uploadFiles).not.toHaveBeenCalled();
    });

    it('sends a file named "constructor" with its own name, not a name from the object prototype', async () => {
      const { id, connector } = await brotherConnector();
      const uploadFiles = vi.spyOn(connector, 'uploadFiles').mockResolvedValue({ success: [], failed: [] });

      const res = await call('POST', `/api/machine/${id}/files/upload-batch`, batchForm({ fileName: 'constructor', targetNames: '{}' }));

      expect(res.status).toBe(200);
      expect(uploadFiles).toHaveBeenCalledWith([{ remotePath: '/PRG/constructor', source: Buffer.from('G00') }], false, expect.any(AbortSignal));
    });

    it('keeps a path with spaces, dots and letters outside ASCII', async () => {
      const { id, connector } = await brotherConnector();
      const downloadFile = vi.spyOn(connector, 'downloadFile').mockImplementation(async (_path, output) => { output.end(); });

      const res = await send(`/api/machine/${id}/files/download?path=${encodeURIComponent('/PRG/Teil A €.v2.nc')}`);

      expect(res.status).toBe(200);
      expect(downloadFile).toHaveBeenCalledWith('/PRG/Teil A €.v2.nc', expect.anything(), expect.any(AbortSignal));
    });
  });

  describe('GET /api/events', () => {
    it('sends the full machine list first', async () => {
      await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      // The feed starts from the list it had when the app was made
      app = createApp({ poller, auth, accounts, history });

      const res = await send('/api/events');
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      await reader.cancel();

      const text = new TextDecoder().decode(value);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      expect(text).toContain('event: machines');
      expect(text).toContain('"name":"Speedio"');
    });

    /** Open the live events with this cookie or these headers, and read the first event (the machine list) */
    async function openEvents(login: string | Record<string, string>): Promise<ReadableStreamDefaultReader<Uint8Array>> {
      const headers = typeof login === 'string' ? { Cookie: login } : login;
      const res = await app.request('/api/events', { headers });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      await reader.read();
      return reader;
    }

    /** The rest of the stream, if the server ends it within a short time. Else null. */
    async function restIfEnded(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string | null> {
      const ended = (async () => {
        let text = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return text;
          text += new TextDecoder().decode(value);
        }
      })();
      return Promise.race([ended, wait(300).then(() => null)]);
    }

    const endsSoon = async (reader: ReadableStreamDefaultReader<Uint8Array>) => (await restIfEnded(reader)) !== null;

    /** A second browser of the same user, with its own session */
    async function otherSessionCookie(): Promise<string> {
      return `${SESSION_COOKIE}=${await auth.logIn(TEST_LOGIN, { userAgent: 'other browser', address: '127.0.0.1' })}`;
    }

    it('keeps 5 live streams open for one login', async () => {
      const readers = [];
      for (let i = 0; i < 5; i++) readers.push(await openEvents(cookie));

      expect(await endsSoon(readers[0])).toBe(false);
      await Promise.all(readers.map(reader => reader.cancel()));
    });

    it('closes the oldest live stream of a login when the login opens a 6th, but not the streams of another login', async () => {
      const other = await openEvents(await otherSessionCookie());
      const readers = [];
      for (let i = 0; i < 6; i++) readers.push(await openEvents(cookie));

      // The browser waits one minute before it connects again
      expect(await restIfEnded(readers[0])).toContain('retry: 60000');
      expect(await endsSoon(readers[1])).toBe(false);
      expect(await endsSoon(other)).toBe(false);
      await Promise.all([other, ...readers.slice(1)].map(reader => reader.cancel()));
    });

    it('keeps the limit of 5 when a login opens 10 live streams, one after the other', async () => {
      const readers = [];
      for (let i = 0; i < 10; i++) readers.push(await openEvents(cookie));

      // Each closed stream ends a moment later and frees its slot. That must not free the slot of an open stream.
      const rests = await Promise.all(readers.map(restIfEnded));

      const states = rests.map(rest => (rest === null ? 'open' : rest.includes('retry: 60000') ? 'closed, retry' : 'closed'));
      expect(states).toEqual([...Array<string>(5).fill('closed, retry'), ...Array<string>(5).fill('open')]);
      await Promise.all(readers.slice(5).map(reader => reader.cancel()));
    });

    it('counts the streams of a program with a password (HTTP Basic) for its user', async () => {
      const basic = { Authorization: `Basic ${Buffer.from(`${TEST_LOGIN.username}:${TEST_LOGIN.password}`).toString('base64')}` };
      const browser = await openEvents(cookie);
      const readers = [];
      for (let i = 0; i < 6; i++) readers.push(await openEvents(basic));

      expect(await endsSoon(readers[0])).toBe(true);
      expect(await endsSoon(browser)).toBe(false);
      await Promise.all([browser, ...readers.slice(1)].map(reader => reader.cancel()));
    });

    describe('at each keep-alive', () => {
      beforeEach(() => { vi.useFakeTimers(); });
      afterEach(() => { vi.useRealTimers(); });

      /** Read the stream until the server ends it, and give all its text */
      async function restOf(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
        let text = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return text;
          text += new TextDecoder().decode(value);
        }
      }

      it('ends the live stream of a browser that logged out', async () => {
        const otherCookie = await otherSessionCookie();
        const reader = await openEvents(otherCookie);

        await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: otherCookie } });
        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS);

        expect(await restOf(reader)).not.toContain(': keep-alive');
        expect((await app.request('/api/events', { headers: { Cookie: otherCookie } })).status).toBe(401);
      });

      it('ends the live stream of each other browser after Log out all other browsers', async () => {
        // Its own user, so the login of the other tests stays
        const own = await loggedInAuth();
        app = createApp({ poller, auth: own.auth, accounts: own.accounts, history });
        const clickingCookie = own.cookie;
        const clicking = await openEvents(clickingCookie);
        const other = await openEvents(`${SESSION_COOKIE}=${await own.auth.logIn(TEST_LOGIN, { userAgent: 'other browser', address: '127.0.0.1' })}`);

        await app.request('/api/auth/sessions/log-out-others', { method: 'POST', headers: { Cookie: clickingCookie } });
        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS);

        expect(await restOf(other)).not.toContain(': keep-alive');
        expect(new TextDecoder().decode((await clicking.read()).value)).toContain(': keep-alive');
        await clicking.cancel();
      });

      it('keeps the live stream of a program with a password (HTTP Basic)', async () => {
        const basic = { Authorization: `Basic ${Buffer.from(`${TEST_LOGIN.username}:${TEST_LOGIN.password}`).toString('base64')}` };
        const reader = await openEvents(basic);
        const log = captureLog();

        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS);
        const { value } = await reader.read();
        log.restore();

        expect(new TextDecoder().decode(value)).toContain(': keep-alive');
        expect(log.lines.filter(line => line.level === 'error')).toEqual([]);
        await reader.cancel();
      });
    });

    it('lets a login open a new stream after it closes one', async () => {
      const readers = [];
      for (let i = 0; i < 5; i++) readers.push(await openEvents(cookie));
      await readers[4].cancel();
      // The server sees the closed stream a moment later
      await wait(20);
      readers[4] = await openEvents(cookie);

      expect(await endsSoon(readers[0])).toBe(false);
      await Promise.all(readers.map(reader => reader.cancel()));
    });
  });

  describe('errors that a route does not catch', () => {
    it('returns 500 with a general text, and logs the error', async () => {
      vi.spyOn(poller, 'getMachines').mockImplementation(() => { throw new Error('database is locked'); });
      const log = captureLog();

      const res = await call('GET', '/api/machines');
      log.restore();

      expect(res.status).toBe(500);
      expect(res.body.error).toBe(UNEXPECTED_ERROR_TEXT);
      expect(log.text('error')).toContain('database is locked');
      expect(log.text('error')).toContain('path=/api/machines');
    });

    it('returns 400 for a JSON body that is not an object', async () => {
      const res = await send('/api/machines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      });

      const body = await res.json() as { error: string };
      expect(res.status).toBe(400);
      expect(body.error).toContain('must be an object');
    });

    it('returns 400 for a body that is not JSON, and logs no error', async () => {
      const log = captureLog();

      const res = await send('/api/machines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      });
      log.restore();

      const body = await res.json() as { error: string };
      expect(res.status).toBe(400);
      expect(body.error).toContain('Malformed JSON');
      expect(log.text('error')).toBe('');
    });
  });

  describe('who may read the content of a program', () => {
    const roleCookies: Record<'viewer' | 'operator' | 'admin', string> = { viewer: '', operator: '', admin: '' };

    beforeAll(async () => {
      roleCookies.admin = cookie;
      for (const role of ['viewer', 'operator'] as const) {
        const login = { username: role, password: 'test-password' };
        await accounts.add({ ...login, role });
        roleCookies[role] = `${SESSION_COOKIE}=${await auth.logIn(login, { userAgent: 'test browser', address: '127.0.0.1' })}`;
      }
    });

    /** A machine whose connector gives one file in its tree and the text "G00 X0" for a download */
    async function machineWithFile(): Promise<string> {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const connector = poller.getConnector(machine.id)!;
      vi.spyOn(connector, 'readFileTree').mockResolvedValue({ nodes: [{ name: 'O1000.NC', path: '/PRG/O1000.NC', type: 'file', size: 6 }], isCutShort: false } as never);
      vi.spyOn(connector, 'downloadFile').mockImplementation(async (_path, output) => { output.write('G00 X0'); });
      vi.mocked(getUploadEventById).mockResolvedValue({ id: 1, file_name: 'O1000.NC', file_content: 'G00 X0' } as never);
      return machine.id;
    }

    const contentPaths = (id: string) => [
      `/api/machine/${id}/files/download?path=/PRG/O1000.NC`,
      `/api/machine/${id}/uploads/events/1`,
    ];
    const listPaths = (id: string) => [
      `/api/machine/${id}/files?path=/PRG`,
      `/api/machine/${id}/uploads`,
      `/api/machine/${id}/uploads/1/events`,
    ];

    const getAs = (role: keyof typeof roleCookies, path: string) => app.request(path, { headers: { Cookie: roleCookies[role] } });
    /** The header of a program that logs in as the Viewer, with no cookie */
    const basicViewer = { Authorization: `Basic ${Buffer.from('viewer:test-password').toString('base64')}` };

    it('refuses the content of a program to a Viewer', async () => {
      const id = await machineWithFile();
      for (const path of contentPaths(id)) {
        const res = await getAs('viewer', path);
        expect(res.status, path).toBe(403);
        expect(await res.text(), path).not.toContain('G00 X0');
      }
      expect(poller.getConnector(id)!.downloadFile).not.toHaveBeenCalled();
      expect(getUploadEventById).not.toHaveBeenCalled();
    });

    it.each(['operator', 'admin'] as const)('gives the content of a program to an %s', async role => {
      const id = await machineWithFile();
      for (const path of contentPaths(id)) {
        const res = await getAs(role, path);
        expect(res.status, path).toBe(200);
        expect(await res.text(), path).toContain('G00 X0');
      }
    });

    it.each(['viewer', 'operator', 'admin'] as const)('gives the program names and dates to a %s', async role => {
      const id = await machineWithFile();
      for (const path of listPaths(id)) {
        expect((await getAs(role, path)).status, path).toBe(200);
      }
    });

    // A program logs in with HTTP Basic on each request. The role of its user applies the same as for a browser.
    it('refuses the content of a program to a Viewer that logs in with HTTP Basic, but gives the names', async () => {
      const id = await machineWithFile();
      const getAsBasicViewer = (path: string) => app.request(path, { headers: basicViewer });
      for (const path of contentPaths(id)) {
        const res = await getAsBasicViewer(path);
        expect(res.status, path).toBe(403);
        expect(await res.text(), path).not.toContain('G00 X0');
      }
      for (const path of listPaths(id)) {
        expect((await getAsBasicViewer(path)).status, path).toBe(200);
      }
      expect(poller.getConnector(id)!.downloadFile).not.toHaveBeenCalled();
      expect(getUploadEventById).not.toHaveBeenCalled();
    });
  });
});
