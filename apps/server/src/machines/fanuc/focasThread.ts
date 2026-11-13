import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';
import { Focas, type FocasAlarm, type FocasMacro, type FocasOperatorMessage, type FocasProgram, type FocasSpindleSpeed, type FocasStatus } from './focas.js';
import type { FocasLoader } from './focasLibraryInstaller.js';
import type { FocasCommand, FocasRead, FocasRequest, FocasResponse } from './focasRequests.js';
import { FocasError, isBusy } from './focasError.js';
import { createLogger } from '../../logging/logger.js';

const log = createLogger('fanuc');

/** How many more times a read tries when the control is busy (EW_BUSY), and how long it waits before each try */
const BUSY_RETRIES = 2;
const BUSY_RETRY_DELAY_MS = 50;

/** The parts of a Worker that FocasThread uses, so tests can give their own */
export interface FocasWorkerPort {
  postMessage(request: FocasRequest): void;
  on(event: 'message', listener: (response: FocasResponse) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (exitCode: number) => void): unknown;
  terminate(): Promise<number>;
  unref(): void;
}

/**
 * Start focasWorker.js, or focasWorker.ts when the server runs from source (npm run dev, or the tests).
 * The TypeScript worker registers tsx itself: the tsx of the server's thread does not reach a worker.
 */
function startFocasWorker(): FocasWorkerPort {
  const extension = path.extname(fileURLToPath(import.meta.url));
  const file = new URL(`./focasWorker${extension}`, import.meta.url);
  if (extension !== '.ts') return new Worker(file) as unknown as FocasWorkerPort;

  const tsx = createRequire(import.meta.url).resolve('tsx/esm/api');
  const code = `require(${JSON.stringify(tsx)}).register(); import(${JSON.stringify(file.href)});`;
  return new Worker(code, { eval: true }) as unknown as FocasWorkerPort;
}

interface Waiting {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** What a FocasThread asks of the threads around it (FocasThreads) */
export interface FocasThreadOwner {
  /** Load the library on the thread. Only one thread starts the Linux FOCAS process. */
  load(thread: FocasThread, libraryPath: string): Promise<void>;
  /** The thread lost its library, because it failed or stopped */
  unloaded(thread: FocasThread): void;
  /** stop() ended the thread */
  stopped(thread: FocasThread): void;
}

/** A thread on its own starts the Linux FOCAS process each time it loads the library */
const OWN_PROCESS: FocasThreadOwner = {
  load: (thread, libraryPath) => thread.loadLibrary(libraryPath, true),
  unloaded: () => undefined,
  stopped: () => undefined,
};

/**
 * Runs the FOCAS library on a thread of its own (focasWorker.ts), and gives each call as a promise.
 * The cnc_* calls block until the control answers, for up to the connection timeout.
 * On the server's thread, that stopped every other machine, the web app and the live events.
 * Each FANUC machine gets its own FocasThread (see FocasThreads), so a slow control holds up only its own machine.
 * The thread starts at the first call. When it stops, it starts again at the next call, with no connections.
 */
export class FocasThread {
  private worker: FocasWorkerPort | null = null;
  /** Counts the started threads, so a connection of a stopped thread is never used on the next one */
  private generation = 0;
  private nextId = 1;
  private readonly waiting = new Map<number, Waiting>();
  private loading: Promise<void> | null = null;
  private loaded = false;

  constructor(
    private readonly startWorker: () => FocasWorkerPort = startFocasWorker,
    private readonly owner: FocasThreadOwner = OWN_PROCESS,
  ) {}

  /** True when this thread has loaded the library */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** Load the library on this thread. Rejects when it does not load. */
  initialize(libraryPath?: string): Promise<void> {
    this.loading ??= Promise.resolve()
      .then(() => this.owner.load(this, libraryPath ?? Focas.libraryPath()))
      .then(() => { this.loaded = true; })
      .finally(() => { this.loading = null; });
    return this.loading;
  }

  /** @internal Used by the owner: load the library, and start the Linux FOCAS process when it says so */
  loadLibrary(libraryPath: string, startProcess: boolean): Promise<void> {
    return this.send({ kind: 'initialize', libraryPath, startProcess }).then(() => undefined);
  }

  /** Connect to a control. Loads the library first, when it is not loaded yet. */
  async connect(host: string, port: number, timeoutSeconds: number): Promise<FocasSession> {
    if (!this.loaded) await this.initialize();
    const generation = this.generation;
    const session = await this.send({ kind: 'connect', host, port, timeoutSeconds }) as number;
    return new FocasSession(this, session, generation);
  }

  /** Stop the thread, for example when its machine is removed. Its connections end with it. */
  async stop(): Promise<void> {
    const worker = this.worker;
    if (worker) this.forgetWorker(new Error('The FOCAS thread stopped'));
    this.owner.stopped(this);
    await worker?.terminate();
  }

  /** @internal Used by FocasSession */
  sendFor(generation: number, command: FocasCommand): Promise<unknown> {
    if (generation !== this.generation || !this.worker) {
      return Promise.reject(new Error('The FOCAS thread stopped, so the connection is gone'));
    }
    return this.send(command);
  }

  private send(command: FocasCommand): Promise<unknown> {
    const worker = this.runningWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      worker.postMessage({ ...command, id });
    });
  }

  private runningWorker(): FocasWorkerPort {
    if (this.worker) return this.worker;

    const worker = this.startWorker();
    this.worker = worker;
    this.generation++;
    // The thread must not keep the server running when everything else has stopped
    worker.unref();
    worker.on('message', response => this.answer(response));
    worker.on('error', error => {
      log.error('The FOCAS thread failed', { error });
      if (this.worker === worker) this.forgetWorker(error);
    });
    worker.on('exit', exitCode => {
      if (this.worker === worker) this.forgetWorker(new Error(`The FOCAS thread stopped (exit code ${exitCode})`));
    });
    return worker;
  }

  private answer(response: FocasResponse): void {
    const waiting = this.waiting.get(response.id);
    if (!waiting) return;
    this.waiting.delete(response.id);
    if (response.ok) waiting.resolve(response.value);
    else waiting.reject(response.code === undefined ? new Error(response.message) : new FocasError(response.message, response.code));
  }

  /** The library and every connection went with the thread */
  private forgetWorker(reason: Error): void {
    this.worker = null;
    this.loaded = false;
    for (const waiting of this.waiting.values()) waiting.reject(reason);
    this.waiting.clear();
    this.owner.unloaded(this);
  }
}

/** One connection to a control. Each read runs on the FOCAS thread that made the connection. */
export class FocasSession {
  constructor(
    private readonly thread: FocasThread,
    private readonly session: number,
    private readonly generation: number,
  ) {}

  disconnect(): Promise<void> {
    return this.thread.sendFor(this.generation, { kind: 'disconnect', session: this.session }).then(() => undefined);
  }

  readStatus(): Promise<FocasStatus> {
    return this.read('readStatus') as Promise<FocasStatus>;
  }

  readSpindleSpeed(): Promise<FocasSpindleSpeed> {
    return this.read('readSpindleSpeed') as Promise<FocasSpindleSpeed>;
  }

  /** The load of the first spindle in percent, or undefined when the control reads no spindle */
  readSpindleLoad(): Promise<number | undefined> {
    return this.read('readSpindleLoad') as Promise<number | undefined>;
  }

  readMacro(macroNumber: number): Promise<FocasMacro> {
    return this.read('readMacro', macroNumber) as Promise<FocasMacro>;
  }

  readProgram(): Promise<FocasProgram> {
    return this.read('readProgram') as Promise<FocasProgram>;
  }

  readAlarms(): Promise<FocasAlarm[]> {
    return this.read('readAlarms') as Promise<FocasAlarm[]>;
  }

  readOperatorMessages(): Promise<FocasOperatorMessage[]> {
    return this.read('readOperatorMessages') as Promise<FocasOperatorMessage[]>;
  }

  /** A control that is busy (EW_BUSY) gets a few more tries, a moment apart */
  private async read(read: FocasRead, ...args: number[]): Promise<unknown> {
    for (let retry = 0; ; retry++) {
      try {
        return await this.thread.sendFor(this.generation, { kind: 'read', session: this.session, read, args });
      } catch (error) {
        if (!isBusy(error) || retry >= BUSY_RETRIES) throw error;
        await new Promise(resolve => setTimeout(resolve, BUSY_RETRY_DELAY_MS));
      }
    }
  }
}

/**
 * The FOCAS threads of the server: one for each FANUC machine, so a control that is slow to answer
 * (for example one that is off, with a 10 second connect timeout) never holds up the other machines.
 *
 * Each thread loads the library for itself, and each connection stays on the thread that made it.
 * On Linux, cnc_startupprocess is for the whole server, not for one thread, so only the first thread
 * that loads the library calls it. When no thread has the library any more, the next one calls it again.
 */
export class FocasThreads implements FocasLoader {
  private readonly threads = new Set<FocasThread>();
  /** The threads that have the library */
  private readonly loadedThreads = new Set<FocasThread>();
  /** The load that starts the Linux FOCAS process, while it runs */
  private starting: Promise<void> | null = null;
  /** The thread that loaded the library for initialize(), kept for the next machine */
  private spare: FocasThread | null = null;

  constructor(private readonly startWorker: () => FocasWorkerPort = startFocasWorker) {}

  uploadPath(): string {
    return Focas.uploadPath();
  }

  libraryPath(): string {
    return Focas.libraryPath();
  }

  /** True when a FOCAS thread has loaded the library */
  isLoaded(): boolean {
    return this.loadedThreads.size > 0;
  }

  /** Load the library, to see that it loads. The thread that loads it goes to the next machine that asks for one. */
  initialize(libraryPath?: string): Promise<void> {
    this.spare ??= this.newThread();
    return this.spare.initialize(libraryPath);
  }

  /** A thread for one machine. It starts at its first call. Stop it when the machine is removed. */
  thread(): FocasThread {
    const thread = this.spare ?? this.newThread();
    this.spare = null;
    return thread;
  }

  /** Stop every thread, for example when the server shuts down */
  async stop(): Promise<void> {
    await Promise.all([...this.threads].map(thread => thread.stop()));
  }

  private newThread(): FocasThread {
    const thread = new FocasThread(this.startWorker, {
      load: (loading, libraryPath) => this.load(loading, libraryPath),
      unloaded: unloaded => { this.loadedThreads.delete(unloaded); },
      stopped: stopped => {
        this.threads.delete(stopped);
        this.loadedThreads.delete(stopped);
        if (this.spare === stopped) this.spare = null;
      },
    });
    this.threads.add(thread);
    return thread;
  }

  /** The first thread starts the Linux FOCAS process. The others wait for it, and then only load the library. */
  private async load(thread: FocasThread, libraryPath: string): Promise<void> {
    while (this.starting && this.loadedThreads.size === 0) {
      await this.starting.catch(() => undefined);
    }
    const startProcess = this.loadedThreads.size === 0;
    const loading = thread.loadLibrary(libraryPath, startProcess).then(() => { this.loadedThreads.add(thread); });
    if (!startProcess) return loading;

    this.starting = loading;
    try {
      await loading;
    } finally {
      if (this.starting === loading) this.starting = null;
    }
  }
}

/** The FOCAS threads of the server */
export const focasThreads = new FocasThreads();
