import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { LoggedInEnv } from '../auth/authRoutes.js';
import type { BaseMachineConnector } from '../machines/BaseMachineConnector.js';
import type { HardwarePoller } from '../polling/poller.js';
import { PROGRAM_UPLOAD_LIMIT_BYTES } from '@local-chatter/shared';
import { ProxySettings } from '../auth/proxySettings.js';
import { machineFileRoutes } from './machineFiles.js';

// The server holds the files of an upload in memory, and a Pi can have only 512 MB. Each machine has its own FTP queue,
// so the queue does not limit the uploads of all machines. The route itself lets only a few uploads hold a body.

vi.mock('../storage/database.js', () => ({ recordUpload: vi.fn() }));

const BUSY_TEXT = 'Chatter is busy with other uploads. Try again later.';
const MACHINE_BUSY_TEXT = 'The machine is busy with other file tasks. Try again later.';

/** An upload on the machine that runs until the test ends it */
function heldUploads() {
  const ends: Array<() => void> = [];
  let isHeld = true;
  const upload = () => (isHeld ? new Promise<void>(resolve => { ends.push(resolve); }) : Promise.resolve());
  return {
    upload,
    count: () => ends.length,
    endAll: () => {
      isHeld = false;
      ends.forEach(end => end());
    },
  };
}

function appWith(held: ReturnType<typeof heldUploads>) {
  const connector = {
    uploadFile: vi.fn(held.upload),
    uploadFiles: vi.fn(async () => {
      await held.upload();
      return { success: [], failed: [] };
    }),
  };
  // Machine "missing" does not exist
  const poller = {
    getConnector: (id: string) => (id === 'missing' ? undefined : connector as unknown as BaseMachineConnector),
  } as unknown as HardwarePoller;
  const app = new Hono<LoggedInEnv>()
    .use(async (c, next) => {
      c.set('user', { id: 1, username: 'operator', role: 'operator' });
      await next();
    })
    .route('/', machineFileRoutes(poller, ProxySettings.inMemory()));
  return { app, connector };
}

function uploadForm(): FormData {
  const form = new FormData();
  form.append('file', new File(['O1000\nM30\n'], 'O1000.nc'));
  form.append('path', '/O1000.nc');
  return form;
}

function batchForm(): FormData {
  const form = new FormData();
  form.append('files', new File(['O1000\nM30\n'], 'O1000.nc'));
  form.append('basePath', '/');
  return form;
}

const post = (app: Hono<LoggedInEnv>, path: string, body: FormData) => app.request(path, { method: 'POST', body });

/** Resolve when the condition is true, or fail after 2 s */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('The condition did not become true in 2 s');
    await new Promise(resolve => setImmediate(resolve));
  }
}

describe('the limit of uploads at the same time, for all machines', () => {
  let held: ReturnType<typeof heldUploads> | undefined;

  afterEach(() => {
    held?.endAll();
    held = undefined;
  });

  it('refuses a third upload with 503 while two uploads run, and accepts uploads again after they end', async () => {
    held = heldUploads();
    const { app, connector } = appWith(held);
    const running = [post(app, '/machine/1/files/upload', uploadForm()), post(app, '/machine/2/files/upload-batch', batchForm())];
    await until(() => held?.count() === 2);

    const single = await post(app, '/machine/3/files/upload', uploadForm());
    const batch = await post(app, '/machine/3/files/upload-batch', batchForm());

    expect(single.status).toBe(503);
    expect(await single.json()).toEqual({ error: BUSY_TEXT });
    expect(batch.status).toBe(503);
    expect(await batch.json()).toEqual({ error: BUSY_TEXT });
    expect(connector.uploadFile).toHaveBeenCalledTimes(1);
    expect(connector.uploadFiles).toHaveBeenCalledTimes(1);

    held.endAll();
    expect((await Promise.all(running)).map(reply => reply.status)).toEqual([200, 200]);
    const after = await post(app, '/machine/3/files/upload', uploadForm());
    expect(after.status).toBe(200);
  });

  // The body of an upload is in memory as soon as the route reads it. So the refusal must come first.
  it('refuses the upload before it reads the body', async () => {
    held = heldUploads();
    const { app } = appWith(held);
    const running = [post(app, '/machine/1/files/upload', uploadForm()), post(app, '/machine/2/files/upload', uploadForm())];
    await until(() => held?.count() === 2);
    // A body that never ends: a route that reads it never answers
    const endlessBody = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
    const request = new Request('http://localhost/machine/3/files/upload', {
      method: 'POST',
      body: endlessBody,
      headers: { 'Content-Type': 'multipart/form-data; boundary=chatter' },
      duplex: 'half',
    } as RequestInit);

    const reply = await app.request(request);

    expect(reply.status).toBe(503);
    held.endAll();
    await Promise.all(running);
  });

  // Uploads to one machine run one at a time. So one busy machine must not take both places, and block the uploads to
  // the other machines.
  it('lets only one upload to each machine hold its files, before it reads the body', async () => {
    held = heldUploads();
    const { app, connector } = appWith(held);
    const running = post(app, '/machine/1/files/upload', uploadForm());
    await until(() => held?.count() === 1);
    const endlessBody = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
    const request = new Request('http://localhost/machine/1/files/upload-batch', {
      method: 'POST',
      body: endlessBody,
      headers: { 'Content-Type': 'multipart/form-data; boundary=chatter' },
      duplex: 'half',
    } as RequestInit);

    const sameMachine = await app.request(request);
    const otherMachine = post(app, '/machine/2/files/upload', uploadForm());
    await until(() => held?.count() === 2);

    expect(sameMachine.status).toBe(503);
    expect(await sameMachine.json()).toEqual({ error: MACHINE_BUSY_TEXT });
    expect(connector.uploadFiles).not.toHaveBeenCalled();
    held.endAll();
    expect((await Promise.all([running, otherMachine])).map(reply => reply.status)).toEqual([200, 200]);
    expect((await post(app, '/machine/1/files/upload', uploadForm())).status).toBe(200);
  });

  it('frees the place of an upload that fails', async () => {
    held = heldUploads();
    const { app, connector } = appWith(held);
    held.endAll();
    connector.uploadFile.mockRejectedValue(new Error('FTP upload error: 550 Permission denied'));

    const replies = [];
    for (let i = 0; i < 3; i += 1) replies.push((await post(app, '/machine/1/files/upload', uploadForm())).status);

    expect(replies).toEqual([500, 500, 500]);
    connector.uploadFile.mockImplementation(held.upload);
    expect((await post(app, '/machine/1/files/upload', uploadForm())).status).toBe(200);
  });

  /** An upload to machine 1 that the browser stops while the machine runs it */
  async function abortedUpload(app: Hono<LoggedInEnv>, connector: ReturnType<typeof appWith>['connector']) {
    connector.uploadFile.mockImplementationOnce((...args: unknown[]) => {
      const signal = args[3] as AbortSignal;
      return new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('The browser left'))));
    });
    const browser = new AbortController();
    const reply = app.request('/machine/1/files/upload', { method: 'POST', body: uploadForm(), signal: browser.signal });
    await until(() => connector.uploadFile.mock.calls.length === 1);
    browser.abort();
    return reply;
  }

  function tooLargeForm(): FormData {
    const form = new FormData();
    form.append('file', new File([Buffer.alloc(PROGRAM_UPLOAD_LIMIT_BYTES + 1)], 'O1000.nc'));
    form.append('path', '/O1000.nc');
    return form;
  }

  // A place that an upload does not give back blocks the uploads to that machine, and after two, to all machines
  it.each([
    { name: 'a body that is too large', status: 413, send: (app: Hono<LoggedInEnv>) => post(app, '/machine/1/files/upload', tooLargeForm()) },
    { name: 'a machine that does not exist', status: 404, send: (app: Hono<LoggedInEnv>) => post(app, '/machine/missing/files/upload', uploadForm()) },
    {
      name: 'a file that is already on the machine',
      status: 409,
      send: (app: Hono<LoggedInEnv>, connector: ReturnType<typeof appWith>['connector']) => {
        connector.uploadFile.mockRejectedValueOnce(new Error('File "O1000.nc" already exists. Enable overwrite to replace it.'));
        return post(app, '/machine/1/files/upload', uploadForm());
      },
    },
    { name: 'a browser that leaves', status: 499, send: abortedUpload },
  ])('frees the place of an upload after $name', async ({ status, send }) => {
    held = heldUploads();
    const { app, connector } = appWith(held);

    expect((await send(app, connector)).status).toBe(status);

    const next = [post(app, '/machine/1/files/upload', uploadForm()), post(app, '/machine/2/files/upload', uploadForm())];
    await until(() => held?.count() === 2);
    held.endAll();
    expect((await Promise.all(next)).map(reply => reply.status)).toEqual([200, 200]);
  });
});
