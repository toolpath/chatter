import { EventEmitter } from 'events';
import { Writable } from 'stream';
import { FTPClient } from '../ftp/FTPClient.js';
import type {
  BaseMachineConfig,
  BaseMachineStatus,
  MachineType,
  MachineDataSnapshot,
  MacroConfig,
  FTPTreeNode,
  FTPUploadResult,
} from '../types/index.js';

/** The FTP username when none is set */
export const DEFAULT_FTP_USER = 'anonymous';

const DEFAULT_FTP_PORT = 21;
const DEFAULT_TIMEOUT_MS = 5000;

/** The text of an error, for a message to the user */
export function errorMessage(error: unknown, fallback = 'Unknown error'): string {
  return error instanceof Error ? error.message : fallback;
}

/** The snapshot fields that each connector fills in itself */
type SnapshotFields = Omit<MachineDataSnapshot, 'timestamp' | 'machineId' | 'machineType' | 'connected' | 'custom'>;
type SnapshotCustomData = NonNullable<MachineDataSnapshot['custom']>;

/**
 * Abstract base class for CNC machine connectors.
 * Provides common functionality for connection management, polling, and FTP operations.
 */
export abstract class BaseMachineConnector extends EventEmitter {
  public id: string;
  public name: string;
  public host: string;
  public ftpPort: number;
  public ftpUser: string;
  public ftpPassword: string;
  public connected: boolean;

  protected timeout: number;
  protected ftpClient: FTPClient;
  protected errors: string[];
  protected lastPollTime: string | null;

  abstract readonly type: MachineType;

  constructor(config: BaseMachineConfig) {
    super();

    this.id = config.id || `machine_${Date.now()}`;
    this.name = config.name || 'CNC Machine';
    this.host = config.host;
    this.ftpPort = config.ftpPort || DEFAULT_FTP_PORT;
    this.ftpUser = config.ftpUser || DEFAULT_FTP_USER;
    this.ftpPassword = config.ftpPassword || '';
    this.timeout = config.timeout || DEFAULT_TIMEOUT_MS;

    this.ftpClient = new FTPClient({
      host: this.host,
      port: this.ftpPort,
      user: this.ftpUser,
      password: this.ftpPassword
    });

    this.connected = false;
    this.errors = [];
    this.lastPollTime = null;
  }

  abstract connect(): Promise<void>;

  abstract disconnect(): void;

  /** Read the current values of the machine */
  abstract poll(): Promise<BaseMachineStatus>;

  abstract getStatus(): BaseMachineStatus;

  /** True when the connection is still alive */
  abstract checkConnection(): boolean;

  /**
   * Get a standardized snapshot of machine data for time-series storage.
   * Normalizes machine-specific data to a common format.
   */
  abstract getDataSnapshot(): MachineDataSnapshot;

  protected addError(message: string): void {
    this.errors.push(message);
  }

  protected clearErrors(): void {
    this.errors = [];
  }

  protected updatePollTime(): void {
    this.lastPollTime = new Date().toISOString();
  }

  // ============================================
  // Common Polling Helpers
  // ============================================

  /** Emit a 'data' event with each value that changed since the previous poll */
  protected emitDataChanges(
    prevData: Record<string, unknown>,
    currentData: Record<string, unknown>
  ): void {
    const changes = Object.entries(currentData)
      .filter(([key, value]) => prevData[key] !== value)
      .map(([label, value]) => ({ label, value }));

    if (changes.length > 0) {
      this.emit('data', changes);
    }
  }

  /**
   * Connect when not connected yet.
   * @returns true if connected, false if connection failed
   */
  protected async ensureConnected(): Promise<boolean> {
    if (this.connected) {
      return true;
    }

    try {
      await this.connect();
      return true;
    } catch (err) {
      this.addError(`Unable to connect: ${errorMessage(err)}`);
      return false;
    }
  }

  protected addPollError(error: unknown): void {
    this.addError(`Poll failed: ${errorMessage(error)}`);
  }

  /** Record a failed poll and disconnect, so that the next poll connects again */
  protected handlePollError(error: unknown): void {
    this.addPollError(error);
    this.disconnect();
  }

  /** The label of a macro value: its name, or "macro_<location>" */
  protected formatMacroLabel(location: number, name?: string): string {
    return name || `macro_${location}`;
  }

  /** The values of the configured macros that the machine gave, by label */
  protected macroValues(macros: MacroConfig[], data: Record<string, unknown>): Record<string, number> {
    const values: Record<string, number> = {};
    for (const macro of macros) {
      const label = this.formatMacroLabel(macro.location, macro.name);
      if (data[label] !== undefined) {
        values[label] = data[label] as number;
      }
    }
    return values;
  }

  /** A snapshot with the identity of the machine, the given fields, and the custom data when there is any */
  protected buildSnapshot(fields: SnapshotFields, custom: SnapshotCustomData): MachineDataSnapshot {
    return {
      timestamp: this.lastPollTime || new Date().toISOString(),
      machineId: this.id,
      machineType: this.type,
      connected: this.connected,
      ...fields,
      custom: Object.keys(custom).length > 0 ? custom : undefined,
    };
  }

  // ============================================
  // FTP Operations (shared by all connectors)
  // ============================================

  async listFiles(path = '/'): Promise<FTPTreeNode[]> {
    const files = await this.ftpClient.listFiles(path);
    return files.map(f => ({ ...f, children: undefined }));
  }

  async getFileTree(path = '/', depth = 2): Promise<FTPTreeNode[]> {
    return this.ftpClient.getFileTree(path, depth);
  }

  async downloadFile(filePath: string, writableStream: Writable): Promise<void> {
    return this.ftpClient.downloadFile(filePath, writableStream);
  }

  async uploadFile(
    remotePath: string,
    source: Buffer | string | NodeJS.ReadableStream,
    allowOverwrite = false
  ): Promise<void> {
    return this.ftpClient.uploadFile(remotePath, source, allowOverwrite);
  }

  async uploadFiles(
    files: Array<{ remotePath: string; source: Buffer | string }>,
    allowOverwrite = false
  ): Promise<FTPUploadResult> {
    return this.ftpClient.uploadFiles(files, allowOverwrite);
  }

  async deleteFile(remotePath: string): Promise<void> {
    return this.ftpClient.deleteFile(remotePath);
  }

  /** True when a password is saved. The status gives only this, so the password never leaves the server. */
  get hasFtpPassword(): boolean {
    return this.ftpPassword !== '';
  }

  /** Change the FTP settings that are set in `config`. The FTP client uses them from the next transfer. */
  updateFTPConfig(config: {
    host?: string;
    ftpPort?: number;
    ftpUser?: string;
    ftpPassword?: string;
  }): void {
    if (config.host !== undefined) this.host = config.host;
    if (config.ftpPort !== undefined) this.ftpPort = config.ftpPort;
    if (config.ftpUser !== undefined) this.ftpUser = config.ftpUser || DEFAULT_FTP_USER;
    if (config.ftpPassword !== undefined) this.ftpPassword = config.ftpPassword;

    this.ftpClient.updateConfig({
      host: this.host,
      port: this.ftpPort,
      user: this.ftpUser,
      password: this.ftpPassword,
    });
  }
}
