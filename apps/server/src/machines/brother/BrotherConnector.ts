import net from 'net';
import { BaseMachineConnector } from '../BaseMachineConnector.js';
import { PollTimingRecorder } from '../pollTimings.js';
import { tuneMachineSocket } from '../machineSocket.js';
import { createLogger } from '../../logging/logger.js';
import { ReplyTooLargeError, warnReplyTooLarge } from '../replyLimit.js';
import { TOOL_SYNC_TIMEOUT_MS, ToolSyncTracker } from './toolSync.js';
import {
  ATC_COMMANDS,
  DATA_ITEMS,
  brotherCommand,
  isKnownAtcReply,
  machineValuesOf,
  macroDataItem,
  parseResponse,
  potToolsOf,
  stateCommandsOf,
  toolOffsetsOf,
  toolTableOf,
  type AtcCommand,
  type ControlType,
  type ToolOffsets,
} from './brotherProtocol.js';
import type {
  BrotherMachineConfig,
  BrotherMachineStatus,
  BrotherMachineData,
  ToolTable,
  DataItem,
  ParsedResponse,
  MachineType,
  MacroConfig,
  MachineDataSnapshot,
  ToolSyncOutcome,
} from '../../types/index.js';

const log = createLogger('brother');

const DEFAULT_DATA_PORT = 10000;

/**
 * The largest reply that Chatter reads. The largest reply of a real Speedio (C00) is the tool data, about 13 KB.
 * A reply with no closing % must stop, because a Pi can have 512 MB of RAM.
 */
export const MAX_BROTHER_REPLY_BYTES = 1024 * 1024;

/**
 * Chatter closes the data connection on purpose and opens it again every 60 seconds, at the start of a poll.
 * This renews the session on the control, and limits how long a bad state of that session can last.
 * A Brother serves one client at a time, so the close is an orderly close (FIN), and the control frees its
 * client slot before the new connect. It does not help with a half-open session on the control after the Pi
 * lost power: TCP keepalive and the timeout of the control cover that.
 */
export const BROTHER_RECONNECT_MS = 60_000;

/** The time that an orderly close can take before Chatter destroys the socket */
const ORDERLY_CLOSE_MS = 2000;
const DEFAULT_UNIT = 'in';

/**
 * The error when the machine accepts the TCP connection but does not answer a command.
 * A Brother control serves one client at a time. It accepts a second connection, but it does not answer on it.
 */
export const NO_REPLY_ERROR =
  'The machine accepts the connection, but it does not answer. Possibly another program is connected to it. ' +
  'A Brother control serves only one program at a time. Stop the other program. If you cannot find it, turn the control off and on again.';

/** A command got no reply in time. The connection is not usable after this. */
class NoReplyError extends Error {
  constructor() {
    super(NO_REPLY_ERROR);
  }
}

/** A command or a connect waits no more when its socket closes, for example when the poll ran out of time */
const CLOSED_BEFORE_REPLY_ERROR = 'The connection closed before the machine answered';
const CLOSED_BEFORE_OPEN_ERROR = 'The connection closed before it opened';

/** What a Sync request of a Brother gives: each outcome of a Sync, except the ones of the poller */
export type ToolSyncResult = Exclude<ToolSyncOutcome, { outcome: 'not-supported' | 'not-found' }>;

/** The address changed during a tool read. The reply came from the old control, so Chatter does not keep it. */
class OldAddressError extends Error {
  constructor() {
    super('The address changed during the tool read');
  }
}

/**
 * Connector for Brother CNC machines (CNC-C00 and D00 controls). It uses one raw TCP connection to the data port of
 * the control (10000). Each request and each reply is an LOD frame between % signs (see brotherProtocol.ts).
 */
export class BrotherConnector extends BaseMachineConnector {
  readonly type: MachineType = 'brother';

  public dataPort: number;
  public defaultUnit: string;
  public macros: MacroConfig[];

  private socket: net.Socket | null = null;
  /** When connect() opened the connection */
  private connectedAt: number | null = null;
  private data: BrotherMachineData = {};
  private prevData: BrotherMachineData = {};
  private toolTable: ToolTable = {};
  /** The tool in each pot, from the last ATC reply */
  private potTools: Record<number, number> = {};
  /** The offsets and the name of each tool, from the last tool data reply */
  private toolOffsets = new Map<number, ToolOffsets>();
  private hasPocketInfo = false;
  private controlType: ControlType | null = null;
  private atcCommand: AtcCommand | null = null;
  /**
   * The ATC commands that the control does not know (a reply status other than 00). This stays for the life of the
   * connector, also after a reconnect, so Chatter never sends a command that the control does not know again.
   */
  private unknownAtcCommands = new Set<AtcCommand>();
  /**
   * Each forgetControl() starts a new generation. A tool read keeps no result of an older generation: no tool table,
   * no ATC command, no error and no time of the read, because those are about the control at the old address.
   */
  private controlGeneration = 0;
  private toolDataCommand: string;
  private macroCommand: string;
  private dataItems: DataItem[];
  private readonly timings: PollTimingRecorder;
  private readonly toolSync = new ToolSyncTracker();
  /** The state poll that runs now, so a tool read waits for it. One operation at a time uses the connection. */
  private runningPoll: Promise<boolean> | null = null;
  /**
   * True during the planned reconnect, from the orderly close until the new connect ends. The status says connected
   * then, because Chatter closed the connection on purpose. If the new connect fails, the machine shows offline.
   */
  private reconnecting = false;
  /**
   * Counts the calls of disconnect(), so the planned reconnect opens no new connection after a disconnect or a removal
   * during its orderly close, and a tool read does not start after a disconnect during its wait for the poll (for
   * example after its time limit). The orderly close itself does not count.
   */
  private disconnects = 0;

  constructor(config: BrotherMachineConfig) {
    super(config);

    this.id = config.id || `brother_${Date.now()}`;
    this.name = config.name || 'Brother CNC';
    this.dataPort = config.dataPort || DEFAULT_DATA_PORT;
    this.defaultUnit = (config.defaultUnit || DEFAULT_UNIT).toLowerCase();
    this.macros = config.macros || [];

    // The tool data and macro commands end with I for inch values or M for metric values
    const unitLetter = this.defaultUnit === 'in' ? 'I' : 'M';
    this.toolDataCommand = `TOLN${unitLetter}1`;
    this.macroCommand = `MCRN${unitLetter}1`;

    this.dataItems = this.buildDataItems();
    this.timings = new PollTimingRecorder(this.id);
  }

  /** The standard data items, then one item for each configured macro */
  private buildDataItems(): DataItem[] {
    const macroItems = this.macros.map(macro =>
      macroDataItem(this.formatMacroLabel(macro.location, macro.name), this.macroCommand, macro.location));
    return [...DATA_ITEMS, ...macroItems];
  }

  updateMacros(macros: MacroConfig[]): void {
    this.macros = macros;
    this.dataItems = this.buildDataItems();
  }

  /**
   * Open the connection. A failed connect only rejects: ensureConnected writes the one reason,
   * "Unable to connect: <reason>".
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) this.socket.destroy();

      const socket = new net.Socket();
      this.socket = socket;
      // The same time limit is for the connect and, in sendCommand, for each reply
      socket.setTimeout(this.timeout);
      tuneMachineSocket(socket);

      // Only for the connect. After it, a timeout means that a command got no reply (see sendCommand).
      const onConnectTimeout = () => {
        this.connected = false;
        socket.destroy();
        reject(new Error('Connection timeout'));
      };
      socket.on('timeout', onConnectTimeout);

      // Only for the connect. After it, onSocketError has the errors.
      const onConnectError = (err: Error) => {
        this.connected = false;
        reject(err);
      };
      socket.on('error', onConnectError);

      // A destroyed socket gives only 'close'. Without this, a disconnect during the connect leaves it waiting forever.
      socket.on('close', () => {
        if (this.socket === socket) this.connected = false;
        reject(new Error(CLOSED_BEFORE_OPEN_ERROR));
      });

      socket.connect(this.dataPort, this.host, () => {
        socket.removeListener('timeout', onConnectTimeout);
        socket.removeListener('error', onConnectError);
        socket.on('error', (err: Error) => this.onSocketError(socket, err));
        this.connected = true;
        this.connectedAt = Date.now();
        this.clearErrors();
        resolve();
      });
    });
  }

  /**
   * An error of the open connection. When a command waits for its reply, sendCommand rejects with the error, and the
   * poll or the tool read writes the reason. So this writes the reason only between two commands.
   */
  private onSocketError(socket: net.Socket, err: Error): void {
    this.connected = false;
    // sendCommand adds its own error listener while its command waits
    const commandWaits = socket.listenerCount('error') > 1;
    if (!commandWaits) this.addError(`Socket error: ${err.message}`);
  }

  /**
   * Close the connection with a FIN, and wait until the control closes its side too, for at most ORDERLY_CLOSE_MS.
   * Then the control has freed its one client slot for the next connect.
   */
  private async closeInOrder(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    if (!socket) return;
    // The listeners of connect() would report an error of the closing socket as an error of the machine
    socket.removeAllListeners('error');
    socket.on('error', () => socket.destroy());
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => socket.destroy(), ORDERLY_CLOSE_MS);
      socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.end();
    });
  }

  disconnect(): void {
    this.disconnects++;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.reconnecting = false;
  }

  /**
   * Send a command and wait for the reply between % signs.
   * With no reply in time, it disconnects: a late reply would come as the reply of the next command.
   * A reply longer than MAX_BROTHER_REPLY_BYTES disconnects too.
   * It also ends when the socket closes, because a destroyed socket gives no 'data', 'error' or 'timeout' after it.
   */
  async sendCommand(command: string): Promise<ParsedResponse> {
    const socket = this.socket;
    if (!socket || !this.connected || socket.destroyed || !socket.writable) throw new Error('Not connected');

    return new Promise((resolve, reject) => {
      let reply = '';
      /** The place of the opening %, or -1 before it came */
      let start = -1;

      // Each chunk is searched once, so a long reply in many chunks does not take more and more time
      const onData = (chunk: Buffer) => {
        const searchFrom = reply.length;
        // latin1 gives one character for each byte. 'ascii' clears the high bit, so 0xA5 would read as % and 0x8A as \n.
        reply += chunk.toString('latin1');
        if (start === -1) start = reply.indexOf('%', searchFrom);
        const end = start === -1 ? -1 : reply.indexOf('%', Math.max(start + 1, searchFrom));
        if (end !== -1) {
          cleanup();
          resolve(parseResponse(reply.slice(start + 1, end)));
        } else if (reply.length > MAX_BROTHER_REPLY_BYTES) {
          cleanup();
          this.disconnect();
          reject(warnReplyTooLarge(log, this.id, new ReplyTooLargeError(MAX_BROTHER_REPLY_BYTES)));
        }
      };

      const onError = (err: Error) => { cleanup(); reject(err); };
      const onClose = () => { cleanup(); reject(new Error(CLOSED_BEFORE_REPLY_ERROR)); };
      const onTimeout = () => {
        cleanup();
        this.disconnect();
        reject(new NoReplyError());
      };

      const cleanup = () => {
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('timeout', onTimeout);
        socket.removeListener('close', onClose);
      };

      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('timeout', onTimeout);
      socket.on('close', onClose);
      socket.write(brotherCommand(command), 'ascii');
    });
  }

  /** True when Chatter found the ATC command, or found that the control knows neither command */
  private get atcDetectionDone(): boolean {
    return this.atcCommand !== null || ATC_COMMANDS.every(({ command }) => this.unknownAtcCommands.has(command));
  }

  /**
   * Find which ATC command this control knows, and give its reply, which is the first tool table. With neither,
   * the tool table has no pots, and the reply is null. Only the reply status decides. An error from a send (no
   * reply, or a closed connection) tells nothing about the control: the tool read fails, and the next one asks
   * again. Chatter does not ask a command again when the control did not know it: an unknown command adds a CM
   * entry to its alarm list.
   */
  private async detectControlType(generation: number): Promise<ParsedResponse | null> {
    for (const { command, controlType } of ATC_COMMANDS) {
      if (this.unknownAtcCommands.has(command)) continue;
      const response = await this.sendForToolRead(command, generation);
      if (isKnownAtcReply(response)) {
        this.atcCommand = command;
        this.controlType = controlType;
        return response;
      }
      this.unknownAtcCommands.add(command);
    }
    return null;
  }

  /**
   * Forget what Chatter found about the control: the ATC command, the control type and the tool table. Chatter reads
   * the tools again only when a user presses Sync. Use it when the address changes, because a different control can
   * be there.
   */
  forgetControl(): void {
    this.controlGeneration++;
    this.atcCommand = null;
    this.controlType = null;
    this.unknownAtcCommands.clear();
    this.potTools = {};
    this.toolOffsets = new Map();
    this.toolTable = {};
    this.hasPocketInfo = false;
    this.toolSync.forgetLastRead();
  }

  /**
   * Read the machine state. While a tool read runs, the poll does not use the connection: it gives the last values,
   * and is a good poll. A poll never starts a tool read: only a Sync does (see toolSync.ts).
   */
  async poll(): Promise<BrotherMachineStatus> {
    if (this.toolSync.running) return this.getStatus();
    this.clearErrors();
    this.timings.startPoll();
    const run = this.pollMachine();
    this.runningPoll = run;
    let good = false;
    // A poll that the scheduler left behind is no longer the current poll. It can end after a newer poll, so its run
    // state is old: it must not clear the promise of the newer poll, or change the run state that a Sync checks.
    let current: boolean;
    try {
      good = await run;
    } finally {
      current = this.runningPoll === run;
      if (current) this.runningPoll = null;
      this.timings.endPoll(this.pollTimeLimitMs);
      // A failed poll tells nothing about the run state, so a Sync is refused after it, as when a program runs
      if (current) this.toolSync.polled(good ? this.data.execution : null);
    }
    return this.getStatus();
  }

  /**
   * A user pressed Sync: read the tools now, but only when the last poll said READY (no program runs). During the
   * planned reconnect, the read waits for the poll that reconnects. If that connect fails, the read fails with the
   * reason.
   */
  async requestToolSync(): Promise<ToolSyncResult> {
    const refusal = this.toolSync.manualRefusal(Date.now());
    if (refusal) return refusal;
    if (!this.connected && !this.reconnecting) return { outcome: 'not-connected' };
    if (!this.toolSync.lastPollReady) return { outcome: 'program-running' };
    this.toolSync.started(Date.now());
    return this.syncTools();
  }

  /**
   * Read the tools after the state poll that runs now, in TOOL_SYNC_TIMEOUT_MS at most. The time limit includes the
   * wait for that poll, so a poll that does not end cannot keep the tool read, and with it each later poll, waiting.
   * After the wait, the read starts only when that poll said READY too. Otherwise it gives 'program-running'.
   */
  private async syncTools(): Promise<ToolSyncResult> {
    const generation = this.controlGeneration;
    const disconnects = this.disconnects;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Ends the command that waits, and the next poll connects again
        this.disconnect();
        reject(new Error(`The tool read did not end in ${TOOL_SYNC_TIMEOUT_MS / 1000} seconds`));
      }, TOOL_SYNC_TIMEOUT_MS);
    });
    let error: string | null = null;
    let programRuns = false;
    try {
      const read = (async () => {
        await this.runningPoll?.catch(() => {});
        // A disconnect during the wait: the time limit ended (then a later poll can have connected again, and the
        // read must not use that connection), the machine was removed, or the poll lost the connection. Also the
        // poll before the read can have lost the connection, for example when a reconnect failed. The read fails
        // with the reason of that poll. The planned reconnect is not a disconnect, so a Sync can wait for it.
        if (disconnects !== this.disconnects || !this.connected) throw new Error(this.errors.at(-1) ?? 'Not connected');
        // The poll that the read waited for can have found that a program runs now. Then no tool command goes out.
        if (!this.toolSync.lastPollReady) {
          programRuns = true;
          return;
        }
        await this.readTools(generation);
      })();
      await Promise.race([read, timeout]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    if (generation !== this.controlGeneration) {
      this.toolSync.abandoned();
      log.debug('Tool read of the old address ignored', { machine: this.id });
      return { outcome: 'address-changed' };
    }
    if (programRuns && error === null) {
      // Not a read and not a failure: the state of the last read stays, and the user can press Sync again
      this.toolSync.abandoned();
      log.debug('Tool read not started, because a program runs', { machine: this.id });
      return { outcome: 'program-running' };
    }
    this.toolSync.ended(Date.now(), error);
    log.debug('Tool read', { machine: this.id, error: error ?? undefined });
    return { outcome: error === null ? 'synced' : 'failed', toolSync: this.toolSync.state() };
  }

  /** Read the tool table and the tool data. The first time, find the control type: its reply is also the tool table. */
  private async readTools(generation: number): Promise<void> {
    const atcResponse = this.atcCommand
      ? await this.sendForToolRead(this.atcCommand, generation)
      : this.atcDetectionDone ? null : await this.detectControlType(generation);
    if (atcResponse && this.atcCommand) this.potTools = potToolsOf(atcResponse);
    const toolDataResponse = await this.sendForToolRead(this.toolDataCommand, generation);
    this.toolOffsets = toolOffsetsOf(toolDataResponse);
    // With no ATC command, the table has no pots
    this.toolTable = toolTableOf(this.potTools, this.toolOffsets);
    this.hasPocketInfo = Object.keys(this.toolTable).length > 0;
  }

  /** Connect when needed, read the machine, and keep the values. True when the poll read the machine. */
  private async pollMachine(): Promise<boolean> {
    // With an open connection and no planned reconnect, the first command goes out at once, with no await before it
    if (this.mustConnect()) {
      if (!(await this.connectForPoll())) return false;
    }

    this.prevData = { ...this.data };

    const responses = await this.readMachine();
    if (!responses) return false;

    Object.assign(this.data, machineValuesOf(responses, this.dataItems));

    this.updatePollTime();
    this.emitDataChanges(this.prevData, this.data);
    return true;
  }

  /**
   * Connect, or make the planned reconnect when it is time. False when the connect fails. Call it only when
   * mustConnect() is true. It runs at the start of a poll, so no command waits for a reply during the planned reconnect.
   */
  private async connectForPoll(): Promise<boolean> {
    if (!this.plannedReconnectDue()) return this.ensureConnected();

    const disconnects = this.disconnects;
    this.reconnecting = true;
    try {
      await this.closeInOrder();
      if (disconnects !== this.disconnects) {
        // Chatter disconnected or removed the machine during the orderly close. After a removal, no poll and no
        // disconnect comes again, so a new connection would hold the one client slot of the control.
        this.addError(`Unable to connect: ${CLOSED_BEFORE_OPEN_ERROR}`);
        return false;
      }
      if (!(await this.ensureConnected())) return false;
    } finally {
      this.reconnecting = false;
    }
    this.timings.recordPlannedReconnect();
    log.debug('Planned reconnect', { machine: this.id });
    return true;
  }

  /** True when the connection is open and BROTHER_RECONNECT_MS old or more */
  private plannedReconnectDue(): boolean {
    return this.connected && this.connectedAt !== null && Date.now() - this.connectedAt >= BROTHER_RECONNECT_MS;
  }

  /** True when the poll must connect first: there is no connection, or the planned reconnect is due */
  private mustConnect(): boolean {
    return !this.socket || !this.connected || this.plannedReconnectDue();
  }

  /**
   * Send a command of a tool read. Throws OldAddressError when the address changed while it waited for the reply.
   * An address change disconnects, so a reply that has not come fails anyway. This check is for the two other cases:
   * the reply came before the address changed, but the read has not used it yet; or the poll that the read waited for
   * connected to the new address, so the reply is of the new control, but the read started for the old one.
   */
  private async sendForToolRead(command: string, generation: number): Promise<ParsedResponse> {
    const response = await this.send(command);
    if (generation !== this.controlGeneration) throw new OldAddressError();
    return response;
  }

  /** Send a command, and record how long the machine took to answer */
  private send(command: string): Promise<ParsedResponse> {
    return this.timings.time(command, () => this.sendCommand(command));
  }

  /** Send each command of the machine state once, and get the replies by command. Gives null when a command fails. */
  private async readMachine(): Promise<Record<string, ParsedResponse> | null> {
    try {
      const responses: Record<string, ParsedResponse> = {};
      for (const command of stateCommandsOf(this.dataItems)) {
        responses[command] = await this.send(command);
      }
      return responses;
    } catch (err) {
      if (err instanceof NoReplyError) {
        // The message tells the cause and the fix, so it needs no "Poll failed" in front. sendCommand disconnected.
        this.addError(err.message);
      } else {
        this.handlePollError(err);
      }
      return null;
    }
  }

  getStatus(): BrotherMachineStatus {
    const pollTimings = this.timings.snapshot();
    return {
      id: this.id,
      name: this.name,
      host: this.host,
      dataPort: this.dataPort,
      ftpPort: this.ftpPort,
      ftpUser: this.ftpUser,
      hasFtpPassword: this.hasFtpPassword,
      type: 'brother',
      // The planned reconnect is not a disconnect, so the screens and the connection log do not show it
      connected: this.connected || this.reconnecting,
      lastPollTime: this.lastPollTime,
      errors: this.errors,
      data: {
        ...this.data,
        toolTable: this.toolTable,
        hasPocketInfo: this.hasPocketInfo,
        controlType: this.controlType,
        toolSync: this.toolSync.state(),
      },
      macros: this.macros,
      // Only after the first poll, so the status has the same fields as the status of the other connectors until then
      ...(pollTimings ? { pollTimings } : {}),
    };
  }

  checkConnection(): boolean {
    if (!this.socket || !this.connected) return false;
    try { this.socket.write('\n'); return true; }
    catch { return false; }
  }

  getDataSnapshot(): MachineDataSnapshot {
    const custom: Record<string, object> = {};
    if (Object.keys(this.toolTable).length > 0) {
      custom.toolTable = this.toolTable;
    }

    return this.buildSnapshot({
      mode: this.data.mode,
      program: this.data.program,
      spindleSpeed: this.data.spindleSpeed,
      toolNumber: this.data.toolNumber,
      partCount: this.data.partCount,
      partGoal: this.data.partGoal,
      alarm: this.data.alarm,
      alarmCode: this.data.alarmCode,
      // Empty when the control sent a status that Chatter does not know
      execution: this.data.execution || undefined,
    }, { ...custom, ...this.macroValues(this.macros, this.data) });
  }
}
