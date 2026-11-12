import { DEFAULT_MTCONNECT_PORT, DEFAULT_OPCUA_PORT } from '@local-chatter/shared';
import type { AddMachineRequest, BaseMachineStatus } from '../types/index.js';

/**
 * The port each machine type uses for data when the request gives no port.
 * The poller reads these defaults when it creates a machine, so both always match.
 */
export const DEFAULT_DATA_PORTS = {
  brother: 10000,
  haas: 9998,
  mtconnect: DEFAULT_MTCONNECT_PORT,
  fanuc: 8193,
  siemens: DEFAULT_OPCUA_PORT,
} satisfies Record<string, number>;

/** The Haas port for Q commands (questions and answers) */
export const DEFAULT_HAAS_QUERY_PORT = 5051;

/**
 * The data port that a new machine will use, from the add-machine request.
 */
export function getRequestedDataPort(request: AddMachineRequest): number | undefined {
  const portFromRequest = request.type === 'mtconnect' ? request.mtConnectPort
    : request.type === 'fanuc' ? request.focasPort
    : request.type === 'siemens' ? request.opcuaPort
    : request.dataPort;
  return portFromRequest || DEFAULT_DATA_PORTS[request.type as keyof typeof DEFAULT_DATA_PORTS];
}

/**
 * The data port of a machine that is already configured.
 */
function getMachineDataPort(machine: BaseMachineStatus): number | undefined {
  const status = machine as BaseMachineStatus & { mtConnectPort?: number; focasPort?: number; opcuaPort?: number };
  return status.mtConnectPort ?? status.focasPort ?? status.opcuaPort ?? status.dataPort;
}

/**
 * Find a machine that already uses the same IP address and data port.
 * Two machines can share an IP address when they use different ports,
 * for example one MTConnect agent PC that serves several machines.
 */
export function findMachineWithSameAddress(
  machines: BaseMachineStatus[],
  request: AddMachineRequest
): BaseMachineStatus | undefined {
  const requestedPort = getRequestedDataPort(request);
  return machines.find(machine =>
    machine.host === request.host && getMachineDataPort(machine) === requestedPort
  );
}
