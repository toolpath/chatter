import type { ServerOptions } from 'node:http';
import { UPDATE_TIME_LIMIT_MS } from './updates/timeLimits.js';

/** A client must send all its request headers within this time */
const HEADERS_TIME_LIMIT_MS = 60_000;

/**
 * The Node HTTP options for the web server.
 * Node stops a request that takes more than 5 minutes by default. An update file of 600 MB on a slow
 * network takes longer, so a request may take as long as the update time limit.
 * The headers still have a short limit, so a client that connects and sends nothing is closed.
 * An upload that stops sending bytes is stopped by the idle limit of the update stream, not here.
 * There is no idle limit on the socket, because the live machine events (SSE) can be quiet for a long time.
 */
export const WEB_SERVER_OPTIONS: ServerOptions = {
  requestTimeout: UPDATE_TIME_LIMIT_MS,
  headersTimeout: HEADERS_TIME_LIMIT_MS,
};
