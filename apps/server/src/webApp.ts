import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { API_PREFIX } from './app.js';

const isApiPath = (path: string) => path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
/** A file address, such as /assets/index-1a2b.js, ends in a file extension. A page address does not. */
const isFilePath = (path: string) => /\.[^/]+$/.test(path);

/**
 * Serve the built web app (apps/web/dist) from the same server as the API.
 * Any other page address gets index.html, so the web app's own router can show that page.
 * A missing file and an unknown /api address get a 404 reply.
 * (After an update, an old tab may ask for an old file. It must get 404, not the page as JavaScript.)
 */
export function webAppRoutes(webDir: string) {
  const serveIndexPage = serveStatic({ root: webDir, path: 'index.html' });
  return new Hono()
    .use('*', serveStatic({ root: webDir }))
    .get('*', (c, next) => {
      const path = c.req.path;
      return isApiPath(path) || isFilePath(path) ? next() : serveIndexPage(c, next);
    });
}
