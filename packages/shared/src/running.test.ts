import { describe, expect, it } from 'vitest';
import { isMachineRunning, type RunningValues } from './running.js';

describe('isMachineRunning', () => {
  it.each([
    ['START', true],
    ['MSTR', true],
    ['STOP', false],
    ['HOLD', false],
    ['RESET', false],
  ])('counts the FANUC run state %s as running: %s', (runState, running) => {
    expect(isMachineRunning({ runState })).toBe(running);
  });

  it.each([
    ['ACTIVE', true],
    ['READY', false],
    ['FEED_HOLD', false],
    ['INTERRUPTED', false],
    ['STOPPED', false],
  ])('counts the execution %s as running: %s', (execution, running) => {
    expect(isMachineRunning({ execution })).toBe(running);
  });

  it('does not count a turning spindle while the program is held', () => {
    const heldFanuc = { runState: 'HOLD', spindleSpeed: 8000 };
    const heldMTConnect = { execution: 'FEED_HOLD', spindleSpeed: 8000 };
    expect(isMachineRunning(heldFanuc)).toBe(false);
    expect(isMachineRunning(heldMTConnect)).toBe(false);
  });

  it('does not know when the machine tells neither a run state nor an execution', () => {
    const spindleOnly: RunningValues & { spindleSpeed: number } = { spindleSpeed: 8000 };
    expect(isMachineRunning({})).toBeUndefined();
    expect(isMachineRunning(spindleOnly)).toBeUndefined();
  });
});
