import {
  closeSync, constants, createWriteStream, mkdirSync, openSync, renameSync, statSync, writeSync, type WriteStream,
} from 'node:fs';
import path from 'node:path';

/** The size of one log file. With the old file, the log takes at most 2 MB on the card. */
const LOG_FILE_BYTES = 1024 * 1024;
/** Lines that wait for the card. When the card is too slow, more lines are dropped, so the memory stays low. */
const MAX_PENDING_BYTES = 256 * 1024;

/**
 * The server log in a file in the data volume, so the lines survive a restart of Chatter or of the Pi.
 * When the file is full, it becomes `<name>.1` (the old one is deleted), and a new file starts.
 * A file that cannot be written does not stop the server: the log goes on in the console and in memory.
 */
export class LogFile {
  private stream: WriteStream | null = null;
  private size = 0;
  private droppedLines = 0;
  private isBroken = false;
  private isClosed = false;
  /** The old files that still get their last lines */
  private readonly endings = new Set<Promise<void>>();

  constructor(readonly filePath: string, private readonly maxBytes = LOG_FILE_BYTES) {}

  /** The old file first, then the current file */
  get filePaths(): string[] {
    return [`${this.filePath}.1`, this.filePath];
  }

  write(text: string): void {
    if (this.isBroken) return;
    // A request that ends while Chatter stops. A new stream would not end before the exit, so the line is written at once.
    if (this.isClosed) {
      appendToExistingLog(this.filePath, text);
      return;
    }
    const line = `${text}\n`;
    const bytes = Buffer.byteLength(line);
    const stream = this.openStream();
    if (!stream) return;
    if (stream.writableLength > MAX_PENDING_BYTES) {
      this.droppedLines++;
      return;
    }
    const target = this.size > 0 && this.size + bytes > this.maxBytes ? this.rotate() : stream;
    // A rotate that failed stopped the file
    if (!target) return;
    const marker = this.takeDroppedMarker();
    target.write(marker + line);
    this.size += Buffer.byteLength(marker) + bytes;
  }

  /** Ends the file, with the number of lines dropped since the last line. The promise ends when each line is on the card. */
  async close(): Promise<void> {
    this.isClosed = true;
    const stream = this.stream;
    this.stream = null;
    if (stream) {
      const marker = this.takeDroppedMarker();
      if (marker) stream.write(marker);
      this.end(stream);
    }
    await Promise.all(this.endings);
  }

  /** The line that tells how many lines were dropped since the last written line, or '' when none were dropped */
  private takeDroppedMarker(): string {
    const marker = this.droppedLines > 0 ? `[${this.droppedLines} lines dropped: the card was too slow]\n` : '';
    this.droppedLines = 0;
    return marker;
  }

  private end(stream: WriteStream): void {
    const ending = new Promise<void>(resolve => stream.end(resolve)).then(() => {
      this.endings.delete(ending);
    });
    this.endings.add(ending);
  }

  private openStream(): WriteStream | null {
    if (this.stream) return this.stream;
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.size = fileSize(this.filePath);
      // Opened at once (not later, as createWriteStream does), so a rotate always finds the file
      const stream = createWriteStream('', { fd: openSync(this.filePath, 'a', 0o600) });
      stream.on('error', error => this.stop(error));
      this.stream = stream;
      return stream;
    } catch (error) {
      this.stop(error);
      return null;
    }
  }

  /**
   * The open file keeps its lines under the old name. Node writes them before it closes the file.
   * Gives the new file, or null when the rotate failed and the file stopped.
   */
  private rotate(): WriteStream | null {
    const old = this.stream;
    this.stream = null;
    try {
      renameSync(this.filePath, `${this.filePath}.1`);
    } catch (error) {
      if (old) this.end(old);
      this.stop(error);
      return null;
    }
    if (old) this.end(old);
    this.size = 0;
    return this.openStream();
  }

  private stop(error: unknown): void {
    if (this.isBroken) return;
    this.isBroken = true;
    this.stream = null;
    // Not with the logger: its lines come back here
    process.stderr.write(`The log file ${this.filePath} cannot be written, so the log is not kept in a file: ${String(error)}\n`);
  }
}

function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Adds one line to the log file of the server, from a second process such as `npm run reset-password`.
 * Gives false, and writes nothing, when the file does not exist or cannot be written.
 *
 * It never makes the file or its folder. A person can run the command outside Docker with sudo. A file that root made
 * has mode 0600, and the server, which does not run as root, could not write its log any more.
 * It never rotates the file either. The server counts the size of its file by itself, so a rotate here could make the
 * server write into the old file, and its next rotate would delete lines. The line makes the file only a little longer
 * than its limit, until the next rotate of the server.
 */
export function appendToExistingLog(filePath: string, text: string): boolean {
  let fd: number;
  try {
    // No O_CREAT, so a missing file stays missing
    fd = openSync(filePath, constants.O_WRONLY | constants.O_APPEND);
  } catch {
    return false;
  }
  try {
    writeSync(fd, `${text}\n`);
    return true;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}
