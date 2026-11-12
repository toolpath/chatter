import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createLogger } from '../logging/logger.js';

const log = createLogger('api');

/** Small helpers that every route file uses */

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function notFound(c: Context, thing = 'Machine') {
  return c.json({ error: `${thing} not found` }, 404);
}

/** The reply when VictoriaMetrics cannot give the machine history. The log names the route (`logTag`) and the cause. */
export function historyUnavailable(c: Context, logTag: string, error: unknown) {
  log.error('Could not read the machine history', { route: logTag, error });
  return c.json({ error: 'The machine history is not available now. Try again later.' }, 503);
}

/** The reply for an error that the route did not catch */
export function errorReply(error: Error, c: Context) {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  return c.json({ error: errorMessage(error) }, 500);
}
