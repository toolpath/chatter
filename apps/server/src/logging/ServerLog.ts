import path from 'node:path';
import { AUDIT_FILE_BYTES } from './audit.js';
import { addLogListener } from './logger.js';
import { DebugSwitch } from './DebugSwitch.js';
import { LogBuffer } from './LogBuffer.js';
import { LogFile } from './LogFile.js';

/**
 * The copies of the server log that Settings > Diagnostics shows: the last lines in memory,
 * the log file in the data volume (it survives a restart), and the debug switch.
 * Also the file of the audit log (audit.ts), which the support bundle gives to an Admin.
 */
export class ServerLog {
  readonly buffer: LogBuffer;
  /** The live log views that are open now (GET /logs/stream) */
  openStreams = 0;

  constructor(
    readonly file: LogFile | null = null,
    readonly debug = new DebugSwitch(),
    buffer = new LogBuffer(),
    readonly audit: LogFile | null = null,
  ) {
    this.buffer = buffer;
  }

  /**
   * The log of the server and the audit log, kept in `dataFolder`/logs. LOG_FILE=off keeps the server log only in memory,
   * and turns off the audit file, for example on a computer where the data folder is on a slow disk.
   */
  static forDataFolder(dataFolder: string, environment: NodeJS.ProcessEnv = process.env): ServerLog {
    if (environment.LOG_FILE?.trim().toLowerCase() === 'off') return new ServerLog();
    const folder = path.join(dataFolder, 'logs');
    return new ServerLog(new LogFile(path.join(folder, 'chatter.log')), undefined, undefined, new LogFile(path.join(folder, 'audit.log'), AUDIT_FILE_BYTES));
  }

  /** Ends the log file and the audit file. The promise ends when each line is on the card. */
  async close(): Promise<void> {
    await Promise.all([this.file?.close(), this.audit?.close()]);
  }

  /** The log files, the old one first. None when the log is kept only in memory. */
  get filePaths(): string[] {
    return this.file?.filePaths ?? [];
  }

  /** Keep each line that the server writes from now on. Returns a function that stops it. */
  listen(): () => void {
    return addLogListener(entry => {
      this.buffer.add(entry);
      this.file?.write(entry.text);
    });
  }
}
