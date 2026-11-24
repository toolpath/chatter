import { Hono } from 'hono';
import { hideMachineAddress, seesMachineSettings, type MachineAddressParts, type MachineHealth, type Role } from '@local-chatter/shared';
import type { HardwarePoller } from '../polling/poller.js';
import type { ConnectionHealth } from '../logging/ConnectionLog.js';
import { requirePermission, type LoggedInEnv } from '../auth/authRoutes.js';
import { createLogger } from '../logging/logger.js';
import { notFound } from './responses.js';
import { ConnectionTester, TestRefusedError } from '../diagnostics/connectionTest.js';

const log = createLogger('machines');

/** The part of the connection log that the routes read */
export interface ConnectionHealthSource {
  health(machineId: string): ConnectionHealth;
}

export const RECONNECT_MESSAGES = {
  started: 'Chatter disconnected the machine, and polls it again now.',
  'poll-in-progress': 'A poll of this machine has not ended, so Chatter does not start a second poll. '
    + 'Chatter disconnected the machine. 1 minute after the start of the poll, Chatter stops the wait for it and polls the machine again.',
  'not-polled': 'Chatter does not poll this machine now. Try again in some seconds.',
} as const;

/** Why a machine is offline and since when, a reconnect of one machine, and its connection test */
/** The texts of the health, as the role may see them: a Viewer gets no address and no username (D4) */
function healthForRole(role: Role, health: ConnectionHealth, machine: MachineAddressParts): ConnectionHealth {
  if (seesMachineSettings(role)) return health;
  const hide = (text: string) => hideMachineAddress(text, machine);
  return {
    ...health,
    lastError: health.lastError && { ...health.lastError, text: hide(health.lastError.text) },
    events: health.events.map(event => ({ ...event, text: hide(event.text) })),
  };
}

export function machineHealthRoutes(
  poller: HardwarePoller,
  connections: ConnectionHealthSource,
  tester = new ConnectionTester(poller),
) {
  const canManageMachines = requirePermission('manage-machines');
  return new Hono<LoggedInEnv>()
    .get('/machine/:id/health', c => {
      const id = c.req.param('id');
      const machine = poller.getMachine(id);
      if (!machine) return notFound(c);
      const health: MachineHealth = {
        ...healthForRole(c.var.user.role, connections.health(id), machine), lastPollTime: machine.lastPollTime, serverTime: new Date().toISOString(),
      };
      return c.json(health);
    })

    .post('/machine/:id/reconnect', canManageMachines, c => {
      const id = c.req.param('id');
      const result = poller.reconnectMachine(id);
      if (result === null) return notFound(c);
      log.info('Reconnect asked', { machine: id, user: c.var.user.username, result });
      if (result !== 'started') return c.json({ error: RECONNECT_MESSAGES[result] }, 409);
      return c.json({ message: RECONNECT_MESSAGES.started });
    })

    // Only the saved host and ports of the machine: the request has no body, so it cannot send Chatter to another address
    .post('/machine/:id/test', canManageMachines, async c => {
      try {
        return c.json(await tester.test(c.req.param('id'), c.var.user.username));
      } catch (error) {
        if (error instanceof TestRefusedError) return c.json({ error: error.message }, error.status);
        throw error;
      }
    });
}
