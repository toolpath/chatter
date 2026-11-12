import { Hono, type Context } from 'hono';
import { ProxyAddressError } from '../auth/proxyTrust.js';
import { ProxySettingLockedError, type ProxySettings } from '../auth/proxySettings.js';
import { originOf } from '../auth/requestOrigin.js';
import { requirePermission } from '../auth/authRoutes.js';
import { checkedJson } from './checks.js';
import { trustedProxiesSchema } from './schemas.js';

/** What the Settings page shows on the "HTTPS and proxy" tab */
function proxyReport(c: Context, proxySettings: ProxySettings) {
  const origin = originOf(c, proxySettings);
  return {
    addresses: proxySettings.addresses,
    isLocked: proxySettings.isLocked,
    senders: proxySettings.headerSenders().map(sender => ({ ...sender, lastSeen: sender.lastSeen.toISOString() })),
    connection: { address: origin.address, isHttps: origin.isHttps, proxyAddress: origin.proxyAddress ?? null },
  };
}

/** Read and change the trusted reverse proxies. Only an admin can do this. */
export function proxySettingsRoutes(proxySettings: ProxySettings) {
  const canManageChatter = requirePermission('manage-chatter');
  return new Hono()
    .get('/settings/proxy', canManageChatter, c => c.json(proxyReport(c, proxySettings)))

    .put('/settings/proxy', canManageChatter, checkedJson(trustedProxiesSchema), c => {
      try {
        proxySettings.save(c.req.valid('json').addresses);
      } catch (error) {
        if (error instanceof ProxySettingLockedError) return c.json({ error: error.message }, 409);
        if (error instanceof ProxyAddressError) return c.json({ error: error.message }, 400);
        throw error;
      }
      return c.json(proxyReport(c, proxySettings));
    });
}
