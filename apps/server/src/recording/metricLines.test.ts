import { describe, expect, it } from 'vitest';
import type { MachineDataSnapshot } from '../types/index.js';
import { HISTORY_VALUES } from '@local-chatter/shared';
import { historyMetricName, metricLines } from './metricLines.js';

const TIME = Date.UTC(2026, 10, 9, 9, 0);

function snapshot(values: Partial<MachineDataSnapshot> = {}): MachineDataSnapshot {
  return {
    timestamp: new Date(TIME).toISOString(),
    machineId: 'm1',
    machineType: 'brother',
    connected: true,
    ...values,
  };
}

describe('metricLines', () => {
  it('writes each number with the machine id, the machine type and the time in milliseconds', () => {
    const lines = metricLines(snapshot({ spindleSpeed: 1200, spindleLoad: 42, feedrate: 350.5, partCount: 7, partGoal: 50, toolNumber: 3 }), TIME);

    expect(lines).toEqual([
      `chatter_connected{machine="m1",type="brother"} 1 ${TIME}`,
      `chatter_spindle_speed{machine="m1",type="brother"} 1200 ${TIME}`,
      `chatter_spindle_load{machine="m1",type="brother"} 42 ${TIME}`,
      `chatter_feedrate{machine="m1",type="brother"} 350.5 ${TIME}`,
      `chatter_part_count{machine="m1",type="brother"} 7 ${TIME}`,
      `chatter_part_goal{machine="m1",type="brother"} 50 ${TIME}`,
      `chatter_tool_number{machine="m1",type="brother"} 3 ${TIME}`,
    ]);
  });

  it('writes the alarm and the emergency stop as 1 or 0', () => {
    const lines = metricLines(snapshot({ alarm: true, emergency: false }), TIME);

    expect(lines).toContain(`chatter_alarm{machine="m1",type="brother"} 1 ${TIME}`);
    expect(lines).toContain(`chatter_emergency{machine="m1",type="brother"} 0 ${TIME}`);
  });

  it.each([
    [{ runState: 'START' }, 1],
    [{ runState: 'MSTR' }, 1],
    [{ runState: 'STOP' }, 0],
    [{ runState: 'HOLD' }, 0],
    [{ runState: 'HOLD', spindleSpeed: 8000 }, 0],
    [{ execution: 'ACTIVE' }, 1],
    [{ execution: 'READY' }, 0],
    [{ execution: 'FEED_HOLD' }, 0],
  ])('writes running from the FANUC run state or the MTConnect execution: %o', (values, running) => {
    expect(metricLines(snapshot(values), TIME)).toContain(`chatter_running{machine="m1",type="brother"} ${running} ${TIME}`);
  });

  it('does not write running when the machine does not tell it', () => {
    const lines = metricLines(snapshot({ mode: 'MEM' }), TIME);

    expect(lines.some(line => line.startsWith('chatter_running'))).toBe(false);
  });

  it('leaves out the values that the machine did not send', () => {
    expect(metricLines(snapshot(), TIME)).toEqual([`chatter_connected{machine="m1",type="brother"} 1 ${TIME}`]);
  });

  it.each([NaN, Infinity, -Infinity])('leaves out a number that is not finite: %s', value => {
    const lines = metricLines(snapshot({ spindleSpeed: value }), TIME);

    expect(lines.some(line => line.startsWith('chatter_spindle_speed'))).toBe(false);
  });

  it('writes only "not connected" for a machine that does not answer, because its other values are old', () => {
    const lines = metricLines(snapshot({ connected: false, spindleSpeed: 1200, alarm: true }), TIME);

    expect(lines).toEqual([`chatter_connected{machine="m1",type="brother"} 0 ${TIME}`]);
  });

  it('escapes a backslash, a quote and a new line in a label value', () => {
    const [line] = metricLines(snapshot({ machineId: 'a\\b"c\nd' }), TIME);

    expect(line).toBe(`chatter_connected{machine="a\\\\b\\"c\\nd",type="brother"} 1 ${TIME}`);
  });

  it('writes a metric for each value that has a history', () => {
    const lines = metricLines(snapshot({
      spindleSpeed: 1, spindleLoad: 1, feedrate: 1, partCount: 1, partGoal: 1, toolNumber: 1, alarm: false, emergency: false, runState: 'START',
    }), TIME);

    for (const value of HISTORY_VALUES) {
      expect(lines.some(line => line.startsWith(`${historyMetricName(value)}{`))).toBe(true);
    }
  });

  it('uses the time it is given, not the time in the snapshot', () => {
    const later = TIME + 5000;

    expect(metricLines(snapshot(), later)).toEqual([`chatter_connected{machine="m1",type="brother"} 1 ${later}`]);
  });
});
