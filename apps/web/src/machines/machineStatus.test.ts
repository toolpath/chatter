import { describe, expect, it } from 'vitest';
import { testMachine } from '../test/testMachine';
import { machineAddress, machineStateOf, machineTypeLabel, makerOf, partCountOf, spindleLoadOf, spindleSpeedText, toolText } from './machineStatus';

describe('machineStateOf', () => {
  it('says offline when the machine is not connected, even with an alarm', () => {
    expect(machineStateOf(testMachine({ connected: false }, { alarm: true }))).toBe('offline');
  });

  it('says connecting while Chatter tries to reach a machine for the first time', () => {
    expect(machineStateOf(testMachine({ connected: false, connecting: true }))).toBe('connecting');
  });

  it('says connecting until the first good poll, also when the network connection is already open', () => {
    expect(machineStateOf(testMachine({ connected: true, connecting: true }, { spindleSpeed: 8000 }))).toBe('connecting');
  });

  it('says offline when the connecting time ended with no connection', () => {
    expect(machineStateOf(testMachine({ connected: false, connecting: false }))).toBe('offline');
  });

  it('says alarm before running', () => {
    expect(machineStateOf(testMachine({}, { alarm: true, spindleSpeed: 8000 }))).toBe('alarm');
  });

  it('says running when a program runs', () => {
    expect(machineStateOf(testMachine({}, { execution: 'ACTIVE' }))).toBe('running');
    expect(machineStateOf(testMachine({}, { runState: 'START' }))).toBe('running');
    expect(machineStateOf(testMachine({}, { runState: 'MSTR' }))).toBe('running');
  });

  it('says idle when the program stops or is held, also while the spindle turns', () => {
    expect(machineStateOf(testMachine({}, { runState: 'STOP' }))).toBe('idle');
    expect(machineStateOf(testMachine({}, { runState: 'HOLD', spindleSpeed: 8000 }))).toBe('idle');
    expect(machineStateOf(testMachine({}, { execution: 'FEED_HOLD', spindleSpeed: 8000 }))).toBe('idle');
    expect(machineStateOf(testMachine({}, { execution: 'READY', spindleSpeed: 1 }))).toBe('idle');
  });

  it('says idle when nothing runs', () => {
    expect(machineStateOf(testMachine({}, { spindleSpeed: 0 }))).toBe('idle');
    expect(machineStateOf(testMachine({}, { spindleSpeed: 1 }))).toBe('idle');
  });
});

describe('makerOf', () => {
  it('names the maker of the MTConnect agent', () => {
    expect(makerOf(testMachine({ type: 'mtconnect', agentType: 'okuma' } as never))).toBe('Okuma');
    expect(makerOf(testMachine({ type: 'mtconnect' } as never))).toBe('MTConnect');
    expect(makerOf(testMachine({ type: 'mtconnect', agentType: 'generic' } as never))).toBe('MTConnect');
    expect(makerOf(testMachine({ type: 'fanuc' } as never))).toBe('FANUC');
  });
});

describe('machineAddress', () => {
  it('adds the data port of each machine type', () => {
    expect(machineAddress(testMachine())).toBe('192.168.1.50:10000');
    expect(machineAddress(testMachine({ type: 'fanuc', focasPort: 8193 } as never))).toBe('192.168.1.50:8193');
  });

  it('shows only the host when there is no port', () => {
    expect(machineAddress(testMachine({ dataPort: undefined }))).toBe('192.168.1.50');
  });
});

describe('partCountOf', () => {
  it('gives the count and the fraction of the goal, at most 1', () => {
    expect(partCountOf({ partCount: 17, partGoal: 50 })).toEqual({ text: '17 / 50', fraction: 0.34 });
    expect(partCountOf({ partCount: 60, partGoal: 50 })?.fraction).toBe(1);
  });

  it('gives no fraction without a goal, and null without a count', () => {
    expect(partCountOf({ partCount: 17, partGoal: 0 })).toEqual({ text: '17', fraction: null });
    expect(partCountOf({})).toBeNull();
  });
});

describe('spindleSpeedText', () => {
  it('formats the speed, or gives null when the machine sends none', () => {
    expect(spindleSpeedText({ spindleSpeed: 7999.6 })).toBe('8,000 rpm');
    expect(spindleSpeedText({})).toBeNull();
  });
});

describe('spindleLoadOf', () => {
  it('gives the load as a percent and a fraction from 0 to 1', () => {
    expect(spindleLoadOf({ spindleLoad: 36.6 })).toEqual({ text: '37%', fraction: 0.366 });
    expect(spindleLoadOf({ spindleLoad: 140 })?.fraction).toBe(1);
    expect(spindleLoadOf({ spindleLoad: -5 })?.fraction).toBe(0);
  });

  it('gives null when the machine sends no load', () => {
    expect(spindleLoadOf({})).toBeNull();
  });
});

describe('toolText', () => {
  it('formats the tool number, or gives null when the machine sends none', () => {
    expect(toolText({ toolNumber: 12 })).toBe('T12');
    expect(toolText({})).toBeNull();
  });
});

describe('a Siemens machine', () => {
  const siemens = testMachine({ type: 'siemens', opcuaPort: 4840 } as never);

  it('has the Siemens names and its OPC UA port in its address', () => {
    expect(machineTypeLabel('siemens')).toBe('Siemens SINUMERIK');
    expect(makerOf(siemens)).toBe('Siemens');
    expect(machineAddress(siemens)).toBe('192.168.1.50:4840');
  });

  it('runs while the channel is active', () => {
    expect(machineStateOf(testMachine({ type: 'siemens' } as never, { execution: 'ACTIVE' }))).toBe('running');
    expect(machineStateOf(testMachine({ type: 'siemens' } as never, { execution: 'INTERRUPTED' }))).toBe('idle');
  });
});
