import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';

export type ConnectorClass<T extends BaseMachineConnector> = abstract new (...args: never[]) => T;

/** The live connectors, one for each machine, found by machine ID */
export class MachineRegistry {
  private readonly connectors = new Map<string, BaseMachineConnector>();

  add(connector: BaseMachineConnector): void {
    this.connectors.set(connector.id, connector);
  }

  /** Returns the removed connector, or undefined when the ID is not known */
  remove(id: string): BaseMachineConnector | undefined {
    const connector = this.connectors.get(id);
    this.connectors.delete(id);
    return connector;
  }

  get(id: string): BaseMachineConnector | undefined {
    return this.connectors.get(id);
  }

  get size(): number {
    return this.connectors.size;
  }

  all(): BaseMachineConnector[] {
    return Array.from(this.connectors.values());
  }

  ofType<T extends BaseMachineConnector>(connectorClass: ConnectorClass<T>): T[] {
    return this.all().filter((connector): connector is T => connector instanceof connectorClass);
  }
}
