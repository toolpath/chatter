import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPCUA_NO_ENCRYPTION_WARNING } from '@local-chatter/shared';
import { captureLog, type CapturedLog } from '../../logging/testSupport.js';
import { CertificateChangedError } from './certificatePin.js';
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

const CONTROL_THUMBPRINT = 'c'.repeat(64);
const NEW_THUMBPRINT = 'd'.repeat(64);
const NEW_SHA1_THUMBPRINT = 'e'.repeat(40);

class FakeSession implements SinumerikSession {
  values: Record<string, unknown> = { ...RUNNING };
  readError: Error | null = null;
  alarmError: Error | null = null;
  alarmWarning: string | null = null;
  closed = false;
  readPaths: string[] = [];
  serverThumbprint: string | null = CONTROL_THUMBPRINT;
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
  let openSession: ReturnType<typeof vi.fn<(...args: [SinumerikConnectOptions]) => Promise<SinumerikSession>>>;
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
        host: '10.0.0.5', port: 4840, user: undefined, password: undefined, security: 'none', timeoutMs: 5000, trustedThumbprint: null,
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

  // F-11, D6: Security None with a login works, but the status warns, and the log tells once at each change
  describe('the warning for a login with Security None', () => {
    let log: CapturedLog;
    beforeEach(() => {
      log = captureLog();
    });
    afterEach(() => log.restore());

    const warnings = () => log.lines.filter(line => line.level === 'warn' && line.text.includes('Security is None'));
    const withLogin = (opcuaSecurity: 'none' | 'signAndEncrypt') => new SiemensConnector({
      id: 'm1', name: 'M', host: '10.0.0.5', opcuaUser: 'OpcUaClient', opcuaPassword: 'secret', opcuaSecurity,
    }, openSession);

    it('warns in the status when a user logs in with Security None', () => {
      expect(withLogin('none').getStatus().opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    });

    it('does not warn with Sign and encrypt', () => {
      expect(withLogin('signAndEncrypt').getStatus()).not.toHaveProperty('opcuaSecurityWarning');
    });

    it('does not warn for an anonymous login with Security None', () => {
      expect(connector.getStatus()).not.toHaveProperty('opcuaSecurityWarning');
    });

    it('still connects with Security None and a login', async () => {
      connector = withLogin('none');
      await connector.poll();
      expect(connector.connected).toBe(true);
      expect(connector.getStatus().opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);
    });

    it('warns after a change from Sign and encrypt to None, and stops after a change back', () => {
      connector = withLogin('signAndEncrypt');
      connector.updateOpcUaSettings({ security: 'none' });
      expect(connector.getStatus().opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);

      connector.updateOpcUaSettings({ security: 'signAndEncrypt' });
      expect(connector.getStatus()).not.toHaveProperty('opcuaSecurityWarning');
    });

    it('warns when a user is added to an anonymous login with Security None, and stops when the user is removed', () => {
      connector.updateOpcUaSettings({ user: 'OpcUaClient', password: 'secret' });
      expect(connector.getStatus().opcuaSecurityWarning).toBe(OPCUA_NO_ENCRYPTION_WARNING);

      connector.updateOpcUaSettings({ user: '', password: '' });
      expect(connector.getStatus()).not.toHaveProperty('opcuaSecurityWarning');
    });

    it('writes one warning in the log when a change turns the warning on, not at each change or poll', async () => {
      connector = withLogin('signAndEncrypt');
      connector.updateOpcUaSettings({ security: 'none' });
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0].text).toContain(OPCUA_NO_ENCRYPTION_WARNING);
      expect(warnings()[0].text).toContain('m1');
      expect(warnings()[0].text).toContain('10.0.0.5');
      expect(warnings()[0].text).not.toContain('secret');
      expect(warnings()[0].text).not.toContain('OpcUaClient');

      connector.updateOpcUaSettings({ security: 'none', user: 'other' });
      await connector.poll();
      await connector.poll();
      expect(warnings()).toHaveLength(1);

      connector.updateOpcUaSettings({ security: 'signAndEncrypt' });
      connector.updateOpcUaSettings({ security: 'none' });
      expect(warnings()).toHaveLength(2);
    });

    it('writes the warning in the log only when it is asked to, for a new machine', () => {
      connector = withLogin('none');
      expect(warnings()).toHaveLength(0);
      connector.logSecurityWarning();
      expect(warnings()).toHaveLength(1);

      withLogin('signAndEncrypt').logSecurityWarning();
      expect(warnings()).toHaveLength(1);
    });
  });

  describe('the certificate of the control (trust on first use)', () => {
    let saved: (string | null)[];

    beforeEach(() => {
      saved = [];
      connector.onTrustedThumbprintChange = thumbprint => saved.push(thumbprint);
    });

    /** The control shows a new certificate: the session opener refuses it before the login */
    function controlShowsNewCertificate(presented: string | null = NEW_THUMBPRINT) {
      openSession.mockImplementation(async options => {
        if (options.trustedThumbprint && options.trustedThumbprint !== presented) {
          throw new CertificateChangedError(presented, options.trustedThumbprint, presented && NEW_SHA1_THUMBPRINT);
        }
        return session;
      });
    }

    it('trusts the certificate of the first connect, and saves it', async () => {
      await connector.poll();
      expect(saved).toEqual([CONTROL_THUMBPRINT]);
      expect(connector.getStatus().opcuaServerThumbprint).toBe(CONTROL_THUMBPRINT);
    });

    it('gives the trusted certificate to each later connect', async () => {
      await connector.poll();
      connector.disconnect();
      await connector.poll();
      expect(openSession).toHaveBeenLastCalledWith(expect.objectContaining({ trustedThumbprint: CONTROL_THUMBPRINT }));
      expect(saved).toEqual([CONTROL_THUMBPRINT]);
    });

    it('starts with the certificate that was saved', async () => {
      connector = new SiemensConnector({ name: 'M', host: '10.0.0.5', opcuaServerThumbprint: CONTROL_THUMBPRINT }, openSession);
      await connector.poll();
      expect(openSession).toHaveBeenCalledWith(expect.objectContaining({ trustedThumbprint: CONTROL_THUMBPRINT }));
    });

    it('saves nothing when the control shows no certificate', async () => {
      session.serverThumbprint = null;
      await connector.poll();
      expect(saved).toEqual([]);
      expect(connector.getStatus().opcuaServerThumbprint).toBeNull();
    });

    it('stays offline when the certificate changed, keeps the trusted one, and tells what changed', async () => {
      await connector.poll();
      connector.disconnect();
      controlShowsNewCertificate();

      const status = await connector.poll();

      expect(status.connected).toBe(false);
      expect(status.opcuaServerThumbprint).toBe(CONTROL_THUMBPRINT);
      expect(status.opcuaCertificateChanged).toEqual({ presentedThumbprint: NEW_THUMBPRINT, presentedSha1Thumbprint: NEW_SHA1_THUMBPRINT });
      expect(status.errors.join(' ')).toContain('certificate of the control changed');
      expect(saved).toEqual([CONTROL_THUMBPRINT]);
    });

    it('tells nothing about a changed certificate while the certificate is the trusted one', async () => {
      const status = await connector.poll();
      expect(status.opcuaCertificateChanged).toBeUndefined();
    });

    it('trusts the new certificate only with the thumbprint that the Admin saw, and connects with it', async () => {
      connector = new SiemensConnector({ name: 'M', host: '10.0.0.5', opcuaServerThumbprint: CONTROL_THUMBPRINT }, openSession);
      connector.onTrustedThumbprintChange = thumbprint => saved.push(thumbprint);
      controlShowsNewCertificate();
      await connector.poll();

      expect(connector.trustCertificate(CONTROL_THUMBPRINT)).toBe('stale');
      expect(connector.trustCertificate(NEW_THUMBPRINT)).toBe('trusted');

      expect(saved).toEqual([NEW_THUMBPRINT]);
      expect(connector.getStatus().opcuaCertificateChanged).toBeUndefined();
      const status = await connector.poll();
      expect(status.connected).toBe(true);
      expect(openSession).toHaveBeenLastCalledWith(expect.objectContaining({ trustedThumbprint: NEW_THUMBPRINT }));
    });

    it('has nothing to trust while no new certificate was refused', async () => {
      await connector.poll();
      expect(connector.trustCertificate(NEW_THUMBPRINT)).toBe('nothing-to-trust');
      expect(saved).toEqual([CONTROL_THUMBPRINT]);
    });

    it('cannot trust a control that shows no certificate', async () => {
      connector = new SiemensConnector({ name: 'M', host: '10.0.0.5', opcuaServerThumbprint: CONTROL_THUMBPRINT }, openSession);
      controlShowsNewCertificate(null);
      const status = await connector.poll();
      expect(status.opcuaCertificateChanged).toEqual({ presentedThumbprint: null, presentedSha1Thumbprint: null });
      expect(connector.trustCertificate(NEW_THUMBPRINT)).toBe('nothing-to-trust');
    });

    it('forgets the trusted certificate, so the next connect trusts the certificate that it gets', async () => {
      await connector.poll();
      connector.forgetServerCertificate();

      expect(saved).toEqual([CONTROL_THUMBPRINT, null]);
      expect(connector.connected).toBe(false);
      await connector.poll();
      expect(openSession).toHaveBeenLastCalledWith(expect.objectContaining({ trustedThumbprint: null }));
    });

    it('does not save the certificate of a connect that ends after a disconnect', async () => {
      let openNow: (session: SinumerikSession) => void = () => {};
      openSession.mockImplementationOnce(() => new Promise(resolve => { openNow = resolve; }));
      const connecting = connector.connect();
      // For example, the user changed the IP address while the session opened
      connector.forgetServerCertificate();
      openNow(session);

      await expect(connecting).rejects.toThrow('Disconnected while connecting');
      expect(saved).toEqual([null]);
      expect(connector.getStatus().opcuaServerThumbprint).toBeNull();
    });
  });

  describe('the log of the certificate', () => {
    let log: CapturedLog;
    beforeEach(() => {
      log = captureLog();
    });
    afterEach(() => log.restore());

    const refuse = (presented: string) => openSession.mockImplementation(async options => {
      throw new CertificateChangedError(presented, options.trustedThumbprint ?? '', null);
    });
    const warnings = () => log.lines.filter(line => line.level === 'warn' && line.text.includes('certificate of the control changed'));

    it('writes one warning for each new refused certificate, not one at each poll', async () => {
      connector = new SiemensConnector({ id: 'm1', name: 'M', host: '10.0.0.5', opcuaServerThumbprint: CONTROL_THUMBPRINT }, openSession);
      refuse(NEW_THUMBPRINT);
      for (let poll = 0; poll < 3; poll++) await connector.poll();
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0].text).toContain(NEW_THUMBPRINT);
      expect(warnings()[0].text).toContain(CONTROL_THUMBPRINT);

      refuse('f'.repeat(64));
      await connector.poll();
      expect(warnings()).toHaveLength(2);
    });

    it('tells when it trusts the certificate of the first connect, and when an Admin trusts or forgets one', async () => {
      await connector.poll();
      expect(log.text('info')).toContain('Trusted the OPC UA certificate of the control on the first connect');
      expect(log.text('info')).toContain(CONTROL_THUMBPRINT);

      connector.disconnect();
      refuse(NEW_THUMBPRINT);
      await connector.poll();
      connector.trustCertificate(NEW_THUMBPRINT);
      expect(log.text('info')).toContain('An Admin trusted the new OPC UA certificate of the control');

      connector.forgetServerCertificate();
      expect(log.text('info')).toContain('Forgot the trusted OPC UA certificate of the control');
    });
  });

  describe('a connect that ends after a disconnect', () => {
    it('does not show a refused certificate of a connect that ends after a disconnect, for example to the old IP address', async () => {
      connector = new SiemensConnector({ id: 'm1', name: 'M', host: '10.0.0.5', opcuaServerThumbprint: CONTROL_THUMBPRINT }, openSession);
      let failNow: (error: Error) => void = () => {};
      openSession.mockImplementationOnce(() => new Promise((_resolve, reject) => { failNow = reject; }));
      const connecting = connector.connect();
      // The user changes the IP address while the connect to the old address is open
      connector.forgetServerCertificate();
      failNow(new CertificateChangedError(NEW_THUMBPRINT, CONTROL_THUMBPRINT, NEW_SHA1_THUMBPRINT));

      await expect(connecting).rejects.toBeInstanceOf(CertificateChangedError);
      expect(connector.getStatus().opcuaCertificateChanged).toBeUndefined();
      expect(connector.trustCertificate(NEW_THUMBPRINT)).toBe('nothing-to-trust');
    });

    it('closes the late session, stays disconnected and keeps the reason of the poll timeout', async () => {
      let openNow: (session: SinumerikSession) => void = () => {};
      openSession.mockImplementationOnce(() => new Promise(resolve => { openNow = resolve; }));
      const connecting = connector.connect();
      // What the scheduler does at the poll timeout, while the session still opens
      connector.disconnect();
      connector.reportPollTimeout(10000);

      openNow(session);

      await expect(connecting).rejects.toThrow('Disconnected while connecting');
      expect(session.closed).toBe(true);
      expect(connector.connected).toBe(false);
      expect(connector.getStatus().errors[0]).toContain('did not answer all requests');
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
