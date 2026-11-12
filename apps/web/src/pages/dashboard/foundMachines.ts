import { dataPortOf } from '../../machines/machineStatus';
import type { AddMachineRequest, FoundMachine, Machine } from '../../types';

/** The port the server reads data from: the MTConnect or FOCAS port, or else the data port */
function requestPortOf(request: AddMachineRequest): number | undefined {
  return request.mtConnectPort ?? request.focasPort ?? request.dataPort;
}

/** "192.168.1.50:5000": one found machine. The server allows one machine for each address and port. */
export function foundKeyOf(found: FoundMachine): string {
  return `${found.machine.host}:${requestPortOf(found.machine)}`;
}

/** True when a machine with the same address and port is in the list already */
export function isAlreadyAdded(found: FoundMachine, machines: Machine[]): boolean {
  const foundKey = foundKeyOf(found);
  return machines.some(machine => `${machine.host}:${dataPortOf(machine)}` === foundKey);
}

/** The found machines of an earlier scan, then the new ones, each one once */
export function mergeFound(known: FoundMachine[], newlyFound: FoundMachine[]): FoundMachine[] {
  const knownKeys = new Set(known.map(foundKeyOf));
  return [...known, ...newlyFound.filter(found => !knownKeys.has(foundKeyOf(found)))];
}

/** "192.168.1.1 to 192.168.1.254" */
export function rangeWords(range: string): string {
  return `${range}.1 to ${range}.254`;
}
