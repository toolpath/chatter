import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Focas } from './focas.js';
import { FocasThread, FocasThreads, type FocasWorkerPort } from './focasThread.js';
import { FocasRequestHandler, type FocasConnection, type FocasRequest } from './focasRequests.js';
import { EW_BUSY, EW_SOCKET, FocasError } from './focasError.js';

/** A worker that answers with a FocasRequestHandler on a later turn, as a real thread does */
class FakeWorker extends EventEmitter implements FocasWorkerPort {
  readonly requests: FocasRequest[] = [];
  readonly initialize = vi.fn();
  /** The library calls of every fake worker, in order, for the tests of the shutdown */
  static readonly calls: string[] = [];
  readonly cleanup = vi.fn((exitProcess: boolean) => { FakeWorker.calls.push(`cleanup ${exitProcess}`); });
  /** The status read of each connection, by the host it connected to */
  readonly readStatus = vi.fn((host: string): unknown => ({ mode: host }));
  /** While held, requests wait until release() */
  held = false;
  private readonly queue: FocasRequest[] = [];
  private readonly handler = new FocasRequestHandler({
    initialize: this.initialize,
    connect: host => ({
      readStatus: () => this.readStatus(host),
      disconnect: vi.fn(() => { FakeWorker.calls.push(`disconnect ${host}`); }),
    }) as unknown as FocasConnection,
    cleanup: this.cleanup,
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
    expect(workers[0].initialize).toHaveBeenCalledWith('/lib.so', true);
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

  describe('FOCAS return codes', () => {
    const busy = () => { throw new FocasError('Failed to read status: Busy', EW_BUSY); };

    it('gives a failed cnc_* call as a FocasError with its code', async () => {
      const { thread, workers } = threadWithFakeWorkers();
      await thread.initialize('/lib.so');
      const session = await thread.connect('h', 8193, 10);
      workers[0].readStatus.mockImplementation(() => { throw new FocasError('Failed to read status: Socket error', EW_SOCKET); });

      const error = await session.readStatus().catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(FocasError);
      expect(error).toMatchObject({ code: EW_SOCKET, message: 'Failed to read status: Socket error' });
    });

    it('tries a read again when the control is busy', async () => {
      const { thread, workers } = threadWithFakeWorkers();
      await thread.initialize('/lib.so');
      const session = await thread.connect('h', 8193, 10);
      workers[0].readStatus.mockImplementationOnce(busy).mockImplementationOnce(busy);

      expect(await session.readStatus()).toEqual({ mode: 'h' });
      expect(workers[0].readStatus).toHaveBeenCalledTimes(3);
    });

    it('gives up after a few tries when the control stays busy', async () => {
      const { thread, workers } = threadWithFakeWorkers();
      await thread.initialize('/lib.so');
      const session = await thread.connect('h', 8193, 10);
      workers[0].readStatus.mockImplementation(busy);

      await expect(session.readStatus()).rejects.toMatchObject({ code: EW_BUSY });
      expect(workers[0].readStatus).toHaveBeenCalledTimes(3);
    });

    it('does not try again after another failure', async () => {
      const { thread, workers } = threadWithFakeWorkers();
      await thread.initialize('/lib.so');
      const session = await thread.connect('h', 8193, 10);
      workers[0].readStatus.mockImplementation(() => { throw new FocasError('Failed to read status: Socket error', EW_SOCKET); });

      await expect(session.readStatus()).rejects.toMatchObject({ code: EW_SOCKET });
      expect(workers[0].readStatus).toHaveBeenCalledTimes(1);
    });
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

/** onStart can set up each worker before its first request */
function threadsWithFakeWorkers(onStart: (worker: FakeWorker) => void = () => undefined) {
  const workers: FakeWorker[] = [];
  const threads = new FocasThreads(() => {
    const worker = new FakeWorker();
    onStart(worker);
    workers.push(worker);
    return worker;
  });
  return { threads, workers };
}

/** The startProcess flag of each library load, worker by worker */
function processStarts(workers: FakeWorker[]): boolean[] {
  return workers.flatMap(worker => worker.requests.flatMap(request => request.kind === 'initialize' ? [request.startProcess] : []));
}

describe('FocasThreads', () => {
  // connect() loads the library from the path for this computer, which the tests do not have
  beforeEach(() => { vi.spyOn(Focas, 'libraryPath').mockReturnValue('/lib.so'); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('gives each machine its own thread, started at its first call', async () => {
    const { threads, workers } = threadsWithFakeWorkers();
    const first = threads.thread();
    const second = threads.thread();
    expect(workers).toHaveLength(0);

    await first.connect('10.0.0.1', 8193, 10);
    await second.connect('10.0.0.2', 8193, 10);

    expect(workers).toHaveLength(2);
    expect(threads.isLoaded()).toBe(true);
  });

  it('does not hold up a machine while another control is slow to answer', async () => {
    const { threads, workers } = threadsWithFakeWorkers();
    const slow = await threads.thread().connect('10.0.0.1', 8193, 10);
    const fast = await threads.thread().connect('10.0.0.2', 8193, 10);
    // The first control does not answer, for example while cnc_allclibhndl3 waits for its timeout
    workers[0].held = true;

    let slowAnswered = false;
    const slowRead = slow.readStatus().then(() => { slowAnswered = true; });

    expect(await fast.readStatus()).toEqual({ mode: '10.0.0.2' });
    expect(slowAnswered).toBe(false);

    workers[0].release();
    await slowRead;
  });

  it('starts the Linux FOCAS process on the first thread only', async () => {
    const { threads, workers } = threadsWithFakeWorkers();
    await Promise.all([
      threads.thread().connect('a', 8193, 10),
      threads.thread().connect('b', 8193, 10),
      threads.thread().connect('c', 8193, 10),
    ]);

    expect(processStarts(workers)).toEqual([true, false, false]);
  });

  it('lets the next thread start the process when the first load fails', async () => {
    let started = 0;
    const { threads, workers } = threadsWithFakeWorkers(worker => {
      if (started++ === 0) worker.initialize.mockImplementationOnce(() => { throw new Error('Failed to initialize FOCAS library'); });
    });
    const first = threads.thread();
    const second = threads.thread();
    const failing = first.initialize('/lib.so');
    const waiting = second.initialize('/lib.so');

    await expect(failing).rejects.toThrow('Failed to initialize FOCAS library');
    await waiting;
    expect(processStarts(workers)).toEqual([true, true]);
  });

  it('starts the process again when no thread has the library any more', async () => {
    const { threads, workers } = threadsWithFakeWorkers();
    const thread = threads.thread();
    await thread.initialize('/lib.so');
    await thread.stop();
    expect(threads.isLoaded()).toBe(false);

    await threads.thread().initialize('/lib.so');
    expect(processStarts(workers)).toEqual([true, true]);
  });

  it('gives the thread that loaded the library for the upload to the next machine', async () => {
    const { threads, workers } = threadsWithFakeWorkers();
    await threads.initialize('/lib.so');
    const session = await threads.thread().connect('h', 8193, 10);

    expect(workers).toHaveLength(1);
    expect(await session.readStatus()).toEqual({ mode: 'h' });
  });

  it('stops only the thread of a removed machine', async () => {
    const { threads, workers } = threadsWithFakeWorkers();
    const removed = threads.thread();
    const kept = threads.thread();
    await removed.connect('a', 8193, 10);
    const session = await kept.connect('b', 8193, 10);

    await removed.stop();

    expect(workers[0].terminate).toHaveBeenCalled();
    expect(workers[1].terminate).not.toHaveBeenCalled();
    expect(await session.readStatus()).toEqual({ mode: 'b' });
  });

  it('keeps the crash behaviour of each thread: its connections fail, and it starts again at the next call', async () => {
    const { threads, workers } = threadsWithFakeWorkers();
    const thread = threads.thread();
    const old = await thread.connect('h', 8193, 10);
    workers[0].emit('exit', 1);

    await expect(old.readStatus()).rejects.toThrow('connection is gone');
    const fresh = await thread.connect('h', 8193, 10);
    expect(workers).toHaveLength(2);
    expect(await fresh.readStatus()).toEqual({ mode: 'h' });
    // No other thread had the library, so the new one starts the process again
    expect(processStarts(workers)).toEqual([true, true]);
  });

  describe('at shutdown', () => {
    beforeEach(() => { FakeWorker.calls.length = 0; });

    it('frees the handles of each thread, ends the FOCAS process last, and stops every thread', async () => {
      const { threads, workers } = threadsWithFakeWorkers();
      await threads.thread().connect('a', 8193, 10);
      await threads.thread().connect('b', 8193, 10);

      await threads.shutDown();

      expect(FakeWorker.calls).toEqual(['disconnect a', 'cleanup false', 'disconnect b', 'cleanup true']);
      expect(workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
      expect(threads.isLoaded()).toBe(false);
    });

    it('ends a disconnect that was sent just before, first', async () => {
      const { threads } = threadsWithFakeWorkers();
      const session = await threads.thread().connect('a', 8193, 10);

      void session.disconnect();
      await threads.shutDown();

      expect(FakeWorker.calls).toEqual(['disconnect a', 'cleanup true']);
    });

    it('does not wait longer than the time limit for a thread that hangs', async () => {
      const { threads, workers } = threadsWithFakeWorkers();
      await threads.thread().connect('slow', 8193, 10);
      await threads.thread().connect('fast', 8193, 10);
      // The first control does not answer
      workers[0].held = true;

      await threads.shutDown(20);

      expect(FakeWorker.calls).toEqual(['disconnect fast', 'cleanup true']);
      expect(workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
    });

    it('stops a thread that has not loaded the library, with no cleanup', async () => {
      const { threads, workers } = threadsWithFakeWorkers(worker => {
        worker.initialize.mockImplementation(() => { throw new Error('Failed to initialize FOCAS library'); });
      });
      await expect(threads.thread().connect('a', 8193, 10)).rejects.toThrow('Failed to initialize');

      await threads.shutDown();

      expect(workers[0].cleanup).not.toHaveBeenCalled();
      expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    });
  });

  it('stops every thread', async () => {
    const { threads, workers } = threadsWithFakeWorkers();
    await threads.thread().connect('a', 8193, 10);
    await threads.thread().connect('b', 8193, 10);

    await threads.stop();

    expect(workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
    expect(threads.isLoaded()).toBe(false);
  });
});

describe('FocasThread with a real thread', () => {
  const thread = new FocasThread();
  afterEach(() => thread.stop());

  it('runs focasWorker.ts and answers with the error of the library', async () => {
    await expect(thread.initialize('/no/such/folder/libfwlib32.so')).rejects.toThrow('Failed to initialize FOCAS library');
    expect(thread.isLoaded()).toBe(false);
  });

  it('answers the cleanup of the shutdown', async () => {
    await thread.initialize('/no/such/folder/libfwlib32.so').catch(() => undefined);
    await expect(thread.cleanup(true)).resolves.toBeUndefined();
  });
});
