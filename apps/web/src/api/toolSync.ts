import type { ToolSyncErrorBody, ToolSyncOutcome } from '@local-chatter/shared';
import type { ToolSyncState } from '../types';
import { api } from './client';

/** The text of a Sync error when the reply has no text, for example a page of a proxy */
export const SYNC_FAILURE_TEXT = 'Could not read the tool table';

/**
 * Why a Sync gave no new tool table: the read failed, or the server refused the Sync. The screen uses it to remove
 * the error when the error no longer applies. 'other': a reply with no outcome, for example a page of a proxy.
 */
export type SyncProblem = Exclude<ToolSyncOutcome, { outcome: 'synced' }> | { outcome: 'other' };

/** A Sync that gave no new tool table: the text of the server, and why */
export class ToolSyncError extends Error {
  constructor(message: string, readonly problem: SyncProblem) {
    super(message);
  }
}

const OTHER: SyncProblem = { outcome: 'other' };

/** A reply body as it comes. It is not always from Chatter: a proxy can send its own JSON. */
type AnyBody = Record<string, unknown>;

const isObject = (body: unknown): body is AnyBody => typeof body === 'object' && body !== null;

/** True for an error body of the Sync route. A page of a proxy, or the body of a missing machine, has no outcome. */
function isSyncErrorBody(body: unknown): body is ToolSyncErrorBody {
  return isObject(body) && typeof body.outcome === 'string';
}

/** Each outcome of the server has a case here, so a new outcome fails the typecheck */
function problemOf(body: ToolSyncErrorBody): SyncProblem {
  switch (body.outcome) {
    case 'failed': return { outcome: body.outcome, toolSync: body.toolSync };
    case 'too-soon': return { outcome: body.outcome, retryAfterSeconds: body.retryAfterSeconds };
    case 'busy':
    case 'not-connected':
    case 'program-running':
    case 'address-changed':
    case 'not-supported':
      return { outcome: body.outcome };
    default: return unknownOutcome(body);
  }
}

/** The typecheck finds an outcome with no case. At run time, an outcome that this screen does not know is 'other'. */
function unknownOutcome(_body: never): SyncProblem {
  return OTHER;
}

/** Ask the server to read the tool table of the machine now. Throws a ToolSyncError with the server's reason. */
export async function syncTools(machineId: string): Promise<ToolSyncState> {
  const response = await api.machine[':id'].tools.sync.$post({ param: { id: machineId } });
  // A proxy can send a page that is not JSON. Then the general text is used.
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && isObject(body) && body.toolSync) return body.toolSync as ToolSyncState;
  const text = isObject(body) && typeof body.error === 'string' && body.error ? body.error : SYNC_FAILURE_TEXT;
  throw new ToolSyncError(text, isSyncErrorBody(body) ? problemOf(body) : OTHER);
}
