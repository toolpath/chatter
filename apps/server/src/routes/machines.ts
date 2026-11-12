import { Hono } from 'hono';
import type { HardwarePoller } from '../polling/poller.js';
import { MTConnectConnector } from '../machines/mtconnect/MTConnectConnector.js';
import { findMachineWithSameAddress, getRequestedDataPort } from '../polling/machinePorts.js';
import { requirePermission } from '../auth/authRoutes.js';
import { checkedJson } from './checks.js';
import { notFound } from './responses.js';
import { addMachineSchema, scanPortSchema, updateMachineSchema } from './schemas.js';

/** List, add, change, and remove machines */
export function machineRoutes(poller: HardwarePoller) {
  const canManageMachines = requirePermission('manage-machines');
  return new Hono()
    .get('/machines', c => c.json(poller.getMachines()))

    .post('/machines', canManageMachines, checkedJson(addMachineSchema), async c => {
      const request = c.req.valid('json');
      const duplicateMachine = findMachineWithSameAddress(poller.getMachines(), request);
      if (duplicateMachine) {
        const port = getRequestedDataPort(request);
        return c.json({ error: `A machine with IP ${request.host} and port ${port} already exists (${duplicateMachine.name})` }, 409);
      }

      return c.json(await poller.addMachine(request), 201);
    })

    .get('/machine/:id', c => {
      const machine = poller.getMachine(c.req.param('id'));
      return machine ? c.json(machine) : notFound(c);
    })

    .put('/machine/:id', canManageMachines, checkedJson(updateMachineSchema), async c => {
      const updated = await poller.updateMachine(c.req.param('id'), c.req.valid('json'));
      return updated ? c.json(updated) : notFound(c);
    })

    .delete('/machine/:id', canManageMachines, async c => {
      const removed = await poller.removeMachine(c.req.param('id'));
      return removed ? c.json({ message: 'Machine removed' }) : notFound(c);
    })

    // Find the port of the MTConnect agent on a host
    .post('/mtconnect/scan-port', canManageMachines, checkedJson(scanPortSchema), async c => {
      const { host } = c.req.valid('json');
      const ports = await MTConnectConnector.scanAllPorts(host);
      return c.json({ host, ports, recommendedPort: ports.length > 0 ? ports[0] : null });
    });
}
