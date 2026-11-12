import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach } from 'vitest';
import { MachineChangeFeed, type MachineChanges } from './MachineChangeFeed.js';
import type { BaseMachineStatus } from '../types/index.js';

function machineStatus(id: string, connected = true): BaseMachineStatus {
  return { id, connected } as BaseMachineStatus;
}

/** A poller with a fixed machine list, that emits 'update' when the test says so */
class FakePoller extends EventEmitter {
  constructor(private machines: BaseMachineStatus[]) {
    super();
  }

  getStatus(): BaseMachineStatus[] {
    return this.machines;
  }

  poll(machines: BaseMachineStatus[]): void {
    this.machines = machines;
    this.emit('update', machines);
  }
}

describe('MachineChangeFeed', () => {
  let poller: FakePoller;
  let feed: MachineChangeFeed;
  let received: MachineChanges[];

  beforeEach(() => {
    poller = new FakePoller([machineStatus('a'), machineStatus('b')]);
    feed = new MachineChangeFeed(poller);
    received = [];
    feed.subscribe(changes => received.push(changes));
  });

  it('starts from the machine list of the poller', () => {
    expect(feed.currentMachines()).toEqual([machineStatus('a'), machineStatus('b')]);
  });

  it('sends only the machines that changed', () => {
    poller.poll([machineStatus('a', false), machineStatus('b')]);

    expect(received).toEqual([{ changed: [machineStatus('a', false)], removedIds: [] }]);
  });

  it('sends a new machine as a change', () => {
    poller.poll([machineStatus('a'), machineStatus('b'), machineStatus('c')]);

    expect(received).toEqual([{ changed: [machineStatus('c')], removedIds: [] }]);
  });

  it('sends the id of a removed machine', () => {
    poller.poll([machineStatus('a')]);

    expect(received).toEqual([{ changed: [], removedIds: ['b'] }]);
  });

  it('sends nothing when no machine changed', () => {
    poller.poll([machineStatus('a'), machineStatus('b')]);

    expect(received).toEqual([]);
  });

  it('compares with the last list, not the first one', () => {
    poller.poll([machineStatus('a', false), machineStatus('b')]);
    poller.poll([machineStatus('a'), machineStatus('b')]);

    expect(received[1]).toEqual({ changed: [machineStatus('a')], removedIds: [] });
    expect(feed.currentMachines()).toEqual([machineStatus('a'), machineStatus('b')]);
  });

  it('stops sending after unsubscribe', () => {
    const late: MachineChanges[] = [];
    const unsubscribe = feed.subscribe(changes => late.push(changes));
    unsubscribe();

    poller.poll([machineStatus('a', false)]);

    expect(late).toEqual([]);
  });
});
