import type { Machine, MachineData } from '../types';

/** A connected, idle Brother machine for tests. Pass only the values a test needs. */
export function testMachine(overrides: Partial<Machine> = {}, dataOverrides: Partial<MachineData> = {}): Machine {
  return {
    id: 'm1',
    name: 'Mill 1',
    host: '192.168.1.50',
    type: 'brother',
    connected: true,
    lastPollTime: '2026-11-06T10:00:00.000Z',
    errors: [],
    dataPort: 10000,
    ftpPort: 21,
    ...overrides,
    data: { ...dataOverrides, ...overrides.data },
  } as Machine;
}
