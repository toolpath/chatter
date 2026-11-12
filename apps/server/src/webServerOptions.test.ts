import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { WEB_SERVER_OPTIONS } from './webServerOptions.js';
import { UPDATE_TIME_LIMIT_MS } from './updates/timeLimits.js';

describe('WEB_SERVER_OPTIONS', () => {
  it('gives a slow upload of an update file the full update time, not the Node default of 5 minutes', () => {
    const server = createServer(WEB_SERVER_OPTIONS);

    expect(server.requestTimeout).toBe(UPDATE_TIME_LIMIT_MS);
  });

  it('still closes a connection that does not send its headers within one minute', () => {
    const server = createServer(WEB_SERVER_OPTIONS);

    expect(server.headersTimeout).toBe(60_000);
  });
});
