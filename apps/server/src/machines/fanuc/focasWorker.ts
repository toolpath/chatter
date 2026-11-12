/**
 * The FOCAS thread. It makes every cnc_* call, so a control that is slow to answer never stops the server.
 * The calls run one at a time, and each connection stays on this one thread.
 * FocasThread (focasThread.ts) starts it.
 */

import { parentPort } from 'worker_threads';
import { Focas } from './focas.js';
import { FocasRequestHandler, type FocasRequest } from './focasRequests.js';

if (!parentPort) throw new Error('focasWorker.ts must run as a worker thread');
const server = parentPort;

const handler = new FocasRequestHandler({
  initialize: libraryPath => Focas.initialize(libraryPath),
  connect: (host, port, timeoutSeconds) => {
    const focas = new Focas();
    focas.connect(host, port, timeoutSeconds);
    return focas;
  },
});

server.on('message', (request: FocasRequest) => {
  server.postMessage(handler.handle(request));
});
