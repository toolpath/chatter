import { createWriteStream, promises as fs } from 'fs';
import net from 'net';
import path from 'path';
import { pipeline } from 'stream/promises';
import { ipv4Of } from './network.js';

/**
 * A small FTP server for the fake machines, so the ChatterBox Files tab has files to show.
 * It knows only the commands that ChatterBox (through basic-ftp) sends.
 * It takes any username and password, and keeps every file inside its root folder.
 * Use it only on this computer: it has no TLS (encryption) and no real login.
 */

type Reply = (code: number, text: string) => void;

/** How long the server waits for the client to open the data connection */
const DATA_CONNECTION_TIMEOUT_MS = 10_000;

/** One FTP login: its folder, and the data connection that PASV or EPSV opened */
class FtpSession {
  private folder = '/';
  private renameFrom: string | null = null;
  private dataListener: net.Server | null = null;
  private dataSocket: Promise<net.Socket> | null = null;

  constructor(
    private readonly root: string,
    private readonly host: string,
    private readonly reply: Reply,
    private readonly hangUp: () => void,
  ) {}

  /** Close the data port and connection that no transfer used */
  closeData(): void {
    this.dataListener?.close();
    this.dataListener = null;
    this.dataSocket?.then(socket => socket.destroy(), () => {});
    this.dataSocket = null;
  }

  async handle(line: string): Promise<void> {
    const space = line.indexOf(' ');
    const command = (space === -1 ? line : line.slice(0, space)).toUpperCase();
    const argument = space === -1 ? '' : line.slice(space + 1).trim();
    const handler = this.handlers[command];
    if (!handler) return this.reply(502, `${command} is not supported`);
    try {
      await handler(argument);
    } catch (error) {
      // Never send the path on this computer back to the client
      this.reply(550, isMissing(error) ? 'No such file or folder' : 'The command failed');
    }
  }

  private readonly handlers: Record<string, (argument: string) => Promise<void> | void> = {
    USER: () => this.reply(331, 'Send any password'),
    PASS: () => this.reply(230, 'Logged in'),
    SYST: () => this.reply(215, 'UNIX Type: L8'),
    FEAT: () => this.reply(211, 'No extra features'),
    OPTS: () => this.reply(200, 'OK'),
    TYPE: () => this.reply(200, 'OK'),
    STRU: () => this.reply(200, 'OK'),
    MODE: () => this.reply(200, 'OK'),
    NOOP: () => this.reply(200, 'OK'),
    PWD: () => this.reply(257, `"${this.folder}"`),
    CWD: argument => this.changeFolder(argument),
    CDUP: () => this.changeFolder('..'),
    PASV: () => this.openDataPort(port => this.reply(227, `Entering Passive Mode (${this.host.replaceAll('.', ',')},${port >> 8},${port & 255})`)),
    EPSV: () => this.openDataPort(port => this.reply(229, `Entering Extended Passive Mode (|||${port}|)`)),
    LIST: argument => this.sendList(argument),
    NLST: argument => this.sendList(argument, true),
    RETR: argument => this.sendFile(argument),
    STOR: argument => this.receiveFile(argument),
    DELE: async argument => { await fs.unlink(this.realPath(argument)); this.reply(250, 'Deleted'); },
    MKD: async argument => { await fs.mkdir(this.realPath(argument)); this.reply(257, `"${this.virtualPath(argument)}" made`); },
    RMD: async argument => { await fs.rmdir(this.realPath(argument)); this.reply(250, 'Removed'); },
    SIZE: async argument => this.reply(213, String((await fs.stat(this.realPath(argument))).size)),
    MDTM: async argument => this.reply(213, ftpTime((await fs.stat(this.realPath(argument))).mtime)),
    RNFR: async argument => { await fs.stat(this.realPath(argument)); this.renameFrom = argument; this.reply(350, 'Send RNTO'); },
    RNTO: argument => this.rename(argument),
    QUIT: () => { this.reply(221, 'Goodbye'); this.hangUp(); },
  };

  /** The path the client sees, made absolute from the current folder */
  private virtualPath(argument: string): string {
    return path.posix.resolve(this.folder, argument || '.');
  }

  /** The path on this computer. `resolve` removes every "..", so the path cannot leave the root. */
  private realPath(argument: string): string {
    return path.join(this.root, this.virtualPath(argument));
  }

  private async changeFolder(argument: string): Promise<void> {
    const target = this.virtualPath(argument);
    if (!(await fs.stat(this.realPath(argument))).isDirectory()) throw new Error('Not a folder');
    this.folder = target;
    this.reply(250, `Folder is now ${target}`);
  }

  private async rename(argument: string): Promise<void> {
    if (!this.renameFrom) return this.reply(503, 'Send RNFR first');
    await fs.rename(this.realPath(this.renameFrom), this.realPath(argument));
    this.renameFrom = null;
    this.reply(250, 'Renamed');
  }

  /** Open a port for one data connection, and tell the client the port */
  private openDataPort(tellPort: (port: number) => void): void {
    this.closeData();
    const listener = net.createServer();
    this.dataListener = listener;
    this.dataSocket = new Promise((resolve, reject) => {
      const giveUp = (error: Error) => {
        listener.close();
        reject(error);
      };
      const timer = setTimeout(() => giveUp(new Error('No data connection')), DATA_CONNECTION_TIMEOUT_MS);
      timer.unref();
      listener.once('connection', socket => {
        clearTimeout(timer);
        listener.close();
        // A client can reset the connection before the transfer starts. That must not crash the process.
        socket.on('error', () => socket.destroy());
        resolve(socket);
      });
      listener.once('error', error => {
        clearTimeout(timer);
        giveUp(error);
      });
    });
    // Without a transfer, the waiting promise must not crash the process
    this.dataSocket.catch(() => {});
    listener.listen(0, this.host, () => tellPort((listener.address() as net.AddressInfo).port));
  }

  /** Run one transfer over the data connection, with the 150 and 226 replies around it */
  private async transfer(work: (socket: net.Socket) => Promise<void>): Promise<void> {
    const waiting = this.dataSocket;
    this.dataSocket = null;
    this.dataListener = null;
    if (!waiting) return this.reply(425, 'Send PASV or EPSV first');
    this.reply(150, 'Opening data connection');
    const socket = await waiting.catch(() => null);
    if (!socket) return this.reply(425, 'The data connection did not open');
    try {
      await work(socket);
      this.reply(226, 'Transfer complete');
    } finally {
      socket.destroy();
    }
  }

  private async sendList(argument: string, namesOnly = false): Promise<void> {
    // Clients often send flags such as "-a". The fake server ignores them.
    const target = argument.startsWith('-') ? '' : argument;
    const folder = this.realPath(target);
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const lines = await Promise.all(entries.map(async entry => {
      if (namesOnly) return entry.name;
      const stats = await fs.stat(path.join(folder, entry.name));
      return listLine(entry.name, stats.isDirectory(), stats.size, stats.mtime);
    }));
    await this.transfer(socket => endWith(socket, lines.map(line => `${line}\r\n`).join('')));
  }

  private async sendFile(argument: string): Promise<void> {
    const content = await fs.readFile(this.realPath(argument));
    await this.transfer(socket => endWith(socket, content));
  }

  private async receiveFile(argument: string): Promise<void> {
    const target = this.realPath(argument);
    await this.transfer(socket => pipeline(socket, createWriteStream(target)));
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Write the data, then close the connection. That tells the client the transfer is done. */
function endWith(socket: net.Socket, data: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.end(data, () => resolve());
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One line of a Unix "ls -l" list, the form most FTP clients read */
export function listLine(name: string, isFolder: boolean, size: number, modified: Date): string {
  const mode = isFolder ? 'drwxr-xr-x' : '-rw-r--r--';
  const day = String(modified.getDate()).padStart(2, ' ');
  const time = `${String(modified.getHours()).padStart(2, '0')}:${String(modified.getMinutes()).padStart(2, '0')}`;
  return `${mode} 1 cnc cnc ${String(size).padStart(8, ' ')} ${MONTHS[modified.getMonth()]} ${day} ${time} ${name}`;
}

/** The MDTM time form: YYYYMMDDhhmmss in UTC */
function ftpTime(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** Start an FTP server that serves the files in `root`, listening on `host` */
export function startFtpServer(root: string, host: string, port: number): net.Server {
  const server = net.createServer(socket => {
    const reply: Reply = (code, text) => {
      if (!socket.destroyed) socket.write(`${code} ${text}\r\n`);
    };
    // PASV tells the client to connect back to the address it used for this connection
    const session = new FtpSession(root, ipv4Of(socket.localAddress ?? host), reply, () => socket.end());
    let buffer = '';
    // One command at a time, in the order the client sent them
    let queue = Promise.resolve();
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines.filter(Boolean)) queue = queue.then(() => session.handle(line));
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => session.closeData());
    reply(220, 'Fake machine FTP server ready');
  });
  server.listen(port, host);
  return server;
}
