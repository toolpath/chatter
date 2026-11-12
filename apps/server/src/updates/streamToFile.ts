import { createWriteStream } from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { wholeSeconds } from './timeLimits.js';

/** Open a file only when it is not there yet, so a write never replaces a file */
const CREATE_NEW_FILE_ONLY = 'wx';

/** The stream gave more bytes than the limit */
export class FileTooLargeError extends Error {}

/** The stream gave no bytes for too long */
export class StreamIdleError extends Error {}

export interface StreamLimits {
  /** The largest size of the file */
  maxBytes: number;
  /** The longest time with no bytes. A sender that went quiet must not hold the one upload place for ever. */
  idleMs: number;
}

/**
 * Write a stream to a new file, piece by piece, so a large file never sits in memory.
 * Fails when the file is already there, when the stream gives more than maxBytes,
 * or when no bytes come in for idleMs. On a failure the stream is cancelled, and the caller deletes the file.
 * Gives the size of the file.
 */
export async function streamToFile(body: ReadableStream<Uint8Array>, file: string, limits: StreamLimits): Promise<number> {
  const idleTimer = new IdleTimer(limits.idleMs);
  let writtenBytes = 0;
  const countAndLimitBytes = new Transform({
    transform(piece: Buffer, _encoding, done) {
      idleTimer.restart();
      writtenBytes += piece.length;
      if (writtenBytes > limits.maxBytes) done(new FileTooLargeError(`The file is larger than ${limits.maxBytes} bytes`));
      else done(null, piece);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(body as WebReadableStream<Uint8Array>),
      countAndLimitBytes,
      createWriteStream(file, { flags: CREATE_NEW_FILE_ONLY }),
      { signal: idleTimer.signal },
    );
  } catch (error) {
    // The abort makes pipeline throw a general AbortError. The reason tells the Admin what really happened.
    throw idleTimer.signal.aborted ? idleTimer.signal.reason : error;
  } finally {
    idleTimer.stop();
  }
  return writtenBytes;
}

/** Aborts its signal when restart() is not called for idleMs */
class IdleTimer {
  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly idleMs: number) {
    this.restart();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  restart(): void {
    this.stop();
    this.timer = setTimeout(() => this.controller.abort(this.idleError()), this.idleMs);
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private idleError(): StreamIdleError {
    return new StreamIdleError(`no bytes came in for ${wholeSeconds(this.idleMs)} seconds`);
  }
}
