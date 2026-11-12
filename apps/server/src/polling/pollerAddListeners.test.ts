import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applySchema } from '../storage/schema.js';
import { HardwarePoller } from './poller.js';

describe('HardwarePoller add listeners', () => {
  it('tells the listeners about a machine that a user adds, but not about machines that load at start', async () => {
    const db = new Database(':memory:');
    applySchema(db);
    const added: string[] = [];
    const first = new HardwarePoller(db);
    first.addAddListener({ machineAdded: id => added.push(id) });

    const machine = await first.addMachine({ type: 'brother', name: 'First machine', host: '127.0.0.1' });
    expect(added).toEqual([machine.id]);

    const second = new HardwarePoller(db);
    second.addAddListener({ machineAdded: id => added.push(id) });
    await second.loadFromDatabase();
    expect(second.getMachine(machine.id)).not.toBeNull();
    expect(added).toEqual([machine.id]);
  });
});
