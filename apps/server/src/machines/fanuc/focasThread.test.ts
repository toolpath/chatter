import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FocasThread, type FocasWorkerPort } from './focasThread.js';
import { FocasRequestHandler, type FocasConnection, type FocasRequest } from './focasRequests.js';

/** A worker that answers with a FocasRequestHandler on a later turn, as a real thread does */
class FakeWorker extends EventEmitter implements FocasWorkerPort {
  readonly requests: FocasRequest[] = [];
  readonly initialize = vi.fn();
  /** While held, requests wait until release() */
  held = false;
  private readonly queue: FocasRequest[] = [];
  private readonly handler = new FocasRequestHandler({
    initialize: this.initialize,
    connect: host => ({ readStatus: () => ({ mode: host }), disconnect: vi.fn() }) as unknown as FocasConnection,
  });

  postMessage(request: FocasRequest): void {
    this.requests.push(request);
    this.queue.push(request);
    if (!this.held) this.release();
  }

  release(): void {
    this.held = false;
    for (const request of this.queue.splice(0)) {
      setImmediate(() => this.emit('message', this.handler.handle(request)));
    }
  }

  terminate = vi.fn(async () => 0);
  unref = vi.fn();
}

function threadWithFakeWorkers() {
  const workers: FakeWorker[] = [];
  const thread = new FocasThread(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { thread, workers };
}

describe('FocasThread', () => {
  it('starts the thread at the first call, and does not let it keep the server running', async () => {
    const { thread, workers } = threadWithFakeWorkers();
    expect(workers).toHaveLength(0);

    await thread.initialize('/lib.so');

    expect(workers).toHaveLength(1);
    expect(workers[0].unref).toHaveBeenCalled();
    expect(workers[0].initialize).toHaveBeenCalledWith('/lib.so');
    expect(thread.isLoaded()).toBe(true);
  });

  it('loads the library once, when machines connect at the same time', async () => {
    const { thread, workers } = threadWithFakeWorkers();
    await thread.initialize('/lib.so');
    await Promise.all([thread.connect('a', 8193, 10), thread.connect('b', 8193, 10)]);

    expect(workers[0].initialize).toHaveBeenCalledTimes(1);
  });

  it('shares one load between callers that ask before it finishes', async () => {
    const { thread, workers } = threadWithFakeWorkers();
    await Promise.all([thread.initialize('/lib.so'), thread.initialize('/lib.so')]);

    expect(workers[0].requests.filter(request => request.kind === 'initialize')).toHaveLength(1);
  });

  it('reads from the connection of each session', async () => {
    const { thread } = threadWithFakeWorkers();
    await thread.initialize('/lib.so');
    const first = await thread.connect('10.0.0.1', 8193, 10);
    const second = await thread.connect('10.0.0.2', 8193, 10);

    expect(await first.readStatus()).toEqual({ mode: '10.0.0.1' });
    expect(await second.readStatus()).toEqual({ mode: '10.0.0.2' });
  });

  it('gives a FOCAS failure as a rejected promise', async () => {
    const { thread } = threadWithFakeWorkers();
    await thread.initialize('/lib.so');
    const session = await thread.connect('h', 8193, 10);
    await session.disconnect();

    await expect(session.readStatus()).rejects.toThrow('Not connected to CNC controller');
  });

  it('keeps the server free while the control is slow to answer', async () => {
    const { thread, workers } = threadWithFakeWorkers();
    await thread.initialize('/lib.so');
    const session = await thread.connect('h', 8193, 10);
    workers[0].held = true;

    let answered = false;
    const read = session.readStatus().then(() => { answered = true; });
    // Timers and other work still run on the server's thread
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(answered).toBe(false);

    workers[0].release();
    await read;
    expect(answered).toBe(true);
  });

  describe('when the thread stops', () => {
    it('fails the waiting calls, and the connections of the stopped thread', async () => {
      const { thread, workers } = threadWithFakeWorkers();
      await thread.initialize('/lib.so');
      const session = await thread.connect('h', 8193, 10);
      workers[0].held = true;
      const waiting = session.readStatus();

      workers[0].emit('exit', 1);

      await expect(waiting).rejects.toThrow('The FOCAS thread stopped (exit code 1)');
      await expect(session.readStatus()).rejects.toThrow('The FOCAS thread stopped, so the connection is gone');
      expect(thread.isLoaded()).toBe(false);
    });

    it('starts a new thread and loads the library again at the next connect', async () => {
      const { thread, workers } = threadWithFakeWorkers();
      await thread.initialize('/lib.so');
      const old = await thread.connect('h', 8193, 10);
      workers[0].emit('error', new Error('boom'));

      await thread.initialize('/lib.so');
      const fresh = await thread.connect('h', 8193, 10);

      expect(workers).toHaveLength(2);
      expect(workers[1].initialize).toHaveBeenCalledTimes(1);
      expect(await fresh.readStatus()).toEqual({ mode: 'h' });
      // The old session has the same number as the new one, but belongs to the stopped thread
      await expect(old.readStatus()).rejects.toThrow('connection is gone');
    });

    it('stops the thread on request', async () => {
      const { thread, workers } = threadWithFakeWorkers();
      await thread.initialize('/lib.so');
      await thread.stop();

      expect(workers[0].terminate).toHaveBeenCalled();
      expect(thread.isLoaded()).toBe(false);
    });
  });
});

describe('FocasThread with a real thread', () => {
  const thread = new FocasThread();
  afterEach(() => thread.stop());

  it('runs focasWorker.ts and answers with the error of the library', async () => {
    await expect(thread.initialize('/no/such/folder/libfwlib32.so')).rejects.toThrow('Failed to initialize FOCAS library');
    expect(thread.isLoaded()).toBe(false);
  });
});
