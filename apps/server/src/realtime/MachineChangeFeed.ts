import type { BaseMachineStatus } from '../types/index.js';

/** What changed since the last machine list */
export interface MachineChanges {
  changed: BaseMachineStatus[];
  removedIds: string[];
}

type ChangeListener = (changes: MachineChanges) => void;

function isEmpty(changes: MachineChanges): boolean {
  return changes.changed.length === 0 && changes.removedIds.length === 0;
}

/** The poller, as the feed sees it */
export interface MachineStatusSource {
  getStatus(): BaseMachineStatus[];
  on(event: 'update', listener: (machines: BaseMachineStatus[]) => void): unknown;
}

/**
 * Tells listeners which machines changed after each poll.
 *
 * It keeps the last machine list. A new listener starts from that list,
 * so the list plus the changes always equals the newest list.
 */
export class MachineChangeFeed {
  private machines: BaseMachineStatus[] = [];
  /** The JSON text of each machine in `machines`, to find the changes */
  private jsonById = new Map<string, string>();
  private readonly listeners = new Set<ChangeListener>();

  constructor(source: MachineStatusSource) {
    this.remember(source.getStatus());
    source.on('update', machines => this.publish(machines));
  }

  /** The machine list that the next changes start from */
  currentMachines(): BaseMachineStatus[] {
    return this.machines;
  }

  /** Returns the function that stops the listener */
  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(machines: BaseMachineStatus[]): void {
    const changes = this.changesTo(machines);
    this.remember(machines);
    if (isEmpty(changes)) return;
    for (const listener of this.listeners) listener(changes);
  }

  private changesTo(machines: BaseMachineStatus[]): MachineChanges {
    const newIds = new Set(machines.map(machine => machine.id));
    return {
      changed: machines.filter(machine => this.jsonById.get(machine.id) !== JSON.stringify(machine)),
      removedIds: [...this.jsonById.keys()].filter(id => !newIds.has(id)),
    };
  }

  private remember(machines: BaseMachineStatus[]): void {
    this.machines = machines;
    this.jsonById = new Map(machines.map(machine => [machine.id, JSON.stringify(machine)]));
  }
}
