import { Hono } from 'hono';
import { getUploadEventById, getUploadEvents, getUploadFiles } from '../storage/database.js';
import { checkedQuery } from './checks.js';
import { notFound } from './responses.js';
import { uploadListQuery } from './schemas.js';

const DEFAULT_FILE_LIMIT = 50;

/** The record of files that were sent to each machine */
export function uploadHistoryRoutes() {
  return new Hono()
    // The files sent to a machine, one entry for each file name
    .get('/machine/:id/uploads', checkedQuery(uploadListQuery), async c => {
      const limit = parseInt(c.req.valid('query').limit ?? '') || DEFAULT_FILE_LIMIT;
      return c.json(await getUploadFiles(c.req.param('id'), limit));
    })

    // Each time one file was sent
    .get('/machine/:id/uploads/:fileId/events', async c => {
      return c.json(await getUploadEvents(c.req.param('fileId')));
    })

    // One send, with the file content
    .get('/machine/:id/uploads/events/:eventId', async c => {
      const event = await getUploadEventById(c.req.param('eventId'));
      return event ? c.json(event) : notFound(c, 'Upload event');
    });
}
