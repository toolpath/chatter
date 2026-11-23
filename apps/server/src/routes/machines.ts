import { Hono } from 'hono';
import type { HardwarePoller } from '../polling/poller.js';
import { MTConnectConnector } from '../machines/mtconnect/MTConnectConnector.js';
import { findMachineWithSameAddress, getRequestedDataPort } from '../polling/machinePorts.js';
import { PasswordNeededError } from '../polling/machineSettings.js';
import { requirePermission } from '../auth/authRoutes.js';
import { addAuditDetail } from '../logging/audit.js';
import { checkedJson } from './checks.js';
import { notFound } from './responses.js';
import { addMachineSchema, scanPortSchema, trustCertificateSchema, updateMachineSchema } from './schemas.js';
import type { ToolSyncErrorBody } from '../types/index.js';

const NOT_SIEMENS = 'Only a Siemens machine has an OPC UA certificate.';

/** The route has a reply for each outcome of a Sync. A new outcome fails the typecheck here until it has one. */
function unknownOutcome(result: never): never {
  throw new Error(`No reply for the Sync outcome ${JSON.stringify(result)}`);
}

/** List, add, change, and remove machines */
export function machineRoutes(poller: HardwarePoller) {
  const canManageMachines = requirePermission('manage-machines');
  const canSyncTools = requirePermission('sync-tools');
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
      try {
        const updated = await poller.updateMachine(c.req.param('id'), c.req.valid('json'));
        return updated ? c.json(updated) : notFound(c);
      } catch (error) {
        if (error instanceof PasswordNeededError) return c.json({ error: error.message }, 400);
        throw error;
      }
    })

    // Read the tool table now. The read changes nothing on the machine, but it is an action: a Viewer only looks.
    // Chatter also reads the tool table by itself, in the poll, not through this route.
    // Each error has the outcome, so the screen can tell when the error no longer applies.
    .post('/machine/:id/tools/sync', canSyncTools, async c => {
      const result = await poller.syncTools(c.req.param('id'));
      switch (result.outcome) {
        case 'synced': return c.json({ toolSync: result.toolSync }, 200);
        case 'failed':
          return c.json({
            error: `The machine did not send its tool table: ${result.toolSync.error}`, ...result,
          } satisfies ToolSyncErrorBody, 502);
        case 'too-soon':
          c.header('Retry-After', String(result.retryAfterSeconds));
          return c.json({
            error: `Chatter read the tool table a short time ago. Try again in ${result.retryAfterSeconds} seconds.`, ...result,
          } satisfies ToolSyncErrorBody, 429);
        case 'busy':
          return c.json({ error: 'A read of the tool table runs now. Wait until it is done.', ...result } satisfies ToolSyncErrorBody, 409);
        case 'not-connected':
          return c.json({
            error: 'The machine is not connected. Chatter can read its tool table when it is online.', ...result,
          } satisfies ToolSyncErrorBody, 409);
        case 'address-changed':
          return c.json({
            error: 'The address of the machine changed during the read. Chatter did not keep the result. '
              + 'Press Sync again when the machine is online at the new address.',
            ...result,
          } satisfies ToolSyncErrorBody, 409);
        case 'not-supported':
          return c.json({ error: 'This machine type has no tool table to read.', ...result } satisfies ToolSyncErrorBody, 400);
        case 'not-found': return notFound(c);
        default: return unknownOutcome(result);
      }
    })

    // An Admin trusts the new OPC UA certificate of a Siemens control (F-11). The body has the thumbprint that the status
    // showed, so the Admin trusts only the certificate that they checked. Chatter does not ask the control again here.
    .post('/machine/:id/opcua/trust-certificate', canManageMachines, checkedJson(trustCertificateSchema), c => {
      const { thumbprint } = c.req.valid('json');
      addAuditDetail(c, 'thumbprint', thumbprint);
      const id = c.req.param('id');
      switch (poller.trustSiemensCertificate(id, thumbprint)) {
        case 'trusted': return c.json(poller.getMachine(id));
        case 'not-found': return notFound(c);
        case 'not-siemens': return c.json({ error: NOT_SIEMENS }, 400);
        case 'stale':
          return c.json({
            error: 'The certificate of the control changed again. Chatter trusted nothing. Check the new thumbprint, then trust it.',
          }, 409);
        case 'nothing-to-trust':
          return c.json({
            error: 'The control shows no new certificate now, so there is nothing to trust. If the control shows no certificate, '
              + 'an Admin can forget the trusted certificate with POST /api/machine/:id/opcua/forget-certificate.',
          }, 409);
      }
    })

    // An Admin forgets the trusted OPC UA certificate of a Siemens control (F-11). Chatter connects again at once, and that
    // connect trusts the certificate that it gets, as the first connect does.
    .post('/machine/:id/opcua/forget-certificate', canManageMachines, c => {
      const id = c.req.param('id');
      switch (poller.forgetSiemensCertificate(id)) {
        case 'forgotten': return c.json(poller.getMachine(id));
        case 'not-found': return notFound(c);
        case 'not-siemens': return c.json({ error: NOT_SIEMENS }, 400);
      }
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
