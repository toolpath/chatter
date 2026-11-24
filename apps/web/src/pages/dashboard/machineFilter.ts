import { machineStateOf, type MachineState } from '../../machines/machineStatus';
import type { Machine } from '../../types';

/** "all", or one machine state. A machine that is connecting shows with the offline machines. */
export type StateFilter = Exclude<MachineState, 'connecting'> | 'all';

export const STATE_FILTERS: StateFilter[] = ['all', 'running', 'idle', 'alarm', 'offline'];

/** The filter that shows the machine. Chatter cannot reach a machine that is connecting yet, so it shows as offline. */
function filterOf(machine: Machine): StateFilter {
  const state = machineStateOf(machine);
  return state === 'connecting' ? 'offline' : state;
}

/**
 * CNC program names often start with the letter O, such as O5001. In most fonts O looks like the number 0,
 * so the program search treats O and 0 as the same, anywhere in the name.
 */
function sameOAndZero(text: string): string {
  return text.replaceAll('o', '0');
}

/** True when the name, program or IP address of the machine has the search text, ignoring case */
function matchesSearch(machine: Machine, search: string): boolean {
  const text = search.trim().toLowerCase();
  if (!text) return true;
  const program = (machine.data.program ?? '').toLowerCase();
  return [machine.name, machine.host].some(value => value.toLowerCase().includes(text))
    || sameOAndZero(program).includes(sameOAndZero(text));
}

function matchesState(machine: Machine, state: StateFilter): boolean {
  return state === 'all' || filterOf(machine) === state;
}

/** The machines that have the search text and are in the chosen state */
export function filterMachines(machines: Machine[], search: string, state: StateFilter): Machine[] {
  return machines.filter(machine => matchesSearch(machine, search) && matchesState(machine, state));
}

/** How many machines are in each state, and in all */
export function countByState(machines: Machine[]): Record<StateFilter, number> {
  const counts = { all: machines.length, running: 0, idle: 0, alarm: 0, offline: 0 };
  for (const machine of machines) counts[filterOf(machine)] += 1;
  return counts;
}

const URGENCY_ORDER: Record<MachineState, number> = { alarm: 0, offline: 1, connecting: 2, idle: 3, running: 4 };

/** Machines that need help come first: alarm, then offline, then connecting, then idle, then running. Then by name. */
export function byUrgency(a: Machine, b: Machine): number {
  return URGENCY_ORDER[machineStateOf(a)] - URGENCY_ORDER[machineStateOf(b)] || a.name.localeCompare(b.name);
}
