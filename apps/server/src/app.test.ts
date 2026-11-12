import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createApp } from './app.js';
import { HardwarePoller } from './polling/poller.js';
import type { Auth } from './auth/Auth.js';
import type { UserAccounts } from './auth/userAccounts.js';
import { loggedInAuth } from './auth/testSupport.js';
import type { HistorySource, RangeQuery, StateTime, WindowQuery } from './recording/MetricsReader.js';
import { StatePeriodStore } from './recording/StatePeriodStore.js';
import { type Alert, AlertStore } from './alerts/AlertStore.js';

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
    windowAverages: ReturnType<typeof vi.fn<[WindowQuery], ReturnType<HistorySource['windowAverages']>>>;
    stateTime: ReturnType<typeof vi.fn<[RangeQuery], Promise<StateTime | null>>>;
    rangeIncrease: ReturnType<typeof vi.fn<[RangeQuery], Promise<number | null>>>;
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
        annotations: { summary: 'Spindle speed is 9000' }, startsAt: now - 60_000, endsAt: now + 60_000, ...values,
      };
    }

    it('returns the alerts of the last week, newest first, and no end time for an alert that fires', async () => {
      const now = Date.now();
      alerts.save([
        alert({ startsAt: now - 3_600_000, endsAt: now - 1_800_000 }),
        alert({ startsAt: now - 60_000, endsAt: now + 60_000 }),
        alert({ startsAt: now - 9 * 86_400_000, endsAt: now - 8 * 86_400_000 }),
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
        alert({ name: 'Ended', endsAt: now - 1000, labels: { alertname: 'Ended' } }),
        alert({ name: 'Other machine', machineId: 'm2', labels: { alertname: 'Other machine' } }),
        alert({ name: 'Firing', labels: { alertname: 'Firing' } }),
      ], now);

      const res = await call('GET', '/api/alerts?state=firing&machine=m1');

      expect(res.body.data.map((found: { name: string }) => found.name)).toEqual(['Firing']);
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
      expect(getUploadEvents).toHaveBeenCalledWith('42');
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

    it('returns 500 when the machine refuses the download', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      vi.spyOn(poller.getConnector(machine.id)!, 'downloadFile')
        .mockRejectedValue(new Error('FTP download error: 550'));

      const res = await call('GET', `/api/machine/${machine.id}/files/download?path=/PRG/O1000.NC`);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('550');
    });

    it('uploads one file and records it', async () => {
      const machine = await poller.addBrotherMachine({ name: 'Speedio', host: '192.168.1.50' });
      const uploadFile = vi.spyOn(poller.getConnector(machine.id)!, 'uploadFile').mockResolvedValue();
      const form = uploadForm({ withFile: true, path: '/PRG/O1000.NC' });
      form.append('overwrite', 'true');

      const res = await call('POST', `/api/machine/${machine.id}/files/upload`, form);

      expect(res.status).toBe(200);
      expect(uploadFile).toHaveBeenCalledWith('/PRG/O1000.NC', Buffer.from('test'), true);
      expect(recordUpload).toHaveBeenCalledWith(machine.id, 'test.nc', 'test.nc', '/PRG/O1000.NC', 'test');
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
      );
      expect(res.body.success).toEqual([
        { filename: 'a.nc', targetName: 'O0100.NC', path: '/PRG/O0100.NC' },
        { filename: 'b.nc', targetName: 'b.nc', path: '/PRG/b.nc' },
      ]);
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
  });

  describe('errors that a route does not catch', () => {
    it('returns 500 with the error text', async () => {
      vi.spyOn(poller, 'getMachines').mockImplementation(() => { throw new Error('database is locked'); });

      const res = await call('GET', '/api/machines');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('database is locked');
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

    it('returns 400 for a body that is not JSON', async () => {
      const res = await send('/api/machines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      });

      const body = await res.json() as { error: string };
      expect(res.status).toBe(400);
      expect(body.error).toContain('Malformed JSON');
    });
  });
});
