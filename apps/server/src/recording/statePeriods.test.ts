import { describe, expect, it } from 'vitest';
import type { MachineDataSnapshot } from '../types/index.js';
import { changedKinds, stateValuesOf } from './statePeriods.js';

function snapshot(values: Partial<MachineDataSnapshot> = {}): MachineDataSnapshot {
  return { timestamp: '2026-11-09T09:00:00.000Z', machineId: 'm1', machineType: 'fanuc', connected: true, ...values };
}

describe('stateValuesOf', () => {
  it('reads the program, mode, run state and tool as text', () => {
    expect(stateValuesOf(snapshot({ program: 'O1234', mode: 'MEM', runState: 'START', toolNumber: 5 }))).toEqual({
      program: 'O1234', mode: 'MEM', 'run-state': 'START', tool: '5',
    });
  });

  it('uses the MTConnect execution as the run state', () => {
    expect(stateValuesOf(snapshot({ execution: 'ACTIVE' }))['run-state']).toBe('ACTIVE');
  });

  it('gives the alarm code and text only while the alarm is on', () => {
    expect(stateValuesOf(snapshot({ alarm: true, alarmCode: 'SV0401', alarmMessage: 'Servo V-ready off' })).alarm).toBe('SV0401 Servo V-ready off');
    expect(stateValuesOf(snapshot({ alarm: false, alarmCode: 'SV0401' })).alarm).toBeUndefined();
  });

  it('names an alarm that has no code and no text "alarm"', () => {
    expect(stateValuesOf(snapshot({ alarm: true })).alarm).toBe('alarm');
  });

  it('leaves out the values that the machine did not send, an empty text, and a tool that is not a number', () => {
    expect(stateValuesOf(snapshot({ program: '', toolNumber: NaN }))).toEqual({});
  });

  it('gives no values for a machine that does not answer, because its values are old', () => {
    expect(stateValuesOf(snapshot({ connected: false, program: 'O1234' }))).toEqual({});
  });
});

describe('changedKinds', () => {
  it('gives each kind whose value is new, changed or gone', () => {
    const before = { program: 'O1', mode: 'MEM', tool: '3' };
    const after = { program: 'O2', mode: 'MEM', alarm: 'SV0401' };

    expect(changedKinds(before, after).sort()).toEqual(['alarm', 'program', 'tool']);
  });

  it('gives nothing when no value changed', () => {
    expect(changedKinds({ program: 'O1' }, { program: 'O1' })).toEqual([]);
  });
});
