/**
 * Test support for the Brother connector: replies of a real control, one fake Brother on a TCP port, and one fake
 * connection with no socket. Like a real control, each fake answers a command that it does not know with status 08.
 */
import net from 'net';
import { vi } from 'vitest';
import { BrotherConnector } from './BrotherConnector.js';
import { parseResponse } from './brotherProtocol.js';
import type { BrotherMachineConfig, ParsedResponse } from '../../types/index.js';

/**
 * Replies of a Brother control to each command, matching the Python test fixtures
 */
export const MOCK_RESPONSES: Record<string, string> = {
  'PANEL': 'RLOD    PANEL   00\r\nD01,0,0,0\r\nK01,0,5,0,0,0,0,0,0,0,1,0\r\nS01,4,100,100,1,0,1,1\r\n\r\n10%',
  'MEM': "RLOD    MEM     00\r\nA01,'/       ',1001,0,0,0,0,0\r\n\r\n00%",
  'WKCNTR': 'RLOD    WKCNTR  00\r\nA01,  1,    78,   200,     0\r\nA02,  0,     0,     0,     0\r\n\r\n08%',
  'PDSP': "RLOD    PDSP    00\r\nX01,    0.000 ,     0,0,10,10,10,0,0,0,0,4,100,100, 0,0, 0\r\n\r\n03%",
  'ALARM': "RLOD    ALARM   00\r\nE01,0975320032,          ,          \r\n\r\n10%",
  'ATCTL': 'RLOD    ATCTL   00\r\nM02,  1,0,0\r\nM03,  2,0,0\r\n\r\n00%',
  'TOLNI1': "RLOD    TOLNI1  00\r\nT01, 1.5000, 0.0000, 0.2500, 0.0000, 0, 0, 0, 0, 'ENDMILL '\r\n\r\n00%"
};

/** The reply of a real control to a command that it does not know: status 08 and no values */
export function unknownCommandReply(command: string): string {
  return `RLOD    ${command.padEnd(8)}08\r\n01%`;
}

/** The real reply of a Speedio X500 (C00) to ATCTLD: status 08, a command that it does not know */
export const UNKNOWN_ATCTLD = 'RLOD    ATCTLD  08\r\n02%';
export const UNKNOWN_ATCTL = 'RLOD    ATCTL   08\r\n01%';
/** The ATC reply of a D00 control */
export const D00_ATCTLD = MOCK_RESPONSES.ATCTL.replace('ATCTL ', 'ATCTLD');

/** A MEM reply while a program runs (operation status 1) */
export const MEM_RUNNING = "RLOD    MEM     00\r\nA01,'/       ',1001,1,0,0,0,0\r\n\r\n00%";
/** A MEM reply in a feed hold (operation status 2), for example after the operator opened the door */
export const MEM_FEED_HOLD = "RLOD    MEM     00\r\nA01,'/       ',1001,2,0,0,0,0\r\n\r\n00%";
/** A MEM reply of an older control, with no operation status */
export const MEM_NO_RUN_STATE = "RLOD    MEM     00\r\nA01,'/       ',1001\r\n\r\n00%";

/** The text of the error of a command whose connection closed before the reply */
const CLOSED_BEFORE_REPLY = 'The connection closed before the machine answered';

/** The reply of the fake to a command: its reply in `replies`, or status 08 */
function replyOf(replies: Record<string, string>, command: string): string {
  return replies[command] ?? unknownCommandReply(command);
}

/** The command in a request frame "%CLOD    <command>  ..." */
function commandOf(request: string): string {
  return /CLOD\s+(\S+)/.exec(request)?.[1] ?? '';
}

export interface FakeBrotherOptions {
  /** The reply to each command. The fake uses this object, so a test can change it later. */
  replies?: Record<string, string>;
  /** Accept the FIN of Chatter and keep the side of the control open, so an orderly close waits its full time */
  allowHalfOpen?: boolean;
  /** Called with each command when it comes, before the fake chooses the reply. `connection` starts at 1. */
  onCommand?: (command: string, connection: number) => void;
  /** A promise that holds back the reply to a command until it resolves, or null to answer at once */
  hold?: (command: string, connection: number) => Promise<void> | null;
}

/** A fake Brother on a TCP port of this computer */
export interface FakeBrother {
  readonly port: number;
  readonly replies: Record<string, string>;
  /** Each command that the fake got, in order */
  readonly commands: string[];
  /** What the fake saw, in order: "connect 1", "end 1" (an orderly close from Chatter), "connect 2", ... */
  readonly events: string[];
  /** The side of the control of each connection, in order */
  readonly machineSides: net.Socket[];
  onCommand: NonNullable<FakeBrotherOptions['onCommand']>;
  hold: NonNullable<FakeBrotherOptions['hold']>;
  /** The control takes no new connection. The open connections stay. */
  stopListening(): void;
  /** End each connection and stop the server */
  close(): Promise<void>;
}

const openFakes = new Set<FakeBrother>();

/**
 * Start a fake Brother. Like a real control, it answers the commands of one connection one at a time, in order.
 * Call closeFakeBrothers() after each test.
 */
export async function startFakeBrother(options: FakeBrotherOptions = {}): Promise<FakeBrother> {
  const replies = options.replies ?? { ...MOCK_RESPONSES };
  const commands: string[] = [];
  const events: string[] = [];
  const machineSides: net.Socket[] = [];
  const server = net.createServer({ allowHalfOpen: options.allowHalfOpen ?? false }, socket => {
    machineSides.push(socket);
    const connection = machineSides.length;
    events.push(`connect ${connection}`);
    socket.on('end', () => events.push(`end ${connection}`));
    socket.on('error', () => {});
    let answered = Promise.resolve();
    socket.on('data', chunk => {
      const command = commandOf(chunk.toString('ascii'));
      commands.push(command);
      fake.onCommand(command, connection);
      const reply = '%' + replyOf(replies, command);
      answered = answered
        .then(() => fake.hold(command, connection) ?? undefined)
        .then(() => { if (!socket.destroyed) socket.write(reply); });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const fake: FakeBrother = {
    port: (server.address() as net.AddressInfo).port,
    replies,
    commands,
    events,
    machineSides,
    onCommand: options.onCommand ?? (() => {}),
    hold: options.hold ?? (() => null),
    stopListening: () => { server.close(); },
    close: async () => {
      openFakes.delete(fake);
      for (const socket of machineSides) socket.destroy();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
  openFakes.add(fake);
  return fake;
}

/** Close each fake Brother that a test started */
export async function closeFakeBrothers(): Promise<void> {
  await Promise.all([...openFakes].map(fake => fake.close()));
}

/** A port of this computer on which nothing listens */
export async function closedPort(): Promise<number> {
  const fake = await startFakeBrother();
  await fake.close();
  return fake.port;
}

interface HoldEntry {
  keepAfterClose: boolean;
  /** Called when the send of the command starts to wait, with the function that gives its reply */
  started: (give: (reply: Promise<string>) => void) => void;
}

/** A reply that a test holds back. The send of the command waits until the test answers it. */
export interface HeldReply {
  /** True when the connector sent the command, and it waits for the reply */
  readonly waiting: boolean;
  /** Give the usual reply of the command */
  release(): void;
  /** Give this reply */
  answer(reply: string): void;
}

/**
 * A connected Brother connector with a fake connection and no socket. Each command gets its reply in `replies`, or
 * status 08. When the connector connects, the fake connection opens again at once. When the connector closes it,
 * each command that waits fails, as on a real socket.
 */
export class FakeConnection {
  readonly connector: BrotherConnector;
  readonly replies: Record<string, string>;
  /** Each command that the connector sent, in order */
  readonly sent: string[] = [];
  /** How many times the connector connected again */
  connects = 0;
  /** Each reply moves the fake clock this much, for a test with a fake Date */
  msPerCommand = 0;
  private readonly held = new Map<string, HoldEntry[]>();
  private readonly failures = new Map<string, () => Error>();
  private readonly waiting = new Set<(error: Error) => void>();

  constructor(connector: BrotherConnector, replies: Record<string, string> = { ...MOCK_RESPONSES }) {
    this.connector = connector;
    this.replies = replies;
    this.open();
    vi.spyOn(connector, 'connect').mockImplementation(async () => {
      this.connects++;
      this.open();
    });
    vi.spyOn(connector, 'sendCommand').mockImplementation(command => this.answer(command));
  }

  /**
   * The next send of `command` waits until the test answers it. Two calls hold the next two sends. When Chatter
   * closes the connection, the send fails, as on a real socket. With `keepAfterClose`, it still waits, as a send that
   * is stuck where the close cannot reach it: so a test can end a poll after the connection closed.
   */
  hold(command: string, { keepAfterClose = false } = {}): HeldReply {
    let waiting = false;
    let give: (reply: Promise<string>) => void = () => {};
    const queue = this.held.get(command) ?? [];
    queue.push({ keepAfterClose, started: reply => { waiting = true; give = reply; } });
    this.held.set(command, queue);
    return {
      get waiting() { return waiting; },
      release: () => give(Promise.resolve(replyOf(this.replies, command))),
      answer: reply => give(Promise.resolve(reply)),
    };
  }

  /** The next send of `command` fails with this error. The default is "No reply for <command>". */
  fail(command: string, error: () => Error = () => new Error(`No reply for ${command}`)): void {
    this.failures.set(command, error);
  }

  /**
   * A good poll, so the last poll tells the run state, and a Sync can start when it is READY. A poll starts no tool
   * read. Then the list of sent commands is cleared.
   */
  async poll(): Promise<void> {
    await this.connector.poll();
    this.sent.length = 0;
  }

  /** The machine closed the connection: the connector sees it as closed, as after the close event of a socket */
  machineClosed(): void {
    Object.assign(this.connector, { connected: false });
  }

  private open(): void {
    Object.assign(this.connector, { socket: { destroy: () => this.closed() }, connected: true });
  }

  /** Chatter closed the connection: each command that waits fails */
  private closed(): void {
    for (const reject of this.waiting) reject(new Error(CLOSED_BEFORE_REPLY));
    this.waiting.clear();
  }

  private async answer(command: string): Promise<ParsedResponse> {
    this.sent.push(command);
    const failure = this.failures.get(command);
    if (failure) {
      this.failures.delete(command);
      throw failure();
    }
    const reply = await this.replyFor(command);
    if (this.msPerCommand > 0) vi.setSystemTime(Date.now() + this.msPerCommand);
    return parseResponse(reply);
  }

  private replyFor(command: string): Promise<string> {
    const holdNext = this.held.get(command)?.shift();
    if (!holdNext) return Promise.resolve(replyOf(this.replies, command));
    return new Promise<string>((resolve, reject) => {
      if (!holdNext.keepAfterClose) this.waiting.add(reject);
      holdNext.started(reply => {
        this.waiting.delete(reject);
        reply.then(resolve, reject);
      });
    });
  }
}

/** A connected Brother connector with a fake connection (see FakeConnection) */
export function connectedBrother(
  replies: Record<string, string> = { ...MOCK_RESPONSES },
  config: Partial<BrotherMachineConfig> = {},
): FakeConnection {
  return new FakeConnection(new BrotherConnector({ id: 'b1', name: 'Speedio', host: '127.0.0.1', ...config }), replies);
}
