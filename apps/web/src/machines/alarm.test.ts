import { describe, expect, it } from 'vitest';
import { testMachine } from '../test/testMachine';
import { alarmLine, alarmOf, offlineReasonOf } from './alarm';

describe('alarmOf', () => {
  it('gives null when there is no alarm, or the machine is offline', () => {
    expect(alarmOf(testMachine())).toBeNull();
    expect(alarmOf(testMachine({ connected: false }, { alarm: true }))).toBeNull();
  });

  it('gives null while the machine is connecting, because its values are not real yet', () => {
    expect(alarmOf(testMachine({ connected: true, connecting: true }, { alarm: true }))).toBeNull();
  });

  it('uses the FANUC alarm message first', () => {
    const machine = testMachine({ type: 'fanuc' } as never, { alarm: true, alarmMessage: 'OVERTRAVEL', alarmText: 'other' });
    expect(alarmOf(machine)).toEqual({ code: undefined, title: 'OVERTRAVEL' });
  });

  it('names a Brother alarm from its code', () => {
    const machine = testMachine({}, { alarm: true, alarmCode: 'SV00000005' });
    expect(alarmOf(machine)).toEqual({ code: 'SV00000005', title: 'Servo Alarm' });
  });

  it('says "Alarm" when the machine sends no text', () => {
    expect(alarmOf(testMachine({ type: 'haas' } as never, { alarm: true }))?.title).toBe('Alarm');
  });
});

describe('alarmLine', () => {
  it('puts the code before the title when there is a code', () => {
    expect(alarmLine({ code: '107', title: 'Emergency stop' })).toBe('107 · Emergency stop');
    expect(alarmLine({ title: 'Alarm' })).toBe('Alarm');
  });
});

describe('offlineReasonOf', () => {
  it('gives the first error, or "No connection"', () => {
    expect(offlineReasonOf(testMachine({ errors: ['Timed out', 'Refused'] }))).toBe('Timed out');
    expect(offlineReasonOf(testMachine())).toBe('No connection');
  });
});
