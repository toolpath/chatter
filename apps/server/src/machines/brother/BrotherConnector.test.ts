import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrotherConnector, TRANSFORMS, brotherCommand, parseValue } from './BrotherConnector.js';
import type { BrotherMachineConfig, DataItemTransform } from '../../types/index.js';

/**
 * Replies of a Brother control to each command, matching the Python test fixtures
 */
const MOCK_RESPONSES: Record<string, string> = {
  'PANEL': 'RLOD    PANEL   00\r\nD01,0,0,0\r\nK01,0,5,0,0,0,0,0,0,0,1,0\r\nS01,4,100,100,1,0,1,1\r\n\r\n10%',
  'MEM': "RLOD    MEM     00\r\nA01,'/       ',1001,0,0,0,0,0\r\n\r\n00%",
  'WKCNTR': 'RLOD    WKCNTR  00\r\nA01,  1,    78,   200,     0\r\nA02,  0,     0,     0,     0\r\n\r\n08%',
  'PDSP': "RLOD    PDSP    00\r\nX01,    0.000 ,     0,0,10,10,10,0,0,0,0,4,100,100, 0,0, 0\r\n\r\n03%",
  'ALARM': "RLOD    ALARM   00\r\nE01,0975320032,          ,          \r\n\r\n10%",
  'ATCTL': 'RLOD    ATCTL   00\r\nM02,  1,0,0\r\nM03,  2,0,0\r\n\r\n00%',
  'TOLNI1': "RLOD    TOLNI1  00\r\nT01, 1.5000, 0.0000, 0.2500, 0.0000, 0, 0, 0, 0, 'ENDMILL '\r\n\r\n00%"
};

function newConnector(config: Partial<BrotherMachineConfig> = {}): BrotherConnector {
  return new BrotherConnector({ name: 'Test', host: '192.168.1.100', ...config });
}

/** A connected connector that gets these replies; a command with no reply fails */
function connectorWithReplies(
  replies: Record<string, string>,
  config: Partial<BrotherMachineConfig> = {},
): BrotherConnector {
  const connector = newConnector({ id: 'b1', name: 'Speedio', host: '127.0.0.1', ...config });
  Object.assign(connector, { socket: {}, connected: true });
  vi.spyOn(connector, 'sendCommand').mockImplementation(async command => {
    if (!replies[command]) throw new Error(`No reply for ${command}`);
    return connector.parseResponse(replies[command]);
  });
  return connector;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BrotherConnector', () => {
  let connector: BrotherConnector;

  beforeEach(() => {
    connector = newConnector({ id: 'test_brother', name: 'FakeBrother', host: '127.0.0.1', dataPort: 10000, timeout: 5000 });
  });

  afterEach(() => {
    connector.disconnect();
  });

  describe('constructor', () => {
    it('should initialize with correct defaults', () => {
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
  });

  describe('disconnect', () => {
    it('should set connected to false', () => {
      connector.connected = true;
      connector.disconnect();

      expect(connector.connected).toBe(false);
    });
  });

  describe('checkConnection', () => {
    it('should return false when not connected', () => {
      expect(connector.checkConnection()).toBe(false);
    });
  });

  describe('sendCommand', () => {
    it('should reject when not connected', async () => {
      connector.connected = false;

      await expect(connector.sendCommand('PANEL')).rejects.toThrow('Not connected');
    });
  });

  describe('getStatus', () => {
    it('should return current status object', () => {
      connector.connected = true;

      const status = connector.getStatus();

      expect(status.id).toBe('test_brother');
      expect(status.name).toBe('FakeBrother');
      expect(status.host).toBe('127.0.0.1');
      expect(status.connected).toBe(true);
      expect(status.type).toBe('brother');
      expect(status.data).toBeDefined();
    });

    it('should use camelCase field names in status data', () => {
      const status = connector.getStatus();

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
  });

  describe('updateMacros', () => {
    it('should update macros via updateMacros method', () => {
      expect(connector.macros).toHaveLength(0);

      connector.updateMacros([{ location: 500, name: 'New Macro' }]);

      expect(connector.macros).toHaveLength(1);
      expect(connector.macros[0].location).toBe(500);
      expect(connector.macros[0].name).toBe('New Macro');
    });
  });
});

describe('brotherCommand', () => {
  it('should build a properly formatted CLOD command', () => {
    const cmd = brotherCommand('PANEL');

    expect(cmd.startsWith('%')).toBe(true);
    expect(cmd).toContain('CLOD');
    expect(cmd).toContain('PANEL');
    expect(cmd).toMatch(/\d{2}%\r\n$/);
  });

  it('should pad command names to 8 characters', () => {
    expect(brotherCommand('MEM')).toContain('MEM     ');
  });

  it('should calculate consistent checksum', () => {
    expect(brotherCommand('PANEL')).toBe(brotherCommand('PANEL'));
    expect(brotherCommand('ALARM')).toBe(brotherCommand('ALARM'));
  });
});

describe('parseResponse', () => {
  const connector = newConnector();

  it('should parse PANEL response correctly', () => {
    const response = connector.parseResponse(MOCK_RESPONSES['PANEL']);
    expect(response['K01']).toBeDefined();
    expect(response['K01'][0]).toBe('0');
  });

  it('should parse MEM response correctly', () => {
    const response = connector.parseResponse(MOCK_RESPONSES['MEM']);
    expect(response['A01']).toBeDefined();
    expect(response['A01'][1]).toBe('1001');
  });

  it('should parse WKCNTR response correctly', () => {
    const response = connector.parseResponse(MOCK_RESPONSES['WKCNTR']);
    expect(response['A01']).toBeDefined();
    expect(response['A01'][1]).toBe('78');
    expect(response['A01'][2]).toBe('200');
  });

  it('should parse ALARM response correctly', () => {
    const response = connector.parseResponse(MOCK_RESPONSES['ALARM']);
    expect(response['E01']).toBeDefined();
    expect(response['E01'][0]).toBe('0975320032');
  });

  it('should parse PDSP response correctly', () => {
    const response = connector.parseResponse(MOCK_RESPONSES['PDSP']);
    expect(response['X01']).toBeDefined();
    expect(response['X01'][3]).toBe('10');
  });

  it('should handle empty lines gracefully', () => {
    const response = connector.parseResponse('A01,1,2,3\r\n\r\nB01,4,5,6');
    expect(response['A01']).toEqual(['1', '2', '3']);
    expect(response['B01']).toEqual(['4', '5', '6']);
  });

  it('should parse comma-separated values', () => {
    const response = connector.parseResponse('A01,value1,value2,value3\r\n');
    expect(response['A01']).toEqual(['value1', 'value2', 'value3']);
  });

  it('should skip lines without comma', () => {
    const response = connector.parseResponse('HEADER\r\nA01,value\r\n');
    expect(response['HEADER']).toBeUndefined();
    expect(response['A01']).toEqual(['value']);
  });

  it('should trim whitespace from values', () => {
    const response = connector.parseResponse('A01,  spaced  , value \r\n');
    expect(response['A01']).toEqual(['spaced', 'value']);
  });
});

describe('parseValue', () => {
  it('should parse string values', () => {
    expect(parseValue('hello', 'string')).toBe('hello');
  });

  it('should parse int values', () => {
    expect(parseValue('42', 'int')).toBe(42);
    expect(parseValue('3.7', 'int')).toBe(3);
  });

  it('should parse float values', () => {
    expect(parseValue('3.14', 'float')).toBe(3.14);
  });

  it('should parse bool values', () => {
    expect(parseValue('true', 'bool', (v) => Boolean(v))).toBe(true);
  });

  it('should strip quotes from strings', () => {
    expect(parseValue("'quoted'", 'string')).toBe('quoted');
  });

  it('should handle empty values with defaults', () => {
    expect(parseValue('', 'int')).toBe(0);
    expect(parseValue('', 'float')).toBe(0);
    expect(parseValue('', 'bool')).toBe(false);
    expect(parseValue('', 'string')).toBe('');
  });

  it('should apply transform function', () => {
    const double: DataItemTransform = (v) => parseInt(String(v)) * 2;
    expect(parseValue('5', 'int', double)).toBe(10);
  });
});

describe('TRANSFORMS.mode', () => {
  it.each([
    ['0', 'MANUAL'],
    ['1', 'MDI'],
    ['2', 'MEMORY'],
    ['3', 'EDIT'],
  ])('should transform %s to %s', (panelValue, mode) => {
    expect(TRANSFORMS.mode(panelValue)).toBe(mode);
  });

  it('should return raw int for unknown values', () => {
    expect(TRANSFORMS.mode('4')).toBe(4);
    expect(TRANSFORMS.mode('99')).toBe(99);
  });
});

describe('TRANSFORMS.alarm', () => {
  it('should return false for CM (Communication) alarm - ignored', () => {
    expect(TRANSFORMS.alarm('0975320032')).toBe(false);
  });

  it('should return false for OM (No alarm) - ignored', () => {
    expect(TRANSFORMS.alarm('90')).toBe(false);
    expect(TRANSFORMS.alarm('90000000')).toBe(false);
  });

  it('should return true for real alarms', () => {
    expect(TRANSFORMS.alarm('01123456')).toBe(true);  // EX
    expect(TRANSFORMS.alarm('02123456')).toBe(true);  // EC
    expect(TRANSFORMS.alarm('03123456')).toBe(true);  // SV
    expect(TRANSFORMS.alarm('04123456')).toBe(true);  // NC
    expect(TRANSFORMS.alarm('05123456')).toBe(true);  // IO
    expect(TRANSFORMS.alarm('06123456')).toBe(true);  // SP
    expect(TRANSFORMS.alarm('10123456')).toBe(true);  // ES
  });
});

describe('TRANSFORMS.alarmCode', () => {
  it.each([
    ['01', 'EX'], ['02', 'EC'], ['03', 'SV'], ['04', 'NC'], ['05', 'IO'], ['06', 'SP'],
    ['07', 'SM'], ['08', 'SL'], ['09', 'CM'], ['10', 'ES'], ['11', 'FC'],
  ])('maps prefix %s to %s', (prefix, letters) => {
    expect(TRANSFORMS.alarmCode(`${prefix}123456`)).toBe(`${letters}123456`);
  });

  it('should transform CM alarm code correctly', () => {
    expect(TRANSFORMS.alarmCode('0975320032')).toBe('CM75320032');
  });

  it('should return empty string for OM (No alarm)', () => {
    expect(TRANSFORMS.alarmCode('90')).toBe('');
    expect(TRANSFORMS.alarmCode('90000000')).toBe('');
  });

  it('should return raw value for unknown codes', () => {
    expect(TRANSFORMS.alarmCode('99unknown')).toBe('99unknown');
  });
});

describe('TRANSFORMS.execution, from the MEM operation status', () => {
  it('gives the MTConnect execution word for each status', () => {
    expect(TRANSFORMS.execution('0')).toBe('READY');
    expect(TRANSFORMS.execution('1')).toBe('ACTIVE');
    expect(TRANSFORMS.execution('2')).toBe('FEED_HOLD');
    expect(TRANSFORMS.execution('3')).toBe('INTERRUPTED');
  });

  it('gives an empty value for a status that it does not know', () => {
    expect(TRANSFORMS.execution('7')).toBe('');
  });
});

describe('Brother control type detection (C00 vs D00)', () => {
  it('should start with null controlType before detection', () => {
    const status = newConnector().getStatus();

    expect(status.data).toHaveProperty('controlType');
    expect(status.data.controlType).toBeNull();
  });

  it('is a C00 control when ATCTL gives ATC pots', async () => {
    const status = await connectorWithReplies(MOCK_RESPONSES).poll();

    expect(status.data.controlType).toBe('C00');
  });

  it('is a D00 control when ATCTL fails and ATCTLD gives ATC pots', async () => {
    const { ATCTL, ...replies } = MOCK_RESPONSES;
    const connector = connectorWithReplies({ ...replies, ATCTLD: ATCTL.replace('ATCTL ', 'ATCTLD') });

    const status = await connector.poll();

    expect(status.data.controlType).toBe('D00');
  });

  it('has no control type when neither command gives ATC pots', async () => {
    const connector = connectorWithReplies({ ...MOCK_RESPONSES, ATCTL: 'RLOD    ATCTL   00\r\nOTHER,data\r\n\r\n00%' });

    const status = await connector.poll();

    expect(status.data.controlType).toBeNull();
    expect(status.data.hasPocketInfo).toBe(false);
  });
});

describe('Brother tool table from a poll', () => {
  it('puts the tool of each ATC pot in the table, with the offsets and name from the tool data', async () => {
    const status = await connectorWithReplies(MOCK_RESPONSES).poll();

    expect(status.data.hasPocketInfo).toBe(true);
    expect(status.data.toolTable).toEqual({
      1: { toolNum: 1, length: 1.5, lengthWear: 0, diameter: 0.25, diameterWear: 0, name: 'ENDMILL' },
      2: { toolNum: 2 },
    });
  });

  it('reads tool data with 3-digit keys', async () => {
    const connector = connectorWithReplies({
      ...MOCK_RESPONSES,
      TOLNI1: "RLOD    TOLNI1  00\r\nT001, 1.5000, 0.0001, 0.2500, 0.0000, 0, 0, 0, 0, 'ENDMILL '\r\n\r\n00%",
    });

    const status = await connector.poll();

    expect(status.data.toolTable?.[1]).toMatchObject({ length: 1.5, lengthWear: 0.0001, name: 'ENDMILL' });
  });

  it('asks for metric tool data when the unit is mm', async () => {
    const connector = connectorWithReplies({ ...MOCK_RESPONSES, TOLNM1: MOCK_RESPONSES.TOLNI1 }, { defaultUnit: 'mm' });

    await connector.poll();

    expect(connector.sendCommand).toHaveBeenCalledWith('TOLNM1');
    expect(connector.sendCommand).not.toHaveBeenCalledWith('TOLNI1');
  });
});

describe('Brother Data Snapshot', () => {
  let connector: BrotherConnector;

  beforeEach(() => {
    connector = newConnector({ name: 'SnapshotTest', macros: [{ location: 100, name: 'TestMacro' }] });
  });

  afterEach(() => {
    connector.disconnect();
  });

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
  function connectorWithMem(memReply: string): BrotherConnector {
    return connectorWithReplies({ ...MOCK_RESPONSES, MEM: memReply });
  }

  it('reads index 2 of the MEM A01 line, the operation status, so the history can record the running time', async () => {
    const connector = connectorWithMem("RLOD    MEM     00\r\nA01,'/       ',1001,1,0,0,0,0\r\n\r\n00%");

    const status = await connector.poll();

    expect(status.data.execution).toBe('ACTIVE');
    expect(connector.getDataSnapshot().execution).toBe('ACTIVE');
  });

  it('gives no run state when the control sends no operation status', async () => {
    const connector = connectorWithMem("RLOD    MEM     00\r\nA01,'/       ',1001\r\n\r\n00%");

    await connector.poll();

    expect(connector.getDataSnapshot().execution).toBeUndefined();
  });
});
