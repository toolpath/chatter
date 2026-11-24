import { describe, it, expect, afterEach, vi } from 'vitest';
import { BrotherConnector } from './BrotherConnector.js';
import type { BrotherMachineConfig } from '../../types/index.js';
import { MEM_NO_RUN_STATE, MEM_RUNNING, MOCK_RESPONSES, connectedBrother } from './testSupport.js';

/** The state poll: the values that it reads, the status, the snapshot and the poll times */

function newConnector(config: Partial<BrotherMachineConfig> = {}): BrotherConnector {
  return new BrotherConnector({ name: 'Test', host: '192.168.1.100', ...config });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a new Brother connector', () => {
  it('should initialize with correct defaults', () => {
    const connector = newConnector({ host: '127.0.0.1', dataPort: 10000 });

    expect(connector.host).toBe('127.0.0.1');
    expect(connector.dataPort).toBe(10000);
    expect(connector.connected).toBe(false);
  });

  it('should use default port 10000', () => {
    expect(newConnector().dataPort).toBe(10000);
  });

  it('should generate id with brother_ prefix', () => {
    expect(newConnector().id).toMatch(/^brother_\d+$/);
  });

  it('should default to inches unit', () => {
    expect(newConnector().defaultUnit).toBe('in');
  });

  it('should accept metric unit', () => {
    expect(newConnector({ defaultUnit: 'mm' }).defaultUnit).toBe('mm');
  });

  it('is not connected after disconnect', () => {
    const { connector } = connectedBrother();
    expect(connector.connected).toBe(true);

    connector.disconnect();

    expect(connector.connected).toBe(false);
  });

  it('checkConnection is false when not connected', () => {
    expect(newConnector().checkConnection()).toBe(false);
  });

  it('rejects a command when not connected', async () => {
    await expect(newConnector().sendCommand('PANEL')).rejects.toThrow('Not connected');
  });
});

describe('Brother status', () => {
  it('should return current status object', () => {
    const { connector } = connectedBrother(MOCK_RESPONSES, { id: 'test_brother', name: 'FakeBrother' });

    const status = connector.getStatus();

    expect(status.id).toBe('test_brother');
    expect(status.name).toBe('FakeBrother');
    expect(status.host).toBe('127.0.0.1');
    expect(status.connected).toBe(true);
    expect(status.type).toBe('brother');
    expect(status.data).toBeDefined();
  });

  it('should use camelCase field names in status data', () => {
    const status = newConnector().getStatus();

    expect(status.data).not.toHaveProperty('Mode');
    expect(status.data).not.toHaveProperty('Part Count');
    expect(status.data).not.toHaveProperty('Tool Number');
  });

  it('should include macros in status when configured', () => {
    const macroConnector = newConnector({
      macros: [
        { location: 100, name: 'Custom Var' },
        { location: 200 }
      ]
    });

    const status = macroConnector.getStatus();

    expect(status.macros).toHaveLength(2);
    expect(status.macros![0].location).toBe(100);
    expect(status.macros![0].name).toBe('Custom Var');
    expect(status.macros![1].location).toBe(200);
  });

  it('should update macros via updateMacros method', () => {
    const connector = newConnector();
    expect(connector.macros).toHaveLength(0);

    connector.updateMacros([{ location: 500, name: 'New Macro' }]);

    expect(connector.macros).toHaveLength(1);
    expect(connector.macros[0].location).toBe(500);
    expect(connector.macros[0].name).toBe('New Macro');
  });

  it('reads a macro that updateMacros added in the next poll', async () => {
    const fake = connectedBrother({ ...MOCK_RESPONSES, MCRNI1: 'RLOD    MCRNI1  00\r\nC500, 42.0000\r\n\r\n00%' });
    fake.connector.updateMacros([{ location: 500, name: 'New Macro' }]);

    await fake.connector.poll();

    expect(fake.sent).toContain('MCRNI1');
    expect(fake.connector.getDataSnapshot().custom).toMatchObject({ 'New Macro': 42 });
  });
});

describe('Brother poll times in the status', () => {
  it('has no poll times before the first poll', () => {
    expect(newConnector().getStatus().pollTimings).toBeUndefined();
  });

  it('gives the time of each command and of the poll, and the poll limit', async () => {
    const { connector } = connectedBrother();
    connector.pollTimeLimitMs = 8000;

    const status = await connector.poll();

    expect(status.pollTimings?.limitMs).toBe(8000);
    expect(Object.keys(status.pollTimings?.lastPoll.commands ?? {}).sort())
      .toEqual(['ALARM', 'MEM', 'PANEL', 'PDSP', 'WKCNTR']);
    expect(status.pollTimings?.commands.PANEL.samples).toBe(1);
    expect(status.pollTimings?.poll.samples).toBe(1);
  });

  it('does not show the commands of a tool read in the times of the last poll', async () => {
    const { connector } = connectedBrother();

    await connector.poll();
    await connector.requestToolSync();

    const timings = connector.getStatus().pollTimings!;
    expect(Object.keys(timings.lastPoll.commands).sort()).toEqual(['ALARM', 'MEM', 'PANEL', 'PDSP', 'WKCNTR']);
    expect(timings.commands.ATCTL.samples).toBe(1);
  });

  it('records a poll that fails, so a slow machine shows its times', async () => {
    const fake = connectedBrother();
    fake.fail('MEM');

    const status = await fake.connector.poll();

    expect(status.errors.join(';')).toContain('No reply for MEM');
    expect(status.pollTimings?.lastPoll.commands).toHaveProperty('MEM');
  });
});

describe('Brother Data Snapshot', () => {
  const connector = newConnector({ name: 'SnapshotTest', macros: [{ location: 100, name: 'TestMacro' }] });

  it('should include machine identification', () => {
    const snapshot = connector.getDataSnapshot();

    expect(snapshot.machineId).toBeDefined();
    expect(snapshot.machineType).toBe('brother');
    expect(snapshot.timestamp).toBeDefined();
  });

  it('should include connection status', () => {
    expect(connector.getDataSnapshot().connected).toBe(false);
  });

  it('should include standard fields', () => {
    const snapshot = connector.getDataSnapshot();

    // These may be undefined when not connected, but the fields should exist
    expect('mode' in snapshot).toBe(true);
    expect('program' in snapshot).toBe(true);
    expect('spindleSpeed' in snapshot).toBe(true);
    expect('toolNumber' in snapshot).toBe(true);
    expect('partCount' in snapshot).toBe(true);
    expect('partGoal' in snapshot).toBe(true);
  });

  it('should include alarm fields', () => {
    const snapshot = connector.getDataSnapshot();

    expect('alarm' in snapshot).toBe(true);
    expect('alarmCode' in snapshot).toBe(true);
  });
});

describe('Brother run state from a poll', () => {
  it('reads index 2 of the MEM A01 line, the operation status, so the history can record the running time', async () => {
    const { connector } = connectedBrother({ ...MOCK_RESPONSES, MEM: MEM_RUNNING });

    const status = await connector.poll();

    expect(status.data.execution).toBe('ACTIVE');
    expect(connector.getDataSnapshot().execution).toBe('ACTIVE');
  });

  it('gives no run state when the control sends no operation status', async () => {
    const { connector } = connectedBrother({ ...MOCK_RESPONSES, MEM: MEM_NO_RUN_STATE });

    await connector.poll();

    expect(connector.getDataSnapshot().execution).toBeUndefined();
  });
});

describe('Brother macros in a poll', () => {
  it('sends no macro command when no macro is set', async () => {
    const fake = connectedBrother();

    await fake.connector.poll();
    await fake.connector.toolSyncEnded();

    expect(fake.sent.some(command => command.startsWith('MCRN'))).toBe(false);
  });
});

/** An empty slot of the alarm list: 10 spaces, as the control sends it */
const EMPTY_ALARM_SLOT = ' '.repeat(10);
/** The alarm list has about 36 slots */
const ALARM_SLOTS = 36;

/**
 * An ALARM reply in the shape of a real Speedio X500 (C00): E01 with each alarm slot, then L01.
 * `slots` are the first slots; the others are empty.
 */
function alarmReply(slots: string[]): string {
  const e01 = [...slots, ...Array(ALARM_SLOTS - slots.length).fill(EMPTY_ALARM_SLOT)].join(',');
  const l01 = Array(ALARM_SLOTS).fill(' '.repeat(11)).join(',');
  return `RLOD    ALARM   00\r\nE01,${e01}\r\nL01,${l01}\r\n\r\n12%`;
}

/** A communication message (CM, category 09). A Speedio adds one after it gets a command that it does not know. */
const CM_ENTRY = '0975220008';
const SV_ALARM = '0312345678';

describe('Brother alarm from the whole alarm list', () => {
  async function alarmOf(slots: string[]) {
    const status = await connectedBrother({ ...MOCK_RESPONSES, ALARM: alarmReply(slots) }).connector.poll();
    return { alarm: status.data.alarm, alarmCode: status.data.alarmCode };
  }

  it('gives no alarm for an empty list', async () => {
    expect(await alarmOf([])).toEqual({ alarm: false, alarmCode: '' });
  });

  it('gives no alarm when the list has only a communication message', async () => {
    expect(await alarmOf([CM_ENTRY])).toEqual({ alarm: false, alarmCode: '' });
  });

  it('finds a real alarm after a communication message in the first slot', async () => {
    expect(await alarmOf([CM_ENTRY, SV_ALARM])).toEqual({ alarm: true, alarmCode: 'SV12345678' });
  });

  it('finds a real alarm in the first slot, as before', async () => {
    expect(await alarmOf([SV_ALARM])).toEqual({ alarm: true, alarmCode: 'SV12345678' });
  });

  it('gives the code of the first real alarm when there are more, and skips "no alarm" entries', async () => {
    expect(await alarmOf(['9000000000', '0512340000', SV_ALARM])).toEqual({ alarm: true, alarmCode: 'IO12340000' });
  });
});
