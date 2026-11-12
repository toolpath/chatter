import type { MachineDataSnapshot } from '../types/index.js';

/**
 * The time to save a poll at. The snapshot of a machine that does not answer keeps the time
 * of its last good poll, so "not connected" is saved at the time of this poll instead.
 */
export function pollTimeOf(snapshot: MachineDataSnapshot, now: () => number): number {
  const time = snapshot.connected ? Date.parse(snapshot.timestamp) : now();
  if (Number.isNaN(time)) throw new Error(`The poll of machine ${snapshot.machineId} has no valid time: ${snapshot.timestamp}`);
  return time;
}
