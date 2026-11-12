import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { ProxySettings } from './proxySettings.js';
import type { RequestOrigin } from './proxyTrust.js';

/** The computer that connected. Tests that call app.request() with no Node server have none. */
function socketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

/** Where the request really came from, also behind a trusted reverse proxy */
export function originOf(c: Context, proxySettings: ProxySettings): RequestOrigin {
  return proxySettings.originOf({
    socketAddress: socketAddress(c),
    url: c.req.url,
    forwardedFor: c.req.header('X-Forwarded-For'),
    forwardedProto: c.req.header('X-Forwarded-Proto'),
  });
}
