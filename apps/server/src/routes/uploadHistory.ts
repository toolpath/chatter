import { Hono, type Context } from 'hono';
import { roleCan } from '@local-chatter/shared';
import { requirePermission, type LoggedInEnv } from '../auth/authRoutes.js';
import type { UploadEventRow } from '../types/index.js';
import { getUploadEventById, getUploadEvents, getUploadFiles } from '../storage/database.js';
import { checkedParam, checkedQuery } from './checks.js';
import { notFound } from './responses.js';
import { uploadEventParams, uploadFileParams, uploadListQuery } from './schemas.js';

const DEFAULT_FILE_LIMIT = 50;

/**
 * The upload, without the details that the role of the user may not see. Decision D4: a Viewer does not see who sent
 * a file. An Operator sees who sent it (the history of the machine), but only an Admin sees the address of the computer.
 */
function forRoleOf(c: Context<LoggedInEnv>, row: UploadEventRow) {
  const { role } = c.var.user;
  const { uploaded_by, address, ...rest } = row;
  return {
    ...rest,
    ...(roleCan(role, 'read-files') ? { uploaded_by } : {}),
    ...(roleCan(role, 'manage-chatter') ? { address } : {}),
  };
}

/**
 * The record of files that were sent to each machine. Each role sees the names and dates; only read-files gives the text
 * and who sent the file; only an Admin gets the address.
 */
export function uploadHistoryRoutes() {
  return new Hono<LoggedInEnv>()
    // The files sent to a machine, one entry for each file name
    .get('/machine/:id/uploads', checkedQuery(uploadListQuery), async c => {
      const limit = parseInt(c.req.valid('query').limit ?? '') || DEFAULT_FILE_LIMIT;
      return c.json(await getUploadFiles(c.req.param('id'), limit));
    })

    // Each time one file was sent
    .get('/machine/:id/uploads/:fileId/events', checkedParam(uploadFileParams), async c => {
      const { id, fileId } = c.req.valid('param');
      return c.json((await getUploadEvents(id, fileId)).map(event => forRoleOf(c, event)));
    })

    // One send, with the file content
    .get('/machine/:id/uploads/events/:eventId', requirePermission('read-files'), checkedParam(uploadEventParams), async c => {
      const { id, eventId } = c.req.valid('param');
      const event = await getUploadEventById(id, eventId);
      return event ? c.json(forRoleOf(c, event)) : notFound(c, 'Upload event');
    });
}
