import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { UPDATE_FILE_LIMIT_BYTES } from '@local-chatter/shared';
import { requirePermission, type LoggedInEnv } from '../auth/authRoutes.js';
import { checkedJson } from './checks.js';
import { updateSettingsSchema } from './schemas.js';
import { LIMIT_MESSAGE, UpdateRefusedError, type UpdateService, type UpdatesReport } from '../updates/UpdateService.js';

const RAW_FILE_TYPE = 'application/octet-stream';
const WHOLE_NUMBER = /^\d+$/;

/** The browser sends the update file as the raw body, not as a form */
const requireRawFile = createMiddleware(async (c, next) => {
  const mediaType = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== RAW_FILE_TYPE) return c.json({ error: `Send the update file as ${RAW_FILE_TYPE}` }, 415);
  return next();
});

/**
 * bodyLimit reads a body with no length into memory to count it. The Pi has only 512 MB.
 * So the request must give its length first, and bodyLimit then checks only that number.
 */
const requireLengthFirst = createMiddleware(async (c, next) => {
  const length = c.req.header('Content-Length') ?? '';
  if (!WHOLE_NUMBER.test(length) || c.req.header('Transfer-Encoding') !== undefined) {
    return c.json({ error: 'Send the length of the update file (Content-Length)' }, 411);
  }
  return next();
});

const updateFileSizeLimit = bodyLimit({ maxSize: UPDATE_FILE_LIMIT_BYTES, onError: c => c.json({ error: LIMIT_MESSAGE }, 413) });

/** The new report, or the reply for a request that Chatter cannot do now */
async function reportOrRefusal(c: Context, action: () => Promise<UpdatesReport>) {
  try {
    return c.json(await action());
  } catch (error) {
    if (error instanceof UpdateRefusedError) return c.json({ error: error.message }, error.status);
    throw error;
  }
}

/**
 * Settings > Updates: see the version and the update status, upload or download an update file,
 * ask the helper to check or install it, and turn the check on GitHub on or off.
 * Only an admin can do this.
 */
export function updateRoutes(updates: UpdateService) {
  const canManageUpdates = requirePermission('manage-updates');
  return new Hono<LoggedInEnv>()
    .get('/updates/status', canManageUpdates, async c => c.json(await updates.report()))

    .post('/updates/file', canManageUpdates, requireRawFile, requireLengthFirst, updateFileSizeLimit, async c => {
      const body = c.req.raw.body;
      if (!body) return c.json({ error: 'No update file was sent' }, 400);
      const size = Number(c.req.header('Content-Length'));
      return reportOrRefusal(c, () => updates.receiveFile(body, size, c.var.user.username));
    })

    .post('/updates/download', canManageUpdates, c => reportOrRefusal(c, () => updates.download(c.var.user.username)))

    .put('/updates/settings', canManageUpdates, checkedJson(updateSettingsSchema), async c =>
      c.json(await updates.setCheckGitHub(c.req.valid('json').checkGitHub)))

    .post('/updates/check', canManageUpdates, c => reportOrRefusal(c, () => updates.request('check', c.var.user.username)))

    // The helper stops Chatter during the install. The page asks for the status again until Chatter is back.
    .post('/updates/install', canManageUpdates, c => reportOrRefusal(c, () => updates.request('install', c.var.user.username)));
}
