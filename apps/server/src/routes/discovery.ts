import { existsSync } from 'node:fs';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { AddMachineRequest } from '@local-chatter/shared';
import { Hono } from 'hono';
import { guessRanges, hostWithoutPort } from '../discovery/addressRange.js';
import { NetworkScanner, ScanAlreadyRunningError } from '../discovery/NetworkScanner.js';
import type { HardwarePoller } from '../polling/poller.js';
import { findMachineWithSameAddress } from '../polling/machinePorts.js';
import { requirePermission } from '../auth/authRoutes.js';
import { checkedJson } from './checks.js';
import { scanNetworkSchema } from './schemas.js';

/** Docker makes this file in every container */
const DOCKER_MARKER_FILE = '/.dockerenv';

/** The IPv4 addresses of this computer. In Docker they are Docker's own addresses, which do not help, so none. */
function serverAddresses(): string[] {
  if (existsSync(DOCKER_MARKER_FILE)) return [];
  return Object.values(networkInterfaces())
    .flat()
    .filter((info): info is NetworkInterfaceInfo => info !== undefined && info.family === 'IPv4' && !info.internal)
    .map(info => info.address);
}

/** Find machines on the shop network that are not added yet */
export function discoveryRoutes(poller: HardwarePoller, scanner = new NetworkScanner()) {
  const isAdded = (machine: AddMachineRequest) =>
    findMachineWithSameAddress(poller.getMachines(), machine) !== undefined;

  const canManageMachines = requirePermission('manage-machines');
  return new Hono()
    // The address ranges where the machines probably are, best guess first
    .get('/discovery/ranges', canManageMachines, c => c.json({
      ranges: guessRanges({
        machineHosts: poller.getMachines().map(machine => machine.host),
        serverAddresses: serverAddresses(),
        pageHost: hostWithoutPort(c.req.header('host')),
      }),
    }))

    .post('/discovery/scan', canManageMachines, checkedJson(scanNetworkSchema), async c => {
      const { range } = c.req.valid('json');
      try {
        return c.json({ range, found: await scanner.scan(range, isAdded) });
      } catch (error) {
        if (error instanceof ScanAlreadyRunningError) return c.json({ error: error.message }, 409);
        throw error;
      }
    });
}
