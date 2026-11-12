import { describe, expect, it } from 'vitest';
import { testMachine } from '../../test/testMachine';
import { byUrgency, countByState, filterMachines } from './machineFilter';

const running = testMachine({ id: 'a', name: 'Lathe', host: '10.0.0.1' }, { spindleSpeed: 5000, program: 'O1234' });
const idle = testMachine({ id: 'b', name: 'Mill 2', host: '10.0.0.2' });
const alarm = testMachine({ id: 'c', name: 'Mill 1', host: '10.0.0.3' }, { alarm: true });
const offline = testMachine({ id: 'd', name: 'Drill', host: '10.0.0.4', connected: false });
const machines = [running, idle, alarm, offline];

describe('filterMachines', () => {
  it('finds the search text in the name, IP address or program, ignoring case', () => {
    expect(filterMachines(machines, ' mill ', 'all')).toEqual([idle, alarm]);
    expect(filterMachines(machines, '10.0.0.4', 'all')).toEqual([offline]);
    expect(filterMachines(machines, 'o1234', 'all')).toEqual([running]);
  });

  it('finds a program when the user types the number 0 in place of the letter O, which look alike', () => {
    expect(filterMachines(machines, '01234', 'all')).toEqual([running]);
  });

  it('does not treat O and 0 as the same in names and IP addresses', () => {
    const okuma = testMachine({ id: 'e', name: 'Okuma', host: '10.0.0.5' });
    expect(filterMachines([okuma], '0kuma', 'all')).toEqual([]);
    expect(filterMachines([okuma], '1o.o.o.5', 'all')).toEqual([]);
  });

  it('keeps only the machines in the chosen state', () => {
    expect(filterMachines(machines, '', 'alarm')).toEqual([alarm]);
    expect(filterMachines(machines, 'mill', 'running')).toEqual([]);
  });
});

describe('countByState', () => {
  it('counts each state and all machines', () => {
    expect(countByState(machines)).toEqual({ all: 4, running: 1, idle: 1, alarm: 1, offline: 1 });
  });
});

describe('a machine that is connecting', () => {
  const connecting = testMachine({ id: 'f', name: 'Bore', host: '10.0.0.6', connected: false, connecting: true });

  it('shows with the offline machines, because Chatter cannot reach it yet', () => {
    expect(filterMachines([...machines, connecting], '', 'offline')).toEqual([offline, connecting]);
    expect(countByState([...machines, connecting]).offline).toBe(2);
  });

  it('comes after the offline machines and before the idle machines', () => {
    expect([...machines, connecting].sort(byUrgency)).toEqual([alarm, offline, connecting, idle, running]);
  });
});

describe('byUrgency', () => {
  it('puts alarm, then offline, then idle, then running, then sorts by name', () => {
    const idleA = testMachine({ id: 'e', name: 'Mill 1' });
    expect([...machines, idleA].sort(byUrgency)).toEqual([alarm, offline, idleA, idle, running]);
  });
});
