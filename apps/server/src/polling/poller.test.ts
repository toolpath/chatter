import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import type { Database } from 'better-sqlite3';
import { HardwarePoller } from './poller.js';
import { Focas } from '../machines/fanuc/focas.js';
import { BrotherConnector } from '../machines/brother/BrotherConnector.js';
import type { BrotherMachineConfig, FanucMachineConfig } from '../types/index.js';

interface MockStatement {
  run: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
}

interface MockDb {
  prepare: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  pragma: ReturnType<typeof vi.fn>;
}

const SPEEDIO = { name: 'Speedio', host: '192.168.1.50' };
const ROBODRILL = { name: 'Robodrill', host: '192.168.1.100' };

const FANUC_ROW = {
  id: 'fanuc_1', name: 'Robodrill', host: '192.168.1.100', focas_port: 8193, ftp_port: 21,
  ftp_user: 'anonymous', ftp_password: '', ignored_message_types: '[]', macros: '[]', created_at: new Date().toISOString(),
};

/** A mock database with the SQLite API */
function createMockDb(): MockDb {
  const mockStatement: MockStatement = {
    run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    get: vi.fn().mockReturnValue(undefined),
    all: vi.fn().mockReturnValue([]),
  };

  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    exec: vi.fn(),
    pragma: vi.fn().mockReturnValue([]),
  };
}

describe('HardwarePoller', () => {
  let poller: HardwarePoller;
  let mockDb: MockDb;

  beforeEach(() => {
    // The FANUC FOCAS library is not in the repo, so pretend it is installed.
    // These tests never connect to a machine, so the library is not loaded.
    vi.spyOn(Focas, 'isAvailable').mockReturnValue(true);
    mockDb = createMockDb();
    poller = new HardwarePoller(mockDb as unknown as Database);
  });

  const addSpeedio = (settings: Partial<BrotherMachineConfig> = {}) => poller.addBrotherMachine({ ...SPEEDIO, ...settings });
  const addRobodrill = (settings: Partial<FanucMachineConfig> = {}) => poller.addFanucMachine({ ...ROBODRILL, ...settings });

  /** The SELECT of each machine table gives these rows. The poller loads the tables in this order. */
  /** The saved rows of each machine table, picked by the table that the query names */
  function mockSavedRows(rowsByTable: { brother?: object[]; fanuc?: object[]; siemens?: object[] }) {
    mockDb.prepare.mockImplementation((sql: string) => {
      const type = /FROM (\w+)_machines/.exec(sql)?.[1] as keyof typeof rowsByTable | undefined;
      return { run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue((type && rowsByTable[type]) ?? []) };
    });
  }

  describe('constructor', () => {
    it('initializes with no machines', () => {
      expect(poller.getMachines().length).toBe(0);
      expect(poller.getBrotherMachines().length).toBe(0);
    });
  });

  describe('setInterval', () => {
    it('accepts a new polling interval', () => {
      expect(() => poller.setInterval(10000)).not.toThrow();
    });
  });

  describe('polling', () => {
    it('emits update event after polling', async () => {
      const updateHandler = vi.fn();
      poller.on('update', updateHandler);

      await poller.poll();

      expect(updateHandler).toHaveBeenCalled();
    });

    it('emits update events when a machine is added, changed, and removed', async () => {
      const updateHandler = vi.fn();
      poller.on('update', updateHandler);

      const machine = await addSpeedio();
      await poller.updateMachine(machine.id, { name: 'Speedio 2' });
      await poller.removeMachine(machine.id);

      expect(updateHandler).toHaveBeenCalledTimes(3);
      expect(updateHandler.mock.calls[1][0][0].name).toBe('Speedio 2');
      expect(updateHandler.mock.calls[2][0]).toEqual([]);
    });

    it('removes the machine from every recorder, also when one recorder fails', async () => {
      const failing = { record: vi.fn(), removeMachine: vi.fn(() => { throw new Error('disk full'); }) };
      const working = { record: vi.fn(), removeMachine: vi.fn() };
      poller.addRecorder(failing);
      poller.addRecorder(working);
      const machine = await addSpeedio();

      await expect(poller.removeMachine(machine.id)).resolves.toBe(true);

      expect(working.removeMachine).toHaveBeenCalledWith(machine.id);
    });

    it('tells a removal listener which machine was removed', async () => {
      const listener = { removeMachine: vi.fn() };
      poller.addRemovalListener(listener);
      const machine = await addSpeedio();

      await poller.removeMachine(machine.id);

      expect(listener.removeMachine).toHaveBeenCalledWith(machine.id);
    });

    it('gives each poll and each removed machine to every recorder', async () => {
      vi.spyOn(BrotherConnector.prototype, 'poll').mockResolvedValue({} as never);
      const recorders = [1, 2].map(() => ({ record: vi.fn(), removeMachine: vi.fn() }));
      recorders.forEach(recorder => poller.addRecorder(recorder));
      const machine = await addSpeedio();
      // start() polls each machine at once. Only a started machine gets history.
      poller.start();
      await vi.waitFor(() => recorders.forEach(recorder => expect(recorder.record).toHaveBeenCalled()));
      await poller.removeMachine(machine.id);
      poller.stop();

      for (const recorder of recorders) {
        expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ id: machine.id }));
        expect(recorder.removeMachine).toHaveBeenCalledWith(machine.id);
      }
    });
  });

  describe('connecting', () => {
    const CONNECTING_TIME_MS = 30000;
    /** The last machine list that the poller sent */
    const lastUpdateOf = (updates: ReturnType<typeof vi.fn>) => updates.mock.calls.at(-1)?.[0] as { id: string; connecting?: boolean }[];

    beforeEach(() => {
      // A poll that never ends, so the machine never connects
      vi.spyOn(BrotherConnector.prototype, 'poll').mockReturnValue(new Promise(() => {}));
    });

    afterEach(() => {
      poller.stop();
      vi.useRealTimers();
    });

    it('says a machine that was just added is connecting, in the answer and in the status', async () => {
      poller.start();
      const machine = await addSpeedio();

      expect(machine.connecting).toBe(true);
      expect(poller.getMachine(machine.id)?.connecting).toBe(true);
    });

    it('says a machine is not connecting when the poller does not poll it', async () => {
      const machine = await addSpeedio();

      expect(machine.connecting).toBe(false);
    });

    it('sends an update when the connecting time ends with no good poll', async () => {
      vi.useFakeTimers();
      poller.start();
      const machine = await addSpeedio();
      const updates = vi.fn();
      poller.on('update', updates);

      await vi.advanceTimersByTimeAsync(CONNECTING_TIME_MS - 1);
      expect(updates).toHaveBeenCalled();
      expect(lastUpdateOf(updates).find(status => status.id === machine.id)?.connecting).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      expect(lastUpdateOf(updates).find(status => status.id === machine.id)?.connecting).toBe(false);
    });
  });

  describe('addBrotherMachine', () => {
    it('adds a Brother machine to the map', async () => {
      const machine = await addSpeedio({ dataPort: 10000, ftpPort: 21 });

      expect(machine.name).toBe('Speedio');
      expect(machine.host).toBe('192.168.1.50');
      expect(machine.id).toMatch(/^brother_/);
      expect(poller.getBrotherMachines().length).toBe(1);
    });

    it('inserts machine into database', async () => {
      await addSpeedio();

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO brother_machines')
      );
    });

    it('uses default values when not provided', async () => {
      const machine = await addSpeedio();

      // BrotherMachineStatus includes dataPort and ftpPort
      expect(machine.dataPort).toBe(10000);
      expect(machine.ftpPort).toBe(21);

      // ftpUser, ftpPassword, defaultUnit are internal config - check via connector
      const connector = poller.getConnector(machine.id);
      expect(connector?.ftpUser).toBe('anonymous');
      expect(connector?.ftpPassword).toBe('');
    });

    it('creates a connector for the machine', async () => {
      const machine = await addSpeedio();

      const connector = poller.getConnector(machine.id);
      expect(connector).toBeDefined();
      expect(connector?.host).toBe('192.168.1.50');
    });
  });

  describe('updateBrotherMachine', () => {
    it('updates machine properties', async () => {
      const machine = await addSpeedio();

      const updated = await poller.updateBrotherMachine(machine.id, {
        name: 'Speedio Updated',
        host: '192.168.1.100'
      });

      expect(updated?.name).toBe('Speedio Updated');
      expect(updated?.host).toBe('192.168.1.100');
    });

    it('updates database record', async () => {
      const machine = await addSpeedio();
      mockDb.prepare.mockClear();

      await poller.updateBrotherMachine(machine.id, { name: 'New Name' });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE brother_machines')
      );
    });

    it('returns null for non-existent machine', async () => {
      const result = await poller.updateBrotherMachine('non-existent', { name: 'Test' });
      expect(result).toBeNull();
    });

    it('updates connector configuration', async () => {
      const machine = await addSpeedio({ ftpPort: 21 });

      await poller.updateBrotherMachine(machine.id, {
        host: '192.168.1.100',
        ftpPort: 2121
      });

      const connector = poller.getConnector(machine.id);
      expect(connector?.host).toBe('192.168.1.100');
      expect(connector?.ftpPort).toBe(2121);
    });

    it('only updates provided fields', async () => {
      const machine = await addSpeedio({ dataPort: 10000 });

      const updated = await poller.updateBrotherMachine(machine.id, { name: 'New Name' });

      expect(updated?.name).toBe('New Name');
      expect(updated?.host).toBe('192.168.1.50'); // unchanged
      expect(updated?.dataPort).toBe(10000); // unchanged
    });
  });

  describe('getBrotherMachines', () => {
    it('returns all Brother machines as array', async () => {
      // Use explicit IDs to avoid duplicate ID issues from Date.now()
      await poller.addBrotherMachine({ id: 'brother_test_1', name: 'Machine1', host: '192.168.1.50' });
      await poller.addBrotherMachine({ id: 'brother_test_2', name: 'Machine2', host: '192.168.1.51' });

      const machines = poller.getBrotherMachines();

      expect(machines).toHaveLength(2);
      expect(machines.map(m => m.name)).toContain('Machine1');
      expect(machines.map(m => m.name)).toContain('Machine2');
    });
  });

  describe('getConnector', () => {
    it('returns connector for existing machine', async () => {
      const machine = await addSpeedio();

      const connector = poller.getConnector(machine.id);

      expect(connector).toBeDefined();
      expect(connector?.name).toBe('Speedio');
    });

    it('returns undefined for non-existent machine', () => {
      const connector = poller.getConnector('non-existent');
      expect(connector).toBeUndefined();
    });

  });

  describe('removeMachine with a Brother machine', () => {
    it('removes machine from map', async () => {
      const machine = await addSpeedio();
      expect(poller.getBrotherMachines().length).toBe(1);

      const result = await poller.removeMachine(machine.id);

      expect(result).toBe(true);
      expect(poller.getBrotherMachines().length).toBe(0);
    });

    it('removes connector', async () => {
      const machine = await addSpeedio();
      expect(poller.getConnector(machine.id)).toBeDefined();

      await poller.removeMachine(machine.id);

      expect(poller.getConnector(machine.id)).toBeUndefined();
    });

    it('deletes from database', async () => {
      const machine = await addSpeedio();
      mockDb.prepare.mockClear();

      await poller.removeMachine(machine.id);

      expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM brother_machines WHERE id = ?');
    });
  });

  describe('loadFromDatabase with Brother machines', () => {
    it('loads machines and creates connectors from database', async () => {
      mockSavedRows({
        brother: [{
          id: 'brother_1', name: 'Speedio', host: '192.168.1.50', data_port: 10000, ftp_port: 21,
          ftp_user: 'admin', ftp_password: 'pass', default_unit: 'mm', macros: '[]', created_at: new Date().toISOString(),
        }],
      });

      await poller.loadFromDatabase();

      expect(poller.getBrotherMachines().length).toBe(1);
      const machine = poller.getBrotherMachines()[0];
      expect(machine.name).toBe('Speedio');
      expect(machine.host).toBe('192.168.1.50');

      const connector = poller.getConnector('brother_1');
      expect(connector).toBeDefined();
      expect(connector?.host).toBe('192.168.1.50');
      expect(connector?.ftpUser).toBe('admin');
    });
  });

  describe('addFanucMachine', () => {
    it('adds a FANUC machine to the map', async () => {
      const machine = await addRobodrill({ focasPort: 8193 });

      expect(machine.name).toBe('Robodrill');
      expect(machine.host).toBe('192.168.1.100');
      expect(machine.id).toMatch(/^fanuc_/);
      expect(poller.getFanucMachines().length).toBe(1);
    });

    it('inserts machine into database', async () => {
      await addRobodrill();

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO fanuc_machines')
      );
    });

    it('uses default values when not provided', async () => {
      const machine = await addRobodrill();

      expect(machine.focasPort).toBe(8193);
      expect(machine.ftpPort).toBe(21);
      expect(machine.ignoredMessageTypes).toEqual([]);
    });

    it('creates a connector for the machine', async () => {
      const machine = await addRobodrill();

      const connector = poller.getConnector(machine.id);
      expect(connector).toBeDefined();
      expect(connector?.host).toBe('192.168.1.100');
    });

    it('accepts toolNumberVariable configuration', async () => {
      const machine = await addRobodrill({ toolNumberVariable: 500 });

      expect(machine.toolNumberVariable).toBe(500);
    });

    it('accepts partCounterVariable configuration', async () => {
      const machine = await addRobodrill({ partCounterVariable: 501 });

      expect(machine.partCounterVariable).toBe(501);
    });

    it('accepts ignoredMessageTypes configuration', async () => {
      const machine = await addRobodrill({ ignoredMessageTypes: [0, 4, 5] });

      expect(machine.ignoredMessageTypes).toEqual([0, 4, 5]);
    });
  });

  describe('updateFanucMachine', () => {
    it('updates machine properties', async () => {
      const machine = await addRobodrill();

      const updated = await poller.updateFanucMachine(machine.id, {
        name: 'Robodrill Updated',
        host: '192.168.1.200',
      });

      expect(updated?.name).toBe('Robodrill Updated');
      expect(updated?.host).toBe('192.168.1.200');
    });

    it('updates database record', async () => {
      const machine = await addRobodrill();
      mockDb.prepare.mockClear();

      await poller.updateFanucMachine(machine.id, { name: 'New Name' });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE fanuc_machines')
      );
    });

    it('returns null for non-existent machine', async () => {
      const result = await poller.updateFanucMachine('non-existent', { name: 'Test' });
      expect(result).toBeNull();
    });

    it('updates connector configuration', async () => {
      const machine = await addRobodrill({ focasPort: 8193 });

      await poller.updateFanucMachine(machine.id, {
        host: '192.168.1.200',
        focasPort: 8194,
      });

      const connector = poller.getConnector(machine.id);
      expect(connector?.host).toBe('192.168.1.200');
    });

    it('updates ignoredMessageTypes', async () => {
      const machine = await addRobodrill({ ignoredMessageTypes: [] });

      const updated = await poller.updateFanucMachine(machine.id, {
        ignoredMessageTypes: [0, 4],
      });

      expect(updated?.ignoredMessageTypes).toEqual([0, 4]);
    });

    it('updates toolNumberVariable', async () => {
      const machine = await addRobodrill();

      const updated = await poller.updateFanucMachine(machine.id, {
        toolNumberVariable: 500,
      });

      expect(updated?.toolNumberVariable).toBe(500);
    });

    it('updates partCounterVariable', async () => {
      const machine = await addRobodrill();

      const updated = await poller.updateFanucMachine(machine.id, {
        partCounterVariable: 501,
      });

      expect(updated?.partCounterVariable).toBe(501);
    });

    it('only updates provided fields', async () => {
      const machine = await addRobodrill({ focasPort: 8193 });

      const updated = await poller.updateFanucMachine(machine.id, { name: 'New Name' });

      expect(updated?.name).toBe('New Name');
      expect(updated?.host).toBe('192.168.1.100'); // unchanged
      expect(updated?.focasPort).toBe(8193); // unchanged
    });
  });

  describe('getFanucMachines', () => {
    it('returns all FANUC machines as array', async () => {
      await poller.addFanucMachine({ id: 'fanuc_test_1', name: 'Machine1', host: '192.168.1.100' });
      await poller.addFanucMachine({ id: 'fanuc_test_2', name: 'Machine2', host: '192.168.1.101' });

      const machines = poller.getFanucMachines();

      expect(machines).toHaveLength(2);
      expect(machines.map(m => m.name)).toContain('Machine1');
      expect(machines.map(m => m.name)).toContain('Machine2');
    });
  });

  describe('removeMachine with a FANUC machine', () => {
    it('removes machine from map', async () => {
      const machine = await addRobodrill();
      expect(poller.getFanucMachines().length).toBe(1);

      const result = await poller.removeMachine(machine.id);

      expect(result).toBe(true);
      expect(poller.getFanucMachines().length).toBe(0);
    });

    it('removes connector', async () => {
      const machine = await addRobodrill();
      expect(poller.getConnector(machine.id)).toBeDefined();

      await poller.removeMachine(machine.id);

      expect(poller.getConnector(machine.id)).toBeUndefined();
    });

    it('disposes the connector, so its FOCAS thread stops', async () => {
      const machine = await addRobodrill();
      const dispose = vi.spyOn(poller.getConnector(machine.id)!, 'dispose');

      await poller.removeMachine(machine.id);

      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('deletes from database', async () => {
      const machine = await addRobodrill();
      mockDb.prepare.mockClear();

      await poller.removeMachine(machine.id);

      expect(mockDb.prepare).toHaveBeenCalledWith('DELETE FROM fanuc_machines WHERE id = ?');
    });
  });

  describe('loadFromDatabase with Siemens machines', () => {
    it('loads the saved Siemens machines, without giving out the OPC UA password', async () => {
      mockSavedRows({
        siemens: [{
          id: 'siemens_1', name: 'DNM 6700', host: '192.168.1.60', opcua_port: 4840, opcua_user: 'OpcUaClient',
          opcua_password: 'secret', opcua_security: 'signAndEncrypt', ftp_port: 21, ftp_user: 'anonymous',
          ftp_password: '', macros: '[{"location":5,"name":"Stock"}]',
        }],
      });

      await poller.loadFromDatabase();

      expect(poller.getMachine('siemens_1')).toMatchObject({
        type: 'siemens', name: 'DNM 6700', host: '192.168.1.60', opcuaPort: 4840, opcuaUser: 'OpcUaClient',
        hasOpcuaPassword: true, opcuaSecurity: 'signAndEncrypt', macros: [{ location: 5, name: 'Stock' }],
      });
      expect(JSON.stringify(poller.getMachines())).not.toContain('secret');
    });

    it('treats a security value it does not know as no security', async () => {
      mockSavedRows({
        siemens: [{ id: 'siemens_1', name: 'M', host: '192.168.1.60', opcua_port: 4840, opcua_user: '', opcua_password: '',
          opcua_security: 'something', ftp_port: 21, ftp_user: 'anonymous', ftp_password: '', macros: '[]' }],
      });
      await poller.loadFromDatabase();
      expect(poller.getMachine('siemens_1')).toMatchObject({ opcuaSecurity: 'none', opcuaUser: '', hasOpcuaPassword: false });
    });
  });

  describe('loadFromDatabase with FANUC machines', () => {
    it('starts the saved FANUC machines when the library comes after the start, one time only', async () => {
      vi.spyOn(Focas, 'isAvailable').mockReturnValue(false);
      await poller.loadFromDatabase();
      expect(poller.getFanucMachines()).toHaveLength(0);

      vi.spyOn(Focas, 'isAvailable').mockReturnValue(true);
      mockDb.prepare.mockReturnValue({ run: vi.fn(), get: vi.fn(), all: vi.fn().mockReturnValue([FANUC_ROW]) });
      poller.startFanucMachines();
      poller.startFanucMachines();

      expect(poller.getFanucMachines().map(machine => machine.name)).toEqual(['Robodrill']);
    });

    it('loads machines and creates connectors from database', async () => {
      mockSavedRows({
        fanuc: [{ ...FANUC_ROW, tool_number_variable: 500, part_counter_variable: 501, ignored_message_types: '[0, 4]' }],
      });

      await poller.loadFromDatabase();

      expect(poller.getFanucMachines().length).toBe(1);
      const machine = poller.getFanucMachines()[0];
      expect(machine.name).toBe('Robodrill');
      expect(machine.host).toBe('192.168.1.100');
      expect(machine.focasPort).toBe(8193);
      expect(machine.toolNumberVariable).toBe(500);
      expect(machine.partCounterVariable).toBe(501);
      expect(machine.ignoredMessageTypes).toEqual([0, 4]);

      const connector = poller.getConnector('fanuc_1');
      expect(connector).toBeDefined();
      expect(connector?.host).toBe('192.168.1.100');
    });

    it('handles empty ignoredMessageTypes from database', async () => {
      mockSavedRows({ fanuc: [{ ...FANUC_ROW, ignored_message_types: '[]' }] });

      await poller.loadFromDatabase();

      const machine = poller.getFanucMachines()[0];
      expect(machine.ignoredMessageTypes).toEqual([]);
    });

    it('handles null ignoredMessageTypes from database', async () => {
      mockSavedRows({ fanuc: [{ ...FANUC_ROW, ignored_message_types: null }] });

      await poller.loadFromDatabase();

      const machine = poller.getFanucMachines()[0];
      expect(machine.ignoredMessageTypes).toEqual([]);
    });
  });

  describe('getMachines', () => {
    it('returns all machines including FANUC', async () => {
      await addSpeedio({ id: 'brother_test' });
      await addRobodrill({ id: 'fanuc_test' });

      const machines = poller.getMachines();

      expect(machines).toHaveLength(2);
      expect(machines.map(m => m.type)).toContain('brother');
      expect(machines.map(m => m.type)).toContain('fanuc');
    });
  });

  describe('getMachine', () => {
    it('returns FANUC machine by id', async () => {
      await addRobodrill({ id: 'fanuc_test' });

      const machine = poller.getMachine('fanuc_test');

      expect(machine).toBeDefined();
      expect(machine?.name).toBe('Robodrill');
      expect(machine?.type).toBe('fanuc');
    });
  });
});

describe('HardwarePoller start with no machines', () => {
  let pollSpy: MockInstance<Parameters<BrotherConnector['poll']>, ReturnType<BrotherConnector['poll']>>;
  let poller: HardwarePoller;

  beforeEach(() => {
    vi.spyOn(Focas, 'isAvailable').mockReturnValue(true);
    pollSpy = vi.spyOn(BrotherConnector.prototype, 'poll').mockResolvedValue(undefined as never);
    poller = new HardwarePoller(createMockDb() as unknown as Database);
  });

  afterEach(() => {
    poller.stop();
    vi.restoreAllMocks();
  });

  it('polls a machine that is added after start', async () => {
    poller.start();
    await poller.addMachine({ type: 'brother', name: 'First machine', host: '127.0.0.1' });

    expect(pollSpy).toHaveBeenCalled();
  });

  it('does not poll a machine that is added before start', async () => {
    await poller.addMachine({ type: 'brother', name: 'First machine', host: '127.0.0.1' });

    expect(pollSpy).not.toHaveBeenCalled();
  });
});
