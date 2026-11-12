import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiemensConnector } from './SiemensConnector.js';
import type { AlarmEvent } from './sinumerikAlarms.js';
import type { SinumerikConnectOptions, SinumerikSession, SinumerikValue } from './sinumerikClient.js';
import { SINUMERIK_PATHS } from './sinumerikValues.js';

/** The values of a running 828D, by path */
const RUNNING: Record<string, unknown> = {
  [SINUMERIK_PATHS.channelStatus]: 1,
  [SINUMERIK_PATHS.programStatus]: 3,
  [SINUMERIK_PATHS.operatingMode]: 2,
  [SINUMERIK_PATHS.selectedProgram]: '/_N_WKS_DIR/_N_BRACKET_WPD/_N_OP10_MPF',
  [SINUMERIK_PATHS.partCount]: 41,
  [SINUMERIK_PATHS.partGoal]: 100,
  [SINUMERIK_PATHS.toolNumber]: 2,
  [SINUMERIK_PATHS.toolName]: 'VF-6.0-UNI',
  [SINUMERIK_PATHS.spindleSpeed]: 8000,
  [SINUMERIK_PATHS.spindleLoad]: 37.5,
  [SINUMERIK_PATHS.feedrate]: 1200,
  [SINUMERIK_PATHS.feedOverride]: 100,
  '/Channel/Parameter/R[u1,6]': 12.5,
};

class FakeSession implements SinumerikSession {
  values: Record<string, unknown> = { ...RUNNING };
  readError: Error | null = null;
  alarmError: Error | null = null;
  alarmWarning: string | null = null;
  closed = false;
  readPaths: string[] = [];
  private onAlarm: ((event: AlarmEvent) => void) | null = null;

  async read(paths: string[]): Promise<SinumerikValue[]> {
    if (this.readError) throw this.readError;
    this.readPaths = paths;
    return paths.map(path => (path in this.values
      ? { value: this.values[path], status: 'Good' }
      : { value: undefined, status: 'BadNodeIdUnknown' }));
  }

  async watchAlarms(onEvent: (event: AlarmEvent) => void): Promise<string | null> {
    if (this.alarmError) throw this.alarmError;
    this.onAlarm = onEvent;
    return this.alarmWarning;
  }

  sendAlarm(event: AlarmEvent): void {
    this.onAlarm?.(event);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('SiemensConnector', () => {
  let session: FakeSession;
  let openSession: ReturnType<typeof vi.fn<[SinumerikConnectOptions], Promise<SinumerikSession>>>;
  let connector: SiemensConnector;

  beforeEach(() => {
    session = new FakeSession();
    openSession = vi.fn(async (_options: SinumerikConnectOptions): Promise<SinumerikSession> => session);
    connector = new SiemensConnector({ id: 'm1', name: 'DNM 6700', host: '10.0.0.5' }, openSession);
  });

  describe('settings', () => {
    it('uses the OPC UA defaults: port 4840, anonymous, no security', async () => {
      await connector.poll();
      expect(openSession).toHaveBeenCalledWith({
        host: '10.0.0.5', port: 4840, user: undefined, password: undefined, security: 'none', timeoutMs: 5000,
      });
    });

    it('logs in with the user and password, and the security that is set', async () => {
      connector = new SiemensConnector({
        name: 'M', host: '10.0.0.5', opcuaPort: 4841, opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity: 'signAndEncrypt',
      }, openSession);
      await connector.poll();
      expect(openSession).toHaveBeenCalledWith(expect.objectContaining({
        port: 4841, user: 'OpcUaClient', password: 'secret', security: 'signAndEncrypt',
      }));
    });

    it('never gives the OPC UA password in its status, only whether there is one', () => {
      connector = new SiemensConnector({ name: 'M', host: 'h', opcuaUser: 'u', opcuaPassword: 'secret' }, openSession);
      const status = connector.getStatus();
      expect(JSON.stringify(status)).not.toContain('secret');
      expect(status.hasOpcuaPassword).toBe(true);
      expect(status.opcuaUser).toBe('u');
    });

    it('connects again with new OPC UA settings at the next poll', async () => {
      await connector.poll();
      connector.updateOpcUaSettings({ user: 'other', password: '' });

      expect(connector.connected).toBe(false);
      expect(session.closed).toBe(true);
      await connector.poll();
      expect(openSession).toHaveBeenLastCalledWith(expect.objectContaining({ user: 'other', password: undefined }));
    });
  });

  describe('poll', () => {
    it('gives the values of a running machine in the shared names', async () => {
      const status = await connector.poll();

      expect(status.connected).toBe(true);
      expect(status.errors).toEqual([]);
      expect(status.data).toMatchObject({
        execution: 'ACTIVE',
        programStatus: 'RUNNING',
        mode: 'AUTO',
        program: 'OP10.MPF',
        partCount: 41,
        partGoal: 100,
        toolNumber: 2,
        toolName: 'VF-6.0-UNI',
        spindleSpeed: 8000,
        spindleLoad: 37.5,
        feedrate: 1200,
        feedOverride: 100,
        alarm: false,
      });
    });

    it('reads all values in one request', async () => {
      await connector.poll();
      expect(session.readPaths).toContain(SINUMERIK_PATHS.channelStatus);
      expect(session.readPaths).toContain(SINUMERIK_PATHS.spindleLoad);
    });

    it('reads each R parameter that is set as a macro', async () => {
      connector.updateMacros([{ location: 5, name: 'Stock' }]);
      const status = await connector.poll();
      expect(session.readPaths).toContain('/Channel/Parameter/R[u1,6]');
      expect(status.data.Stock).toBe(12.5);
    });

    it('leaves out a value that the control does not have, and still polls', async () => {
      delete session.values[SINUMERIK_PATHS.spindleLoad];
      const status = await connector.poll();
      expect(status.errors).toEqual([]);
      expect(status.data.spindleLoad).toBeUndefined();
      expect(status.data.spindleSpeed).toBe(8000);
    });

    it('fails the poll and disconnects when the channel status cannot be read', async () => {
      delete session.values[SINUMERIK_PATHS.channelStatus];
      const status = await connector.poll();
      expect(status.connected).toBe(false);
      expect(status.errors[0]).toContain('/Channel/State/chanStatus (BadNodeIdUnknown)');
      expect(session.closed).toBe(true);
    });

    it('fails the poll and disconnects when the read fails', async () => {
      await connector.poll();
      session.readError = new Error('BadSessionIdInvalid');
      const status = await connector.poll();
      expect(status.connected).toBe(false);
      expect(status.errors).toEqual(['Poll failed: BadSessionIdInvalid']);
    });

    it('tells why it cannot connect', async () => {
      openSession.mockRejectedValueOnce(new Error('BadUserAccessDenied'));
      const status = await connector.poll();
      expect(status.connected).toBe(false);
      expect(status.errors.join(' ')).toContain('BadUserAccessDenied');
    });

    it('emits only the values that changed', async () => {
      await connector.poll();
      const changes = vi.fn();
      connector.on('data', changes);
      session.values[SINUMERIK_PATHS.partCount] = 42;
      await connector.poll();
      expect(changes).toHaveBeenCalledWith([{ label: 'partCount', value: 42 }]);
    });
  });

  describe('alarms', () => {
    it('shows the first active alarm', async () => {
      await connector.poll();
      session.sendAlarm({ conditionId: 'a', conditionName: 'SystemCondition', message: '700209 | Door request', active: true });
      const status = await connector.poll();
      expect(status.data).toMatchObject({ alarm: true, alarmCode: '700209', alarmText: 'Door request' });
    });

    it('clears the alarm when it goes', async () => {
      await connector.poll();
      session.sendAlarm({ conditionId: 'a', message: '700209 | Door request', active: true });
      session.sendAlarm({ conditionId: 'a', message: '700209 | Door request', active: false });
      const status = await connector.poll();
      expect(status.data).toMatchObject({ alarm: false, alarmCode: undefined, alarmText: undefined });
    });

    it('still polls when the alarms cannot be read, and tells why', async () => {
      session.alarmError = new Error('BadServiceUnsupported');
      const status = await connector.poll();
      expect(status.connected).toBe(true);
      expect(status.data.execution).toBe('ACTIVE');
      expect(status.data.alarm).toBeUndefined();
      expect(status.errors).toEqual(['Alarms cannot be read: BadServiceUnsupported']);
    });

    it('still shows new alarms when the control does not send the active ones, and tells so', async () => {
      session.alarmWarning = 'Alarms that were active before Chatter connected may be missing (ConditionRefresh: BadMethodInvalid)';
      await connector.poll();
      session.sendAlarm({ conditionId: 'a', message: '700209 | Door request', active: true });
      const status = await connector.poll();
      expect(status.data.alarm).toBe(true);
      expect(status.errors).toEqual([session.alarmWarning]);
    });

    it('ignores an alarm event from an old session that is still closing', async () => {
      await connector.poll();
      const oldSession = session;
      connector.disconnect();
      session = new FakeSession();
      openSession.mockResolvedValue(session);
      await connector.poll();

      oldSession.sendAlarm({ conditionId: 'a', message: '700209 | Door request', active: true });
      const status = await connector.poll();
      expect(status.data.alarm).toBe(false);
    });

    it('forgets the alarms of an old connection', async () => {
      await connector.poll();
      session.sendAlarm({ conditionId: 'a', message: '700209 | Door request', active: true });
      connector.disconnect();
      session = new FakeSession();
      openSession.mockResolvedValue(session);
      const status = await connector.poll();
      expect(status.data.alarm).toBe(false);
    });
  });

  describe('getDataSnapshot', () => {
    it('gives the history values, and the Siemens values as custom data', async () => {
      connector.updateMacros([{ location: 5, name: 'Stock' }]);
      await connector.poll();
      session.sendAlarm({ conditionId: 'a', message: '700209 | Door request', active: true });
      await connector.poll();

      expect(connector.getDataSnapshot()).toMatchObject({
        machineId: 'm1',
        machineType: 'siemens',
        connected: true,
        execution: 'ACTIVE',
        mode: 'AUTO',
        program: 'OP10.MPF',
        spindleSpeed: 8000,
        spindleLoad: 37.5,
        feedrate: 1200,
        toolNumber: 2,
        partCount: 41,
        partGoal: 100,
        alarm: true,
        alarmCode: '700209',
        alarmMessage: 'Door request',
        custom: { programStatus: 'RUNNING', toolName: 'VF-6.0-UNI', feedOverride: 100, Stock: 12.5 },
      });
    });
  });

  describe('checkConnection', () => {
    it('is true only while connected', async () => {
      expect(connector.checkConnection()).toBe(false);
      await connector.poll();
      expect(connector.checkConnection()).toBe(true);
      connector.disconnect();
      expect(connector.checkConnection()).toBe(false);
    });
  });
});
