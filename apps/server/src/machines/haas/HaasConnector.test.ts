import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'net';
import { HaasConnector, buildCommandString, haasAlarmText, parseQueryResponse, parseRunStatus } from './HaasConnector.js';
import type { HaasMachineConfig } from '../../types/index.js';

/** Port 1 has no server, so a connection to it fails at once */
const CLOSED_PORT = 1;

describe('HaasConnector', () => {
  let connector: HaasConnector;

  beforeEach(() => {
    connector = new HaasConnector({
      id: 'test_haas',
      name: 'FakeHaas',
      host: '127.0.0.1',
      dataPort: 9998,
      queryPort: 5051,
      timeout: 5000
    });
  });

  afterEach(() => {
    connector.disconnect();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided values', () => {
      expect(connector.id).toBe('test_haas');
      expect(connector.name).toBe('FakeHaas');
      expect(connector.host).toBe('127.0.0.1');
      expect(connector.dataPort).toBe(9998);
      expect(connector.queryPort).toBe(5051);
      expect(connector.connected).toBe(false);
      expect(connector.type).toBe('haas');
    });

    it('should use default ports when not provided', () => {
      const defaultConnector = new HaasConnector({ name: 'DefaultHaas', host: '192.168.1.100' });

      expect(defaultConnector.dataPort).toBe(9998);
      expect(defaultConnector.queryPort).toBe(5051);
    });

    it('should generate id from timestamp if not provided', () => {
      const autoIdConnector = new HaasConnector({ name: 'AutoIdHaas', host: '192.168.1.100' });

      expect(autoIdConnector.id).toMatch(/^haas_\d+$/);
    });
  });

  describe('disconnect', () => {
    it('should set connected to false', () => {
      connector.connected = true;
      connector.disconnect();

      expect(connector.connected).toBe(false);
    });

    it('should be safe to call multiple times', () => {
      connector.disconnect();
      connector.disconnect();
      expect(connector.connected).toBe(false);
    });
  });

  describe('checkConnection', () => {
    it('should return false when not connected', () => {
      expect(connector.checkConnection()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return current status object', () => {
      const status = connector.getStatus();

      expect(status.id).toBe('test_haas');
      expect(status.name).toBe('FakeHaas');
      expect(status.host).toBe('127.0.0.1');
      expect(status.dataPort).toBe(9998);
      expect(status.queryPort).toBe(5051);
      expect(status.type).toBe('haas');
      expect(status.connected).toBe(false);
      expect(status.errors).toEqual([]);
      expect(status.data).toBeDefined();
    });

    it('should have no lastPollTime before the first poll', () => {
      expect(connector.getStatus().lastPollTime).toBeNull();
    });
  });

  describe('updateConfig', () => {
    it('should update host', () => {
      connector.updateConfig({ host: '10.0.0.1' });
      expect(connector.host).toBe('10.0.0.1');
    });

    it('should update dataPort', () => {
      connector.updateConfig({ dataPort: 8888 });
      expect(connector.dataPort).toBe(8888);
    });

    it('should update queryPort', () => {
      connector.updateConfig({ queryPort: 6666 });
      expect(connector.queryPort).toBe(6666);
    });

    it('should disconnect when settings change', () => {
      connector.connected = true;
      connector.updateConfig({ host: '10.0.0.1' });
      expect(connector.connected).toBe(false);
    });
  });
});

describe('Haas query commands', () => {
  it('asks for a macro with its location', () => {
    expect(buildCommandString({ queryStart: 'Q600', macroLocation: 100, label: 'macro_100' })).toBe('?Q600 100\n');
  });

  it('asks for the mode with only the Q code', () => {
    expect(buildCommandString({ queryStart: 'Q104', label: 'mode' })).toBe('?Q104\n');
  });
});

describe('Haas query response parsing', () => {
  it('reads the value after the first comma', () => {
    expect(parseQueryResponse('>M30 #1, 380\r\n', false)).toBe('380');
    expect(parseQueryResponse('>MODE, MEM\r\n', false)).toBe('MEM');
  });

  it('reads a macro value only from a MACRO reply', () => {
    expect(parseQueryResponse('>MACRO, 12.500000\r\n', true)).toBe('12.500000');
    expect(parseQueryResponse('>MODE, MEM\r\n', true)).toBeNull();
  });

  it('ignores the reply to an unknown command', () => {
    expect(parseQueryResponse('>?, ?Q105\r\n', false)).toBeNull();
  });
});

describe('Q500 run status, in MTConnect execution words', () => {
  it('gives ACTIVE while a program runs, when the control answers only "STATUS, BUSY"', () => {
    expect(parseRunStatus('>STATUS, BUSY\r\n')).toBe('ACTIVE');
  });

  it('reads the status after the program name when no program runs', () => {
    expect(parseRunStatus('>PROGRAM, O01234, IDLE, PARTS, 380\r\n')).toBe('READY');
    expect(parseRunStatus('>PROGRAM, O01234, FEED HOLD, PARTS, 380\r\n')).toBe('FEED_HOLD');
    expect(parseRunStatus('>PROGRAM, O01234, ALARM ON, PARTS, 380\r\n')).toBe('STOPPED');
  });

  it('reads the reply of an older control, which has STX and ETB bytes around it', () => {
    expect(parseRunStatus('\x02STATUS, BUSY\x17\r\n')).toBe('ACTIVE');
  });

  it('gives null for a status or a reply that it does not know', () => {
    expect(parseRunStatus('>PROGRAM, O01234, SOMETHING, PARTS, 3\r\n')).toBeNull();
    expect(parseRunStatus('>?, ?Q500\r\n')).toBeNull();
  });
});

describe('Haas alarm codes', () => {
  it.each([
    ['107', 'EMERGENCY STOP'],
    ['108', 'X SERVO OVERLOAD'],
    ['109', 'Y SERVO OVERLOAD'],
    ['110', 'Z SERVO OVERLOAD'],
    ['111', 'A SERVO OVERLOAD'],
    ['188', 'B SERVO OVERLOAD'],
    ['271', 'C SERVO OVERLOAD'],
    ['674', 'TT SERVO OVERLOAD'],
    ['1.108', 'X AXIS SERVO OVERLOAD'],
    ['2.108', 'Y AXIS SERVO OVERLOAD'],
    ['3.108', 'Z AXIS SERVO OVERLOAD'],
    ['5.108', 'A AXIS SERVO OVERLOAD'],
    ['6.108', 'B AXIS SERVO OVERLOAD'],
    ['7.108', 'C AXIS SERVO OVERLOAD'],
    ['11.108', 'TA AXIS SERVO OVERLOAD'],
  ])('maps alarm code %s to "%s"', (code, text) => {
    expect(haasAlarmText(code)).toBe(text);
  });

  it('gives no text for an unknown code', () => {
    expect(haasAlarmText('999')).toBeUndefined();
    expect(haasAlarmText('0')).toBeUndefined();
  });
});

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as net.AddressInfo).port;
}

function close(server: net.Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

/**
 * A small TCP server that answers Q commands the way the Haas NGC manual shows
 * ("27 - NGC - Machine Data Collection").
 */
function startFakeQueryPort(replies: Record<string, string>): Promise<net.Server> {
  const server = net.createServer(socket => {
    socket.on('data', chunk => {
      for (const query of chunk.toString('ascii').split('\n').filter(Boolean)) {
        const reply = replies[query.trim()] ?? `?, ${query.trim()}`;
        socket.write(`>${reply}\r\n`);
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** A connector that reads only the query port of this fake server */
function queryPortConnector(server: net.Server, config: Partial<HaasMachineConfig> = {}): HaasConnector {
  const queryPort = (server.address() as net.AddressInfo).port;
  return new HaasConnector({ name: 'NGC', host: '127.0.0.1', dataPort: CLOSED_PORT, queryPort, ...config });
}

describe('Haas part count from a real-shaped query port', () => {
  let server: net.Server;
  let connector: HaasConnector;

  beforeEach(async () => {
    server = await startFakeQueryPort({
      '?Q104': 'MODE, MEM',
      '?Q402': 'M30 #1, 380',
      '?Q500': 'PROGRAM, O01234, IDLE, PARTS, 380',
      '?Q600 1098': 'MACRO, 37.000000',
      '?Q600 100': 'MACRO, 12.500000',
      '?Q301': 'C.S. TIME, 00098:18:29',
    });
    connector = queryPortConnector(server);
  });

  afterEach(async () => {
    connector.disconnect();
    await close(server);
  });

  it('reads the part count from the M30 counter', async () => {
    const status = await connector.poll();

    expect(status.data.partCount).toBe(380);
    expect(status.data.mode).toBe('MEM');
  });

  it('does not take the motion time as the part goal', async () => {
    const status = await connector.poll();

    expect(status.data.partGoal).toBeUndefined();
  });

  it('tells if a program runs, from Q500, so the history can record the running time', async () => {
    const status = await connector.poll();

    expect(status.data.execution).toBe('READY');
    expect(connector.getDataSnapshot().execution).toBe('READY');
  });

  it('reads the spindle load in percent from macro #1098', async () => {
    const status = await connector.poll();

    expect(status.data.spindleLoad).toBe(37);
    expect(connector.getDataSnapshot().spindleLoad).toBe(37);
  });

  it('reads each configured macro under its name, and gives it in the snapshot', async () => {
    connector.updateMacros([{ location: 100, name: 'Cycle Time' }]);

    const status = await connector.poll();

    expect(status.data['Cycle Time']).toBe(12.5);
    expect(connector.getDataSnapshot().custom).toEqual({ 'Cycle Time': 12.5 });
  });
});

describe('Haas live values when the control stops giving them', () => {
  async function withConnector(replies: Record<string, string>, test: (connector: HaasConnector) => Promise<void>) {
    const server = await startFakeQueryPort(replies);
    const connector = queryPortConnector(server);
    try {
      await test(connector);
    } finally {
      connector.disconnect();
      await close(server);
    }
  }

  it('forgets the old run status, so a machine that ran does not show "running" for ever', async () => {
    const replies: Record<string, string> = { '?Q500': 'STATUS, BUSY' };
    await withConnector(replies, async connector => {
      expect((await connector.poll()).data.execution).toBe('ACTIVE');

      replies['?Q500'] = 'STATUS, SOMETHING NEW';
      expect((await connector.poll()).data.execution).toBeUndefined();
    });
  });

  it('forgets the old spindle load when the control gives no load', async () => {
    const replies: Record<string, string> = { '?Q600 1098': 'MACRO, 55.000000' };
    await withConnector(replies, async connector => {
      expect((await connector.poll()).data.spindleLoad).toBe(55);

      delete replies['?Q600 1098'];
      expect((await connector.poll()).data.spindleLoad).toBeUndefined();
    });
  });
});

describe('Haas data stream', () => {
  const DELIMITER = '\n\x03\x02';
  let server: net.Server;
  let connector: HaasConnector;

  /** A fake data stream port that sends these lines after the init string */
  async function startDataStream(lines: string[]): Promise<void> {
    server = net.createServer(socket => {
      socket.once('data', () => socket.write(lines.map(line => line + DELIMITER).join('')));
    });
    const dataPort = await listen(server);
    connector = new HaasConnector({ name: 'VF2', host: '127.0.0.1', dataPort, queryPort: CLOSED_PORT });
  }

  /** Poll until the data stream values have come */
  async function pollUntil(isReady: (data: Record<string, unknown>) => boolean) {
    return vi.waitFor(async () => {
      const status = await connector.poll();
      if (!isReady(status.data)) throw new Error('No data stream values yet');
      return status;
    });
  }

  beforeEach(() => {
  });

  afterEach(async () => {
    connector.disconnect();
    await close(server);
    vi.restoreAllMocks();
  });

  it('reads the tool, the program and the spindle speed, which Haas sends with 4 decimal places', async () => {
    await startDataStream(['ActiveTool|5|ProgramName|O1234|SpindleActualRPM|80000000']);

    const status = await pollUntil(data => data.toolNumber !== undefined);

    expect(status.data).toMatchObject({ toolNumber: 5, program: 'O1234', spindleSpeed: 8000 });
  });

  it('gives the alarm text of a known alarm code from the local table', async () => {
    await startDataStream(['alarm0|107']);

    const status = await pollUntil(data => data.alarm !== undefined);

    expect(status.data).toMatchObject({ alarm: true, alarmCode: '107', alarmText: 'EMERGENCY STOP' });
  });

  it('gives a plain alarm text for an unknown alarm code', async () => {
    await startDataStream(['alarm0|999']);

    const status = await pollUntil(data => data.alarm !== undefined);

    expect(status.data.alarmText).toBe('ALARM 999');
  });

  it('is not in alarm when the alarm code is 0', async () => {
    await startDataStream(['alarm0|0']);

    const status = await pollUntil(data => data.alarm !== undefined);

    expect(status.data).toMatchObject({ alarm: false, alarmText: undefined });
  });
});
