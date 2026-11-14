import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FanucConnector } from './FanucConnector.js';
import { EW_HANDLE, EW_SOCKET, FocasError } from './focasError.js';
import { captureLog } from '../../logging/testSupport.js';

// Type definitions for mock return values
interface MockStatus {
  mode: string;
  runState: string;
  emergency: boolean;
  alarm: boolean;
  motion: number;
}

interface MockAlarm {
  alarmNo: number;
  type?: number;
  message: string;
}

interface MockOperatorMessage {
  number: number;
  type: number;
  message: string;
}

// The FOCAS session that the mocked FOCAS thread gives. connect records how the thread was asked to connect.
const mockFocasInstance = {
  connect: vi.fn(),
  disconnect: vi.fn(async () => undefined),
  readStatus: vi.fn<[], MockStatus>(() => ({
    mode: 'MEM',
    runState: 'RUN',
    emergency: false,
    alarm: false,
    motion: 0,
  })),
  readSpindleSpeed: vi.fn(() => ({ speed: 5000 })),
  readSpindleLoad: vi.fn<[], number | undefined>(() => 42),
  readProgram: vi.fn(() => ({ name: 'O1234', number: 1234 })),
  readAlarms: vi.fn<[], MockAlarm[]>(() => []),
  readMacro: vi.fn(() => ({ value: 100 })),
  readOperatorMessages: vi.fn<[], MockOperatorMessage[]>(() => []),
  readSystemInfo: vi.fn<[], { cncType: string; mtType: string }>(() => ({ cncType: '31', mtType: 'M' })),
  readPathCount: vi.fn<[], number>(() => 1),
};

// Track availability for tests
let focasAvailable = true;
let focasPlatformMessage = 'FOCAS available';

// Mock the Focas module with static methods
vi.mock('./focas.js', () => ({
  Focas: {
    isAvailable: () => focasAvailable,
    getPlatformMessage: () => focasPlatformMessage,
  },
}));

// The FOCAS thread of each machine gives the mock session
const mockThread = {
  connect: vi.fn(async (host: string, port: number, timeoutSeconds: number) => {
    mockFocasInstance.connect(host, port, timeoutSeconds);
    return mockFocasInstance;
  }),
  stop: vi.fn(async () => undefined),
};
const mockThreads = vi.hoisted(() => ({ thread: (): unknown => undefined }));
mockThreads.thread = vi.fn(() => mockThread);
vi.mock('./focasThread.js', () => ({ focasThreads: mockThreads }));

describe('FanucConnector', () => {
  let connector: FanucConnector;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset to available state
    focasAvailable = true;
    focasPlatformMessage = 'FOCAS available';

    // Reset mock implementations
    mockFocasInstance.readStatus.mockReturnValue({
      mode: 'MEM',
      runState: 'RUN',
      emergency: false,
      alarm: false,
      motion: 0,
    });
    mockFocasInstance.readSpindleSpeed.mockReturnValue({ speed: 5000 });
    mockFocasInstance.readSpindleLoad.mockReset().mockReturnValue(42);
    mockFocasInstance.readProgram.mockReturnValue({ name: 'O1234', number: 1234 });
    mockFocasInstance.readAlarms.mockReturnValue([]);
    mockFocasInstance.readMacro.mockReturnValue({ value: 100 });
    mockFocasInstance.readOperatorMessages.mockReturnValue([]);
    mockFocasInstance.readSystemInfo.mockReset().mockReturnValue({ cncType: '31', mtType: 'M' });
    mockFocasInstance.readPathCount.mockReset().mockReturnValue(1);

    connector = new FanucConnector({
      id: 'test_fanuc',
      name: 'TestFanuc',
      host: '192.168.1.100',
      focasPort: 8193,
      timeout: 10,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (connector) {
      connector.disconnect();
    }
  });

  describe('constructor', () => {
    it('should initialize with correct defaults', () => {
      const defaultConnector = new FanucConnector({
        name: 'DefaultFanuc',
        host: '192.168.1.50',
      });

      expect(defaultConnector.host).toBe('192.168.1.50');
      expect(defaultConnector.focasPort).toBe(8193);
      expect(defaultConnector.connected).toBe(false);
      expect(defaultConnector.ignoredMessageTypes).toEqual([]);
      expect(defaultConnector.macros).toEqual([]);
    });

    it('should initialize with custom config', () => {
      expect(connector.id).toBe('test_fanuc');
      expect(connector.name).toBe('TestFanuc');
      expect(connector.host).toBe('192.168.1.100');
      expect(connector.focasPort).toBe(8193);
      expect(connector.connected).toBe(false);
    });

    it('should accept toolNumberVariable configuration', () => {
      const customConnector = new FanucConnector({
        name: 'CustomFanuc',
        host: '192.168.1.100',
        toolNumberVariable: 500,
      });

      expect(customConnector.toolNumberVariable).toBe(500);
    });

    it('should accept partCounterVariable configuration', () => {
      const customConnector = new FanucConnector({
        name: 'CustomFanuc',
        host: '192.168.1.100',
        partCounterVariable: 501,
      });

      expect(customConnector.partCounterVariable).toBe(501);
    });

    it('should accept ignoredMessageTypes configuration', () => {
      const customConnector = new FanucConnector({
        name: 'CustomFanuc',
        host: '192.168.1.100',
        ignoredMessageTypes: [0, 4, 5],
      });

      expect(customConnector.ignoredMessageTypes).toEqual([0, 4, 5]);
    });

    it('should accept macros configuration', () => {
      const customConnector = new FanucConnector({
        name: 'CustomFanuc',
        host: '192.168.1.100',
        macros: [
          { location: 100, name: 'CustomVar' },
          { location: 200 },
        ],
      });

      expect(customConnector.macros).toHaveLength(2);
      expect(customConnector.macros[0].location).toBe(100);
      expect(customConnector.macros[0].name).toBe('CustomVar');
    });
  });

  describe('static methods', () => {
    it('isAvailable should check FOCAS availability', () => {
      expect(FanucConnector.isAvailable()).toBe(true);
    });

    it('getPlatformMessage should return FOCAS message', () => {
      expect(FanucConnector.getPlatformMessage()).toBe('FOCAS available');
    });
  });

  describe('connect', () => {
    it('should start with no connection', () => {
      expect(connector.connected).toBe(false);
    });

    it('should set connected to true on successful connection', async () => {
      await connector.connect();
      expect(connector.connected).toBe(true);
    });

    it('should throw error when FOCAS is not available', async () => {
      focasAvailable = false;
      focasPlatformMessage = 'FOCAS not available on this platform';

      const unavailableConnector = new FanucConnector({
        name: 'UnavailableFanuc',
        host: '192.168.1.100',
      });

      await expect(unavailableConnector.connect()).rejects.toThrow('FOCAS not available on this platform');
      expect(unavailableConnector.connected).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should set connected to false', async () => {
      await connector.connect();
      expect(connector.connected).toBe(true);

      connector.disconnect();
      expect(connector.connected).toBe(false);
    });

    it('should end the FOCAS session', async () => {
      await connector.connect();
      connector.disconnect();
      expect(mockFocasInstance.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should not fail when the FOCAS session cannot be ended', async () => {
      await connector.connect();
      mockFocasInstance.disconnect.mockRejectedValueOnce(new Error('Connection lost'));

      expect(() => connector.disconnect()).not.toThrow();
      expect(connector.connected).toBe(false);
    });

    it('should be safe to call when not connected', () => {
      expect(() => connector.disconnect()).not.toThrow();
      expect(connector.connected).toBe(false);
    });

    it('keeps the FOCAS thread of the machine, for the next connect', async () => {
      await connector.connect();
      connector.disconnect();
      await connector.connect();

      expect(mockThreads.thread).toHaveBeenCalledTimes(1);
      expect(mockThread.stop).not.toHaveBeenCalled();
    });

    it('does not keep a connection that ends after a disconnect', async () => {
      let finishConnect: () => void = () => undefined;
      mockThread.connect.mockImplementationOnce(() => new Promise(resolve => {
        finishConnect = () => resolve(mockFocasInstance);
      }));
      const connecting = connector.connect();
      await vi.waitFor(() => expect(mockThread.connect).toHaveBeenCalled());

      connector.disconnect();
      finishConnect();

      await expect(connecting).rejects.toThrow('Disconnected while connecting');
      expect(connector.connected).toBe(false);
      expect(mockFocasInstance.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('ends the session and stops the FOCAS thread of the machine', async () => {
      await connector.connect();
      connector.dispose();

      expect(connector.connected).toBe(false);
      expect(mockFocasInstance.disconnect).toHaveBeenCalledTimes(1);
      expect(mockThread.stop).toHaveBeenCalledTimes(1);
    });

    it('does nothing to a thread when the machine never connected', () => {
      connector.dispose();
      expect(mockThread.stop).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return current status object', () => {
      const status = connector.getStatus();

      expect(status.id).toBe('test_fanuc');
      expect(status.name).toBe('TestFanuc');
      expect(status.host).toBe('192.168.1.100');
      expect(status.type).toBe('fanuc');
      expect(status.focasPort).toBe(8193);
      expect(status.connected).toBe(false);
      expect(status.data).toBeDefined();
      expect(status.errors).toEqual([]);
    });

    it('should include ignoredMessageTypes in status', () => {
      const customConnector = new FanucConnector({
        name: 'CustomFanuc',
        host: '192.168.1.100',
        ignoredMessageTypes: [0, 4],
      });

      const status = customConnector.getStatus();
      expect(status.ignoredMessageTypes).toEqual([0, 4]);
    });

    it('should include macros in status', () => {
      const customConnector = new FanucConnector({
        name: 'CustomFanuc',
        host: '192.168.1.100',
        macros: [{ location: 100, name: 'Test' }],
      });

      const status = customConnector.getStatus();
      expect(status.macros).toHaveLength(1);
      expect(status.macros![0].location).toBe(100);
    });
  });

  describe('poll', () => {
    it('should attempt to connect if not connected', async () => {
      const status = await connector.poll();
      expect(connector.connected).toBe(true);
      expect(status).toBeDefined();
    });

    it('should read machine status during poll', async () => {
      await connector.connect();
      const status = await connector.poll();

      expect(status.data.mode).toBe('MEM');
      expect(status.data.runState).toBe('RUN');
    });

    it('should read spindle speed during poll', async () => {
      await connector.connect();
      const status = await connector.poll();

      expect(status.data.spindleSpeed).toBe(5000);
    });

    it('reads the spindle load and gives it in the snapshot for the history', async () => {
      await connector.connect();
      const status = await connector.poll();

      expect(status.data.spindleLoad).toBe(42);
      expect(connector.getDataSnapshot().spindleLoad).toBe(42);
    });

    it('forgets the spindle load when the control stops giving it, for example an analog spindle', async () => {
      await connector.connect();
      await connector.poll();
      mockFocasInstance.readSpindleLoad.mockImplementation(() => { throw new Error('EW_NOOPT'); });

      const status = await connector.poll();

      expect(status.data.spindleLoad).toBeUndefined();
      expect(status.data.spindleSpeed).toBe(5000);
    });

    it('should read program during poll', async () => {
      await connector.connect();
      const status = await connector.poll();

      expect(status.data.program).toBe('O1234');
    });

    it('should update lastPollTime after poll', async () => {
      expect(connector.getStatus().lastPollTime).toBeNull();

      await connector.poll();

      expect(connector.getStatus().lastPollTime).not.toBeNull();
    });
  });

  describe('alarm handling', () => {
    it('should detect alarm state from status', async () => {
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'STOP',
        emergency: false,
        alarm: true,
        motion: 0,
      });

      await connector.connect();
      const status = await connector.poll();

      expect(status.data.alarm).toBe(true);
    });

    it('should read alarm details when alarm is active', async () => {
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'STOP',
        emergency: false,
        alarm: true,
        motion: 0,
      });
      mockFocasInstance.readAlarms.mockReturnValue([
        { alarmNo: 1001, message: 'Spindle error' },
      ]);

      await connector.connect();
      const status = await connector.poll();

      expect(status.data.alarm).toBe(true);
      expect(status.data.alarmCode).toBe('1001');
      expect(status.data.alarmMessage).toBe('Spindle error');
    });

    it('should set e-stop as alarm state', async () => {
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'STOP',
        emergency: true,
        alarm: false,
        motion: 0,
      });

      await connector.connect();
      const status = await connector.poll();

      expect(status.data.emergency).toBe(true);
      expect(status.data.alarm).toBe(true);
      expect(status.data.alarmCode).toBe('E-STOP');
      expect(status.data.alarmMessage).toBe('Emergency Stop Active');
    });

    it('should preserve existing alarm info when e-stop is active', async () => {
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'STOP',
        emergency: true,
        alarm: true,
        motion: 0,
      });
      mockFocasInstance.readAlarms.mockReturnValue([
        { alarmNo: 2000, message: 'Servo error' },
      ]);

      await connector.connect();
      const status = await connector.poll();

      expect(status.data.emergency).toBe(true);
      expect(status.data.alarm).toBe(true);
      // Should keep the original alarm code, not override with E-STOP
      expect(status.data.alarmCode).toBe('2000');
      expect(status.data.alarmMessage).toBe('Servo error');
    });

    it('does not see an emergency stop when the axes move', async () => {
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEMORY',
        runState: 'START',
        emergency: false,
        alarm: false,
        motion: 1,
      });

      await connector.connect();
      const status = await connector.poll();

      expect(status.data.emergency).toBe(false);
      expect(status.data.alarm).toBe(false);
    });
  });

  describe('operator messages', () => {
    it('should read operator messages during poll', async () => {
      mockFocasInstance.readOperatorMessages.mockReturnValue([
        { number: 1, type: 0, message: 'Test message' },
      ]);

      await connector.connect();
      const status = await connector.poll();

      expect(status.data.operatorMessage).toBe('Test message');
    });

    it('should take the last message when multiple exist', async () => {
      mockFocasInstance.readOperatorMessages.mockReturnValue([
        { number: 1, type: 0, message: 'First message' },
        { number: 2, type: 0, message: 'Second message' },
        { number: 3, type: 0, message: 'Third message' },
      ]);

      await connector.connect();
      const status = await connector.poll();

      expect(status.data.operatorMessage).toBe('Third message');
    });

    it('should filter out ignored message types', async () => {
      const filterConnector = new FanucConnector({
        name: 'FilterFanuc',
        host: '192.168.1.100',
        ignoredMessageTypes: [4, 5],
      });

      mockFocasInstance.readOperatorMessages.mockReturnValue([
        { number: 1, type: 4, message: 'Ignored type 4' },
        { number: 2, type: 0, message: 'Visible message' },
        { number: 3, type: 5, message: 'Ignored type 5' },
      ]);

      await filterConnector.connect();
      const status = await filterConnector.poll();

      expect(status.data.operatorMessage).toBe('Visible message');
    });

    it('should clear operator message when all messages are filtered', async () => {
      const filterConnector = new FanucConnector({
        name: 'FilterFanuc',
        host: '192.168.1.100',
        ignoredMessageTypes: [0, 4],
      });

      mockFocasInstance.readOperatorMessages.mockReturnValue([
        { number: 1, type: 0, message: 'Filtered' },
        { number: 2, type: 4, message: 'Also filtered' },
      ]);

      await filterConnector.connect();
      const status = await filterConnector.poll();

      expect(status.data.operatorMessage).toBeUndefined();
    });

    it('should handle empty operator messages', async () => {
      mockFocasInstance.readOperatorMessages.mockReturnValue([]);

      await connector.connect();
      const status = await connector.poll();

      expect(status.data.operatorMessage).toBeUndefined();
    });
  });

  describe('a value that the next poll cannot read', () => {
    const failing = () => { throw new Error('Read error'); };

    it('clears the operator message when the control has no message any more', async () => {
      mockFocasInstance.readOperatorMessages.mockReturnValue([{ number: 1, type: 0, message: 'Load part' }]);
      await connector.connect();
      expect((await connector.poll()).data.operatorMessage).toBe('Load part');

      mockFocasInstance.readOperatorMessages.mockReturnValue([]);
      expect((await connector.poll()).data.operatorMessage).toBeUndefined();
    });

    it('clears the operator message when the read fails', async () => {
      mockFocasInstance.readOperatorMessages.mockReturnValue([{ number: 1, type: 0, message: 'Load part' }]);
      await connector.connect();
      await connector.poll();

      mockFocasInstance.readOperatorMessages.mockImplementation(failing);
      expect((await connector.poll()).data.operatorMessage).toBeUndefined();
    });

    it('gives the alarm code of the screen, with the letters of the alarm type', async () => {
      mockFocasInstance.readSystemInfo.mockReturnValue({ cncType: '0', mtType: 'M' });
      mockFocasInstance.readStatus.mockReturnValue({ mode: 'MEM', runState: 'STOP', emergency: false, alarm: true, motion: 0 });
      mockFocasInstance.readAlarms.mockReturnValue([{ alarmNo: 401, type: 6, message: 'SERVO V-READY OFF' }]);
      await connector.connect();
      expect((await connector.poll()).data.alarmCode).toBe('SV0401');

      mockFocasInstance.readAlarms.mockReturnValue([{ alarmNo: 3086, type: 8, message: 'PATH OBSTRUCTED' }]);
      expect((await connector.poll()).data).toMatchObject({ alarmCode: 'MC3086', alarmMessage: 'PATH OBSTRUCTED' });
    });

    it('gives the number alone when the series of the control is not known', async () => {
      mockFocasInstance.readSystemInfo.mockImplementation(() => { throw new Error('No option error'); });
      mockFocasInstance.readAlarms.mockReturnValue([{ alarmNo: 401, type: 6, message: 'SERVO V-READY OFF' }]);
      await connector.connect();
      expect((await connector.poll()).data.alarmCode).toBe('401');
    });

    it('gives a general alarm, not the old one, when the alarm flag is on and the list is empty', async () => {
      mockFocasInstance.readStatus.mockReturnValue({ mode: 'MEM', runState: 'STOP', emergency: false, alarm: true, motion: 0 });
      mockFocasInstance.readAlarms.mockReturnValue([{ alarmNo: 1001, message: 'Spindle overheat' }]);
      await connector.connect();
      expect((await connector.poll()).data.alarmCode).toBe('1001');

      mockFocasInstance.readAlarms.mockReturnValue([]);
      const status = await connector.poll();

      expect(status.data.alarm).toBe(true);
      expect(status.data.alarmCode).toBe('ALARM');
      expect(status.data.alarmMessage).toBe('Alarm active (the control gave no details)');
    });

    it('gives a general alarm, not the old one, when the alarm flag is on and the list read fails', async () => {
      mockFocasInstance.readStatus.mockReturnValue({ mode: 'MEM', runState: 'STOP', emergency: false, alarm: true, motion: 0 });
      mockFocasInstance.readAlarms.mockReturnValue([{ alarmNo: 1001, message: 'Spindle overheat' }]);
      await connector.connect();
      await connector.poll();

      mockFocasInstance.readAlarms.mockImplementation(failing);
      const status = await connector.poll();

      expect(status.data.alarmCode).toBe('ALARM');
      expect(status.data.alarmMessage).toBe('Alarm active (the control gave no details)');
    });

    it('shows the emergency stop, not the general alarm, when the alarm list is empty', async () => {
      mockFocasInstance.readStatus.mockReturnValue({ mode: 'MEM', runState: 'STOP', emergency: true, alarm: true, motion: 0 });
      mockFocasInstance.readAlarms.mockReturnValue([]);
      await connector.connect();
      const status = await connector.poll();

      expect(status.data.alarmCode).toBe('E-STOP');
      expect(status.data.alarmMessage).toBe('Emergency Stop Active');
    });

    it('clears the alarm when the flag goes off and the list is empty', async () => {
      mockFocasInstance.readStatus.mockReturnValue({ mode: 'MEM', runState: 'STOP', emergency: false, alarm: true, motion: 0 });
      mockFocasInstance.readAlarms.mockReturnValue([{ alarmNo: 1001, message: 'Spindle overheat' }]);
      await connector.connect();
      await connector.poll();

      mockFocasInstance.readStatus.mockReturnValue({ mode: 'MEM', runState: 'STOP', emergency: false, alarm: false, motion: 0 });
      mockFocasInstance.readAlarms.mockReturnValue([]);
      const status = await connector.poll();

      expect(status.data.alarm).toBe(false);
      expect(status.data.alarmCode).toBeUndefined();
      expect(status.data.alarmMessage).toBeUndefined();
    });

    it('clears the spindle speed when its read fails', async () => {
      await connector.connect();
      expect((await connector.poll()).data.spindleSpeed).toBe(5000);

      mockFocasInstance.readSpindleSpeed.mockImplementation(failing);
      expect((await connector.poll()).data.spindleSpeed).toBeUndefined();
    });

    it('clears the program when its read fails', async () => {
      await connector.connect();
      expect((await connector.poll()).data.program).toBe('O1234');

      mockFocasInstance.readProgram.mockImplementation(failing);
      expect((await connector.poll()).data.program).toBeUndefined();
    });

    it('clears the tool number, the part count and the macros when their reads fail', async () => {
      const macroConnector = new FanucConnector({
        name: 'MacroFanuc',
        host: '192.168.1.100',
        toolNumberVariable: 500,
        partCounterVariable: 501,
        macros: [{ location: 600, name: 'Feed' }],
      });
      await macroConnector.connect();
      const before = await macroConnector.poll();
      expect(before.data.toolNumber).toBe(100);
      expect(before.data.partCount).toBe(100);
      expect(before.data.Feed).toBe(100);

      mockFocasInstance.readMacro.mockImplementation(failing);
      const after = await macroConnector.poll();

      expect(after.data.toolNumber).toBeUndefined();
      expect(after.data.partCount).toBeUndefined();
      expect(after.data.Feed).toBeUndefined();
      expect(macroConnector.getDataSnapshot().custom?.Feed).toBeUndefined();
    });

    it('tells the listeners that a value went away', async () => {
      await connector.connect();
      await connector.poll();
      const changes = vi.fn();
      connector.on('data', changes);

      mockFocasInstance.readProgram.mockImplementation(failing);
      await connector.poll();

      expect(changes).toHaveBeenCalledWith([{ label: 'program', value: undefined }]);
    });
  });

  describe('macro reading', () => {
    it('should read toolNumberVariable if configured', async () => {
      const macroConnector = new FanucConnector({
        name: 'MacroFanuc',
        host: '192.168.1.100',
        toolNumberVariable: 500,
      });

      mockFocasInstance.readMacro = vi.fn(() => ({ value: 7 }));

      await macroConnector.connect();
      const status = await macroConnector.poll();

      expect(status.data.toolNumber).toBe(7);
    });

    it('should read partCounterVariable if configured', async () => {
      const macroConnector = new FanucConnector({
        name: 'MacroFanuc',
        host: '192.168.1.100',
        partCounterVariable: 501,
      });

      mockFocasInstance.readMacro = vi.fn(() => ({ value: 42 }));

      await macroConnector.connect();
      const status = await macroConnector.poll();

      expect(status.data.partCount).toBe(42);
    });

    it('should read custom macros if configured', async () => {
      const macroConnector = new FanucConnector({
        name: 'MacroFanuc',
        host: '192.168.1.100',
        macros: [
          { location: 100, name: 'customVar' },
        ],
      });

      mockFocasInstance.readMacro = vi.fn(() => ({ value: 123.45 }));

      await macroConnector.connect();
      const status = await macroConnector.poll();

      expect(status.data.customVar).toBe(123.45);
    });

    it('should floor tool number to integer', async () => {
      const macroConnector = new FanucConnector({
        name: 'MacroFanuc',
        host: '192.168.1.100',
        toolNumberVariable: 500,
      });

      mockFocasInstance.readMacro = vi.fn(() => ({ value: 7.99 }));

      await macroConnector.connect();
      const status = await macroConnector.poll();

      expect(status.data.toolNumber).toBe(7);
    });
  });

  describe('update methods', () => {
    it('should update FOCAS port', () => {
      expect(connector.focasPort).toBe(8193);

      connector.updateFocasPort(8194);

      expect(connector.focasPort).toBe(8194);
    });

    it('should disconnect when FOCAS port is updated while connected', async () => {
      await connector.connect();
      expect(connector.connected).toBe(true);

      connector.updateFocasPort(8194);

      expect(connector.connected).toBe(false);
    });

    it('should update tool number variable', () => {
      expect(connector.toolNumberVariable).toBeUndefined();

      connector.updateToolNumberVariable(500);

      expect(connector.toolNumberVariable).toBe(500);
    });

    it('should update part counter variable', () => {
      expect(connector.partCounterVariable).toBeUndefined();

      connector.updatePartCounterVariable(501);

      expect(connector.partCounterVariable).toBe(501);
    });

    it('should update ignored message types', () => {
      expect(connector.ignoredMessageTypes).toEqual([]);

      connector.updateIgnoredMessageTypes([0, 4, 5]);

      expect(connector.ignoredMessageTypes).toEqual([0, 4, 5]);
    });

    it('should update macros', () => {
      expect(connector.macros).toEqual([]);

      connector.updateMacros([
        { location: 100, name: 'NewMacro' },
      ]);

      expect(connector.macros).toHaveLength(1);
      expect(connector.macros[0].location).toBe(100);
    });
  });

  describe('checkConnection', () => {
    it('should return false when not connected', () => {
      expect(connector.checkConnection()).toBe(false);
    });

    it('should return true when connected and status readable', async () => {
      await connector.connect();
      expect(connector.checkConnection()).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should add error when connection fails', async () => {
      focasAvailable = false;
      focasPlatformMessage = 'Platform not supported';

      const errorConnector = new FanucConnector({
        name: 'ErrorFanuc',
        host: '192.168.1.100',
      });

      try {
        await errorConnector.connect();
      } catch {
        // Expected to throw
      }

      const status = errorConnector.getStatus();
      expect(status.errors.length).toBeGreaterThan(0);
      expect(status.errors[0]).toContain('Connection failed');
    });
  });

  describe('a lost connection in a read that may fail', () => {
    for (const [name, code] of [['EW_SOCKET', EW_SOCKET], ['EW_HANDLE', EW_HANDLE]] as const) {
      it(`fails the poll on ${name}, and the next poll connects again`, async () => {
        await connector.connect();
        mockFocasInstance.readProgram.mockImplementationOnce(() => { throw new FocasError('Failed to read program: lost', code); });

        const failed = await connector.poll();

        expect(failed.connected).toBe(false);
        expect(failed.errors).toEqual(['Poll failed: Failed to read program: lost']);
        expect(mockFocasInstance.disconnect).toHaveBeenCalledTimes(1);

        const next = await connector.poll();
        expect(next.connected).toBe(true);
        expect(mockThread.connect).toHaveBeenCalledTimes(2);
      });
    }

    it('keeps the connection when the control does not have the value', async () => {
      await connector.connect();
      mockFocasInstance.readProgram.mockImplementationOnce(() => { throw new FocasError('Failed to read program: No option error', 6); });

      const status = await connector.poll();

      expect(status.connected).toBe(true);
      expect(status.errors).toEqual([]);
    });
  });

  describe('a poll whose connection dies', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('stops the other reads of the poll at once after a lost connection', async () => {
      await connector.connect();
      mockFocasInstance.readSpindleSpeed.mockImplementationOnce(() => { throw new FocasError('Failed to read spindle speed: Socket error', EW_SOCKET); });

      const status = await connector.poll();

      expect(status.connected).toBe(false);
      expect(mockFocasInstance.readProgram).not.toHaveBeenCalled();
      expect(mockFocasInstance.readAlarms).not.toHaveBeenCalled();
      expect(mockFocasInstance.readOperatorMessages).not.toHaveBeenCalled();
    });

    it('fails the poll when its reads run past the deadline, before the poll limit of the scheduler', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      await connector.connect();
      // Each read waits out a long timeout
      mockFocasInstance.readSpindleSpeed.mockImplementationOnce(() => {
        vi.setSystemTime(Date.now() + 9000);
        return { speed: 5000 };
      });

      const status = await connector.poll();

      expect(status.connected).toBe(false);
      expect(status.errors).toEqual(['Poll failed: The reads of this poll took too long']);
      expect(mockFocasInstance.readSpindleLoad).not.toHaveBeenCalled();
    });

    it('logs a read that does not work once, until it works again', async () => {
      const log = captureLog();
      try {
        await connector.connect();
        mockFocasInstance.readProgram.mockImplementation(() => { throw new FocasError('Failed to read program: No option error', 6); });
        await connector.poll();
        await connector.poll();
        expect(log.text().match(/A FANUC read did not work/g)).toHaveLength(1);

        mockFocasInstance.readProgram.mockReturnValue({ name: 'O1', number: 1 });
        await connector.poll();
        mockFocasInstance.readProgram.mockImplementation(() => { throw new FocasError('Failed to read program: No option error', 6); });
        await connector.poll();
        expect(log.text().match(/A FANUC read did not work/g)).toHaveLength(2);
      } finally {
        log.restore();
      }
    });
  });

  describe('the control information', () => {
    it('gives the series, the type and the paths as read-only snapshot fields', async () => {
      mockFocasInstance.readSystemInfo.mockReturnValue({ cncType: '0', mtType: 'T' });
      await connector.connect();
      await connector.poll();

      expect(connector.getDataSnapshot().custom).toMatchObject({ controlSeries: '0', controlType: 'T', lathe: true, paths: 1 });
    });

    it('leaves the information out when the control cannot give it', async () => {
      mockFocasInstance.readSystemInfo.mockImplementation(() => { throw new FocasError('Failed to read system information: Busy', -1); });
      mockFocasInstance.readPathCount.mockImplementation(() => { throw new FocasError('Failed to read path count: No option error', 6); });

      await connector.connect();
      await connector.poll();

      expect(connector.connected).toBe(true);
      expect(connector.getDataSnapshot().custom).not.toHaveProperty('controlSeries');
      expect(connector.getDataSnapshot().custom).not.toHaveProperty('paths');
    });

    it('warns once that only path 1 is read, when the control has more paths', async () => {
      const log = captureLog();
      try {
        mockFocasInstance.readPathCount.mockReturnValue(2);
        await connector.connect();
        connector.disconnect();
        await connector.connect();

        expect(log.text('warn').match(/more than one path/g)).toHaveLength(1);
      } finally {
        log.restore();
      }
    });

    it('refuses a Series 15 control, whose status has another layout', async () => {
      mockFocasInstance.readSystemInfo.mockReturnValue({ cncType: '15', mtType: 'M' });

      await expect(connector.connect()).rejects.toThrow('Series 15');
      expect(connector.connected).toBe(false);
      expect(mockFocasInstance.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('poll error recovery', () => {
    it('should continue polling when spindle read fails', async () => {
      mockFocasInstance.readSpindleSpeed.mockImplementation(() => {
        throw new Error('Spindle read error');
      });

      await connector.connect();
      const status = await connector.poll();

      // Poll should succeed, just without spindle data
      expect(connector.connected).toBe(true);
      expect(status.errors).toEqual([]);
      expect(status.data.mode).toBe('MEM');
      expect(status.data.program).toBe('O1234');
      expect(status.data.spindleSpeed).toBeUndefined();
    });

    it('should continue polling when program read fails', async () => {
      mockFocasInstance.readProgram.mockImplementation(() => {
        throw new Error('Program read error');
      });

      await connector.connect();
      const status = await connector.poll();

      // Poll should succeed, just without program data
      expect(connector.connected).toBe(true);
      expect(status.errors).toEqual([]);
      expect(status.data.mode).toBe('MEM');
      expect(status.data.spindleSpeed).toBe(5000);
      expect(status.data.program).toBeUndefined();
    });

    it('should disconnect and return error when status read fails', async () => {
      await connector.connect();
      expect(connector.connected).toBe(true);

      // Make status read fail on first poll
      mockFocasInstance.readStatus.mockImplementation(() => {
        throw new Error('Status read error');
      });

      const status = await connector.poll();

      // Should have disconnected
      expect(connector.connected).toBe(false);
      // Should have error recorded
      expect(status.errors.length).toBeGreaterThan(0);
      expect(status.errors[0]).toContain('Poll failed');
    });

    it('should add error and return status when reconnect fails during poll', async () => {
      // Start disconnected
      expect(connector.connected).toBe(false);

      // Make connect fail
      mockFocasInstance.connect.mockImplementation(() => {
        throw new Error('Connection refused');
      });

      const status = await connector.poll();

      // Should still be disconnected
      expect(connector.connected).toBe(false);
      // Should have error
      expect(status.errors.length).toBeGreaterThan(0);
      expect(status.errors[0]).toContain('Connection failed');
    });

    it('should recover on subsequent poll after error', async () => {
      await connector.connect();

      // First poll fails
      mockFocasInstance.readStatus.mockImplementationOnce(() => {
        throw new Error('Temporary error');
      });

      const failedStatus = await connector.poll();
      expect(connector.connected).toBe(false);
      expect(failedStatus.errors.length).toBeGreaterThan(0);

      // Reset mock for successful reconnect
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'RUN',
        emergency: false,
        alarm: false,
        motion: 0,
      });

      // Second poll should reconnect and succeed
      const recoveredStatus = await connector.poll();
      expect(connector.connected).toBe(true);
      expect(recoveredStatus.errors).toEqual([]);
      expect(recoveredStatus.data.mode).toBe('MEM');
    });

    it('should handle readAlarms failure and fall back to status.alarm flag', async () => {
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'STOP',
        emergency: false,
        alarm: true,
        motion: 0,
      });
      mockFocasInstance.readAlarms.mockImplementation(() => {
        throw new Error('Alarm read error');
      });

      await connector.connect();
      const status = await connector.poll();

      // Should still show alarm from status flag
      expect(status.data.alarm).toBe(true);
      // With a general code and message, since the read failed
      expect(status.data.alarmCode).toBe('ALARM');
      expect(status.data.alarmMessage).toBe('Alarm active (the control gave no details)');
    });

    it('should handle readOperatorMessages failure silently', async () => {
      mockFocasInstance.readOperatorMessages.mockImplementation(() => {
        throw new Error('Operator message read error');
      });

      await connector.connect();
      const status = await connector.poll();

      // Poll should complete successfully
      expect(status.connected).toBe(true);
      expect(status.errors).toEqual([]);
      // Operator message should be undefined
      expect(status.data.operatorMessage).toBeUndefined();
    });
  });

  describe('data change events', () => {
    it('should emit data event when values change', async () => {
      const dataHandler = vi.fn();
      connector.on('data', dataHandler);

      await connector.connect();
      await connector.poll();

      expect(dataHandler).toHaveBeenCalled();
    });

    it('should not emit data event when values unchanged', async () => {
      await connector.connect();
      await connector.poll();

      const dataHandler = vi.fn();
      connector.on('data', dataHandler);

      // Poll again with same data
      await connector.poll();

      // Handler should not be called since data didn't change
      expect(dataHandler).not.toHaveBeenCalled();
    });

    it('should emit correct change labels and values in data event', async () => {
      const dataHandler = vi.fn();
      connector.on('data', dataHandler);

      await connector.connect();
      await connector.poll();

      expect(dataHandler).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: 'mode', value: 'MEM' }),
          expect.objectContaining({ label: 'runState', value: 'RUN' }),
          expect.objectContaining({ label: 'spindleSpeed', value: 5000 }),
        ])
      );
    });

    it('should only emit changed values on subsequent polls', async () => {
      await connector.connect();
      await connector.poll();

      const dataHandler = vi.fn();
      connector.on('data', dataHandler);

      // Change only spindle speed
      mockFocasInstance.readSpindleSpeed.mockReturnValue({ speed: 6000 });

      await connector.poll();

      expect(dataHandler).toHaveBeenCalledWith([
        { label: 'spindleSpeed', value: 6000 },
      ]);
    });
  });

  describe('macro read failures', () => {
    it('should handle toolNumberVariable read failure gracefully', async () => {
      const macroConnector = new FanucConnector({
        name: 'MacroFanuc',
        host: '192.168.1.100',
        toolNumberVariable: 500,
      });

      mockFocasInstance.readMacro.mockImplementation(() => {
        throw new Error('Macro not found');
      });

      await macroConnector.connect();
      const status = await macroConnector.poll();

      // Poll should complete successfully
      expect(status.connected).toBe(true);
      expect(status.errors).toEqual([]);
      // Tool number should be undefined due to error
      expect(status.data.toolNumber).toBeUndefined();
    });

    it('should handle partCounterVariable read failure gracefully', async () => {
      const macroConnector = new FanucConnector({
        name: 'MacroFanuc',
        host: '192.168.1.100',
        partCounterVariable: 501,
      });

      mockFocasInstance.readMacro.mockImplementation(() => {
        throw new Error('Macro not found');
      });

      await macroConnector.connect();
      const status = await macroConnector.poll();

      // Poll should complete successfully
      expect(status.connected).toBe(true);
      expect(status.errors).toEqual([]);
      // Part count should be undefined due to error
      expect(status.data.partCount).toBeUndefined();
    });

    it('should use macro location as label when name is undefined', async () => {
      const macroConnector = new FanucConnector({
        name: 'MacroFanuc',
        host: '192.168.1.100',
        macros: [
          { location: 100 }, // No name provided
        ],
      });

      mockFocasInstance.readMacro.mockReturnValue({ value: 42.5 });

      await macroConnector.connect();
      const status = await macroConnector.poll();

      // Should use macro_<location> as the label
      expect(status.data['macro_100']).toBe(42.5);
    });

    it('should handle partial macro read failures in custom macros', async () => {
      const macroConnector = new FanucConnector({
        name: 'MacroFanuc',
        host: '192.168.1.100',
        macros: [
          { location: 100, name: 'goodMacro' },
          { location: 200, name: 'badMacro' },
          { location: 300, name: 'anotherGood' },
        ],
      });

      let callCount = 0;
      mockFocasInstance.readMacro.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Macro 200 not found');
        }
        return { value: callCount * 10 };
      });

      await macroConnector.connect();
      const status = await macroConnector.poll();

      // Should have values for macros that succeeded
      expect(status.data['goodMacro']).toBe(10);
      expect(status.data['badMacro']).toBeUndefined();
      expect(status.data['anotherGood']).toBe(30);
    });
  });

  describe('program name handling', () => {
    it('should use O-number format when program name is empty string', async () => {
      mockFocasInstance.readProgram.mockReturnValue({ name: '', number: 5678 });

      await connector.connect();
      const status = await connector.poll();

      expect(status.data.program).toBe('O5678');
    });

    it('should use program name when available', async () => {
      mockFocasInstance.readProgram.mockReturnValue({ name: 'PART_A', number: 1234 });

      await connector.connect();
      const status = await connector.poll();

      expect(status.data.program).toBe('PART_A');
    });
  });

  describe('alarm clearing', () => {
    it('should clear alarm data when transitioning from alarm to no-alarm state', async () => {
      // First poll with alarm
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'STOP',
        emergency: false,
        alarm: true,
        motion: 0,
      });
      mockFocasInstance.readAlarms.mockReturnValue([
        { alarmNo: 1001, message: 'Spindle error' },
      ]);

      await connector.connect();
      let status = await connector.poll();

      expect(status.data.alarm).toBe(true);
      expect(status.data.alarmCode).toBe('1001');
      expect(status.data.alarmMessage).toBe('Spindle error');

      // Second poll with no alarm
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'RUN',
        emergency: false,
        alarm: false,
        motion: 0,
      });
      mockFocasInstance.readAlarms.mockReturnValue([]);

      status = await connector.poll();

      expect(status.data.alarm).toBe(false);
      expect(status.data.alarmCode).toBeUndefined();
      expect(status.data.alarmMessage).toBeUndefined();
    });

    it('should handle multiple alarms by using first alarm code', async () => {
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'STOP',
        emergency: false,
        alarm: true,
        motion: 0,
      });
      mockFocasInstance.readAlarms.mockReturnValue([
        { alarmNo: 1001, message: 'First alarm' },
        { alarmNo: 2002, message: 'Second alarm' },
        { alarmNo: 3003, message: 'Third alarm' },
      ]);

      await connector.connect();
      const status = await connector.poll();

      // Should use first alarm
      expect(status.data.alarm).toBe(true);
      expect(status.data.alarmCode).toBe('1001');
      expect(status.data.alarmMessage).toBe('First alarm');
    });

    it('should detect alarm from readAlarms even when status.alarm is false', async () => {
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'RUN',
        emergency: false,
        alarm: false, // Status says no alarm
        motion: 0,
      });
      mockFocasInstance.readAlarms.mockReturnValue([
        { alarmNo: 500, message: 'Hidden alarm' },
      ]);

      await connector.connect();
      const status = await connector.poll();

      // Should detect alarm from readAlarms
      expect(status.data.alarm).toBe(true);
      expect(status.data.alarmCode).toBe('500');
      expect(status.data.alarmMessage).toBe('Hidden alarm');
    });
  });

  describe('operator message handling', () => {
    it('should update operator message when it changes between polls', async () => {
      mockFocasInstance.readOperatorMessages.mockReturnValue([
        { number: 1, type: 0, message: 'First message' },
      ]);

      await connector.connect();
      let status = await connector.poll();
      expect(status.data.operatorMessage).toBe('First message');

      // Change message
      mockFocasInstance.readOperatorMessages.mockReturnValue([
        { number: 2, type: 0, message: 'Updated message' },
      ]);

      status = await connector.poll();
      expect(status.data.operatorMessage).toBe('Updated message');
    });

    it('should select last non-filtered message from multiple messages', async () => {
      const filterConnector = new FanucConnector({
        name: 'FilterFanuc',
        host: '192.168.1.100',
        ignoredMessageTypes: [4],
      });

      mockFocasInstance.readOperatorMessages.mockReturnValue([
        { number: 1, type: 0, message: 'Message A' },
        { number: 2, type: 0, message: 'Message B' },
        { number: 3, type: 4, message: 'Filtered message' },
      ]);

      await filterConnector.connect();
      const status = await filterConnector.poll();

      // Should get last non-filtered message
      expect(status.data.operatorMessage).toBe('Message B');
    });
  });

  describe('checkConnection edge cases', () => {
    it('should return false after a poll whose status read fails', async () => {
      await connector.connect();
      expect(connector.checkConnection()).toBe(true);

      mockFocasInstance.readStatus.mockImplementation(() => {
        throw new Error('Connection lost');
      });
      await connector.poll();

      expect(connector.checkConnection()).toBe(false);
    });

    it('should answer without a FOCAS call, which could wait for the control', async () => {
      await connector.connect();
      mockFocasInstance.readStatus.mockClear();

      expect(connector.checkConnection()).toBe(true);
      expect(mockFocasInstance.readStatus).not.toHaveBeenCalled();
    });

    it('should return false when focas is null', () => {
      // Not connected, focas is null
      expect(connector.checkConnection()).toBe(false);
    });
  });

  describe('getDataSnapshot', () => {
    it('should return standardized snapshot with all fields', async () => {
      await connector.connect();
      await connector.poll();

      const snapshot = connector.getDataSnapshot();

      // Check identification fields
      expect(snapshot.machineId).toBe(connector.id);
      expect(snapshot.machineType).toBe('fanuc');
      expect(snapshot.connected).toBe(true);
      expect(snapshot.timestamp).toBeDefined();

      // Check standard operational fields
      expect(snapshot.mode).toBe('MEM');
      expect(snapshot.runState).toBe('RUN');
      expect(snapshot.program).toBe('O1234');
      expect(snapshot.spindleSpeed).toBe(5000);

      // Check alarm fields
      expect(snapshot.alarm).toBe(false);
      expect(snapshot.emergency).toBe(false);
    });

    it('should include alarm data when alarm is active', async () => {
      mockFocasInstance.readStatus.mockReturnValue({
        mode: 'MEM',
        runState: 'STOP',
        emergency: false,
        alarm: true,
        motion: 0,
      });
      mockFocasInstance.readAlarms.mockReturnValue([
        { alarmNo: 1001, message: 'Spindle error' },
      ]);

      await connector.connect();
      await connector.poll();

      const snapshot = connector.getDataSnapshot();

      expect(snapshot.alarm).toBe(true);
      expect(snapshot.alarmCode).toBe('1001');
      expect(snapshot.alarmMessage).toBe('Spindle error');
    });

    it('should include macros in custom field', async () => {
      const macroConnector = new FanucConnector({
        name: 'MacroFanuc',
        host: '192.168.1.100',
        macros: [
          { location: 100, name: 'feedOverride' },
          { location: 200, name: 'spindleLoad' },
        ],
      });

      let callCount = 0;
      mockFocasInstance.readMacro.mockImplementation(() => {
        callCount++;
        return { value: callCount * 25.5 };
      });

      await macroConnector.connect();
      await macroConnector.poll();

      const snapshot = macroConnector.getDataSnapshot();

      expect(snapshot.custom).toBeDefined();
      expect(snapshot.custom?.feedOverride).toBe(25.5);
      expect(snapshot.custom?.spindleLoad).toBe(51);
    });

    it('should include operator message in custom field', async () => {
      mockFocasInstance.readOperatorMessages.mockReturnValue([
        { number: 1, type: 0, message: 'Tool change required' },
      ]);

      await connector.connect();
      await connector.poll();

      const snapshot = connector.getDataSnapshot();

      expect(snapshot.custom?.operatorMessage).toBe('Tool change required');
    });

    it('should return snapshot even when disconnected', () => {
      const snapshot = connector.getDataSnapshot();

      expect(snapshot.machineId).toBe(connector.id);
      expect(snapshot.machineType).toBe('fanuc');
      expect(snapshot.connected).toBe(false);
      expect(snapshot.timestamp).toBeDefined();
    });
  });
});
