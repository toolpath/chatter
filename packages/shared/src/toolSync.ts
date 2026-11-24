import type { ToolSyncState } from './machineData.js';

/**
 * How a Sync request (POST /api/machine/:id/tools/sync) ends. The server and the screen use this one list, so a new
 * outcome fails the typecheck where it is not handled.
 * - 'synced', 'failed': Chatter read the tools, and `toolSync` has the state after the read.
 * - 'too-soon': a Sync came less than 30 seconds after the last one.
 * - 'busy': a read of the tools runs now.
 * - 'not-connected': the machine is offline.
 * - 'program-running': the last poll did not say that the machine runs no program (READY), so Chatter does not read.
 * - 'address-changed': the address changed during the read, so Chatter did not keep its result.
 * - 'not-supported': the machine type has no tool table to read.
 * - 'not-found': there is no machine with this id.
 */
export type ToolSyncOutcome =
  | { outcome: 'synced'; toolSync: ToolSyncState }
  | { outcome: 'failed'; toolSync: ToolSyncState }
  | { outcome: 'too-soon'; retryAfterSeconds: number }
  | { outcome: 'busy' }
  | { outcome: 'not-connected' }
  | { outcome: 'program-running' }
  | { outcome: 'address-changed' }
  | { outcome: 'not-supported' }
  | { outcome: 'not-found' };

/**
 * The body of an error reply of the Sync route: the text for the screen, and the outcome with its fields.
 * 'not-found' has the general body of a missing machine, with no outcome.
 */
export type ToolSyncErrorBody = { error: string } & Exclude<ToolSyncOutcome, { outcome: 'synced' | 'not-found' }>;
