import net from 'net';
import { Readable, Writable } from 'stream';
import * as ftp from 'basic-ftp';
import { ftpErrorMessage } from './ftpErrorMessage.js';
import type { FTPConfig, FTPFileInfo, FTPTreeNode, FTPUploadFile, FTPUploadResult } from '../types/index.js';

const DEFAULT_FTP_PORT = 21;
const DEFAULT_FTP_USER = 'anonymous';
const DEFAULT_TREE_DEPTH = 2;
const ROOT_PATH = '/';

/** The manual download gives up when no byte arrives in this time */
const DOWNLOAD_NO_DATA_TIMEOUT_MS = 30_000;
/** The raw LIST does not wait for the server to close the data connection, so it waits this long for the listing */
const RAW_LIST_TRANSFER_WAIT_MS = 1_000;

/** "227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)": four address bytes, then the port as two bytes */
const PASV_REPLY_PATTERN = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/;
const BYTE_SIZE = 256;

const ALREADY_EXISTS_MARKER = 'already exists';

const UNIX_ENTRY_FIELD_COUNT = 9;
const UNIX_SIZE_FIELD = 4;
const UNIX_NAME_FIRST_FIELD = 8;
const DOS_ENTRY_FIELD_COUNT = 4;
const DOS_SIZE_FIELD = 2;
const DOS_NAME_FIRST_FIELD = 3;

export interface RawListEntry {
  name: string;
  isDir: boolean;
  size: number;
}

type BatchFileOutcome = FTPUploadResult['success'][number] | FTPUploadResult['failed'][number];

interface PassiveAddress {
  host: string;
  port: number;
}

/**
 * Split a remote file path into its folder and its file name, so that an
 * existence check lists the right folder (not the root).
 */
export function parseFilePath(filePath: string): { dirPath: string; fileName: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash < 0) {
    return { dirPath: ROOT_PATH, fileName: filePath };
  }
  return {
    dirPath: '/' + filePath.substring(0, lastSlash),
    fileName: filePath.substring(lastSlash + 1)
  };
}

/**
 * Parse raw FTP LIST output into file entries.
 * Handles Unix, DOS, and plain file name formats:
 *   Unix:      drwxr-xr-x  2 user group 4096 Jan  1 12:00 filename
 *   DOS dir:   01-01-24  12:00PM  <DIR>  foldername
 *   DOS file:  01-01-24  12:00PM  12345  filename.txt
 *   Plain:     filename
 */
export function parseRawList(rawListing: string): RawListEntry[] {
  return rawListing
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(parseRawListLine)
    .filter((entry): entry is RawListEntry => entry !== undefined && isRealEntry(entry.name));
}

function parseRawListLine(line: string): RawListEntry | undefined {
  if (line.includes('<DIR>')) return parseDosDirectoryLine(line);
  if (/^\d{2}-\d{2}-\d{2}/.test(line)) return parseDosFileLine(line);
  if (/^[d\-lrwxs]/.test(line)) return parseUnixLine(line);
  return plainFileEntry(line);
}

function parseDosDirectoryLine(line: string): RawListEntry | undefined {
  const match = line.match(/<DIR>\s+(.+)$/);
  return match ? { name: match[1].trim(), isDir: true, size: 0 } : undefined;
}

function parseDosFileLine(line: string): RawListEntry | undefined {
  const fields = line.split(/\s+/);
  if (fields.length < DOS_ENTRY_FIELD_COUNT) return undefined;
  return {
    name: fields.slice(DOS_NAME_FIRST_FIELD).join(' '),
    isDir: false,
    size: parseInt(fields[DOS_SIZE_FIELD]) || 0
  };
}

function parseUnixLine(line: string): RawListEntry {
  const fields = line.split(/\s+/);
  // A plain file name can start with one of the Unix mode letters, so too few fields means a plain name
  if (fields.length < UNIX_ENTRY_FIELD_COUNT) return plainFileEntry(line);
  return {
    name: fields.slice(UNIX_NAME_FIRST_FIELD).join(' '),
    isDir: line.startsWith('d'),
    size: parseInt(fields[UNIX_SIZE_FIELD]) || 0
  };
}

function plainFileEntry(line: string): RawListEntry {
  return { name: line, isDir: false, size: 0 };
}

function isRealEntry(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..';
}

/** basic-ftp wants paths without a leading "./" or "/" */
function toRelativeRemotePath(remotePath: string): string {
  if (remotePath.startsWith('./')) return remotePath.substring(2);
  if (remotePath.startsWith('/')) return remotePath.substring(1);
  return remotePath;
}

function joinRemotePath(dirPath: string, name: string): string {
  return dirPath === ROOT_PATH ? `/${name}` : `${dirPath}/${name}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

function alreadyExistsMessage(remotePath: string): string {
  return `File "${remotePath}" ${ALREADY_EXISTS_MARKER}. Enable overwrite to replace it.`;
}

async function toBuffer(source: Buffer | string | NodeJS.ReadableStream): Promise<Buffer> {
  if (Buffer.isBuffer(source)) return source;
  if (typeof source === 'string') return Buffer.from(source);
  const chunks: Buffer[] = [];
  for await (const chunk of source) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

/** Binary mode stops line ending changes. Some machine FTP servers reject TYPE I, so the transfer is tried anyway. */
async function trySetBinaryMode(client: ftp.Client): Promise<void> {
  try {
    await client.send('TYPE I');
  } catch {
    // The server does not support TYPE I; continue in its default mode
  }
}

async function requestPassiveAddress(client: ftp.Client): Promise<PassiveAddress> {
  const reply = await client.send('PASV');
  const match = reply.message.match(PASV_REPLY_PATTERN);
  if (!match) {
    throw new Error('Could not parse PASV response');
  }
  const [, h1, h2, h3, h4, portHigh, portLow] = match;
  return {
    host: `${h1}.${h2}.${h3}.${h4}`,
    port: parseInt(portHigh) * BYTE_SIZE + parseInt(portLow)
  };
}

/**
 * Reusable FTP client for CNC machine file operations.
 * Handles file listing, tree browsing, downloads, uploads, and deletes.
 * Compatible with limited FTP servers (like Speedio) via manual PASV mode.
 */
export class FTPClient {
  private host: string;
  private port: number;
  private user: string;
  private password: string;

  constructor({ host, port = DEFAULT_FTP_PORT, user = DEFAULT_FTP_USER, password = '' }: FTPConfig) {
    this.host = host;
    this.port = port;
    this.user = user;
    this.password = password;
  }

  /** Change connection settings (for example after a machine config change) */
  updateConfig({ host, port, user, password }: Partial<FTPConfig>): void {
    if (host !== undefined) this.host = host;
    if (port !== undefined) this.port = port;
    if (user !== undefined) this.user = user;
    if (password !== undefined) this.password = password;
  }

  async listFiles(path = ROOT_PATH): Promise<FTPFileInfo[]> {
    try {
      const list = await this.withConnection({ verbose: false }, client => client.list(path));
      return list.map(item => ({
        name: item.name,
        type: item.isDirectory ? 'directory' : 'file',
        size: item.size,
        modifiedAt: item.modifiedAt,
        path: joinRemotePath(path, item.name)
      }));
    } catch (err) {
      throw new Error(ftpErrorMessage(err, this.host, this.port));
    }
  }

  async getFileTree(path = ROOT_PATH, depth = DEFAULT_TREE_DEPTH): Promise<FTPTreeNode[]> {
    if (depth <= 0) {
      return [];
    }
    try {
      return await this.withConnection({ verbose: false }, client => this.buildTree(client, path, depth));
    } catch (err) {
      throw new Error(ftpErrorMessage(err, this.host, this.port));
    }
  }

  async downloadFile(filePath: string, writableStream: Writable): Promise<void> {
    const remotePath = toRelativeRemotePath(filePath);
    try {
      await this.withConnection({ verbose: true }, async client => {
        try {
          await this.downloadOverPassiveSocket(client, remotePath, writableStream);
        } catch {
          // Fall back to basic-ftp's standard download
          await client.downloadTo(writableStream, remotePath);
        }
      });
    } catch (err) {
      throw new Error(`FTP download error: ${errorText(err)}`);
    }
  }

  async uploadFile(
    remotePath: string,
    source: Buffer | string | NodeJS.ReadableStream,
    allowOverwrite = false
  ): Promise<void> {
    const relativePath = toRelativeRemotePath(remotePath);
    const content = await toBuffer(source);

    try {
      await this.withConnection({ verbose: true }, async client => {
        if (!allowOverwrite && await this.fileExists(client, relativePath)) {
          throw new Error(alreadyExistsMessage(relativePath));
        }
        await trySetBinaryMode(client);
        await client.uploadFrom(Readable.from(content), relativePath);
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes(ALREADY_EXISTS_MARKER)) {
        throw err;
      }
      throw new Error(`FTP upload error: ${errorText(err)}`);
    }
  }

  /** Upload several files over one connection. Each file passes or fails on its own. */
  async uploadFiles(files: FTPUploadFile[], allowOverwrite = false): Promise<FTPUploadResult> {
    const results: FTPUploadResult = { success: [], failed: [] };

    try {
      await this.withConnection({ verbose: true }, async client => {
        await trySetBinaryMode(client);
        for (const file of files) {
          const outcome = await this.uploadBatchFile(client, { file, allowOverwrite });
          if ('error' in outcome) results.failed.push(outcome);
          else results.success.push(outcome);
        }
      });
    } catch (err) {
      throw new Error(`FTP connection error: ${errorText(err)}`);
    }

    return results;
  }

  async deleteFile(remotePath: string): Promise<void> {
    const relativePath = toRelativeRemotePath(remotePath);
    try {
      await this.withConnection({ verbose: true }, client => client.remove(relativePath));
    } catch (err) {
      throw new Error(`FTP delete error: ${errorText(err)}`);
    }
  }

  /** Open a connection, run `work` on it, and always close it */
  private async withConnection<T>(
    { verbose }: { verbose: boolean },
    work: (client: ftp.Client) => Promise<T>
  ): Promise<T> {
    const client = new ftp.Client();
    client.ftp.verbose = verbose;
    try {
      await client.access({
        host: this.host,
        port: this.port,
        user: this.user,
        password: this.password,
        secure: false
      });
      return await work(client);
    } finally {
      client.close();
    }
  }

  /** Upload one file of an uploadFiles batch. A failure is returned, not thrown, so the batch goes on. */
  private async uploadBatchFile(
    client: ftp.Client,
    { file, allowOverwrite }: { file: FTPUploadFile; allowOverwrite: boolean }
  ): Promise<BatchFileOutcome> {
    const remotePath = toRelativeRemotePath(file.remotePath);
    try {
      if (!allowOverwrite && await this.fileExists(client, remotePath)) {
        return { remotePath, error: alreadyExistsMessage(remotePath) };
      }
      await client.uploadFrom(Readable.from(await toBuffer(file.source)), remotePath);
      return { remotePath };
    } catch (err) {
      return { remotePath, error: errorText(err) };
    }
  }

  private async fileExists(client: ftp.Client, filePath: string): Promise<boolean> {
    const { dirPath, fileName } = parseFilePath(filePath);
    try {
      const list = await client.list(dirPath);
      return list.some(item => item.name === fileName);
    } catch {
      // The folder cannot be listed (for example it does not exist yet), so the file is not there
      return false;
    }
  }

  /**
   * Download with raw FTP commands over our own data socket: open the data
   * connection first, then send RETR. More compatible with limited FTP servers like Speedio.
   */
  private async downloadOverPassiveSocket(client: ftp.Client, filePath: string, destination: Writable): Promise<void> {
    await trySetBinaryMode(client);
    const { host, port } = await requestPassiveAddress(client);

    return new Promise((resolve, reject) => {
      const dataSocket = new net.Socket();
      let bytesReceived = 0;

      dataSocket.on('data', chunk => {
        bytesReceived += chunk.length;
        destination.write(chunk);
      });
      dataSocket.on('close', () => resolve());
      dataSocket.on('error', reject);

      dataSocket.connect(port, host, () => {
        // Written straight to the control socket without waiting for the reply, so data can flow on the data socket
        client.ftp.socket.write(`RETR ${filePath}\r\n`);
      });

      setTimeout(() => {
        if (bytesReceived === 0) {
          dataSocket.destroy();
          reject(new Error('Download timeout'));
        }
      }, DOWNLOAD_NO_DATA_TIMEOUT_MS);
    });
  }

  /**
   * Send a bare LIST over our own data socket and return the raw listing.
   * basic-ftp sends "LIST -a", which some limited FTP servers do not support.
   */
  private async rawListCurrentDirectory(client: ftp.Client): Promise<string> {
    const { host, port } = await requestPassiveAddress(client);

    return new Promise((resolve, reject) => {
      const dataSocket = new net.Socket();
      let listing = '';

      dataSocket.on('data', chunk => {
        listing += chunk.toString();
      });
      dataSocket.on('error', reject);

      dataSocket.connect(port, host, async () => {
        try {
          await client.send('LIST');
          setTimeout(() => {
            dataSocket.end();
            resolve(listing);
          }, RAW_LIST_TRANSFER_WAIT_MS);
        } catch (err) {
          dataSocket.end();
          reject(err);
        }
      });
    });
  }

  /** List the current folder: bare LIST first, then basic-ftp's list. An empty list when both fail. */
  private async listCurrentDirectory(client: ftp.Client): Promise<RawListEntry[]> {
    try {
      return parseRawList(await this.rawListCurrentDirectory(client));
    } catch {
      try {
        const list = await client.list();
        return list.map(item => ({ name: item.name, isDir: item.isDirectory, size: item.size }));
      } catch {
        return [];
      }
    }
  }

  /**
   * Build the tree below `path`, `depth` levels deep. A folder that cannot be
   * opened gives an empty list, so one bad folder does not hide the rest of the tree.
   */
  private async buildTree(client: ftp.Client, path: string, depth: number): Promise<FTPTreeNode[]> {
    if (depth <= 0) {
      return [];
    }
    try {
      await client.cd(path);
      await client.pwd();
      const entries = await this.listCurrentDirectory(client);

      const nodes: FTPTreeNode[] = [];
      for (const entry of entries) {
        nodes.push(await this.treeNodeFor(client, { entry, parentPath: path, depth }));
      }
      return nodes;
    } catch {
      return [];
    }
  }

  private async treeNodeFor(
    client: ftp.Client,
    { entry, parentPath, depth }: { entry: RawListEntry; parentPath: string; depth: number }
  ): Promise<FTPTreeNode> {
    const fullPath = joinRemotePath(parentPath, entry.name);
    const node: FTPTreeNode = {
      name: entry.name,
      type: entry.isDir ? 'directory' : 'file',
      size: entry.size || 0,
      path: fullPath
    };
    if (entry.isDir && depth > 1) {
      node.children = await this.buildTree(client, fullPath, depth - 1);
    }
    return node;
  }
}
