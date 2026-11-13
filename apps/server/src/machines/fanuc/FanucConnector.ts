import { BaseMachineConnector, errorMessage } from '../BaseMachineConnector.js';
import { Focas } from './focas.js';
import { isConnectionLost } from './focasError.js';
import { focasThreads, type FocasSession, type FocasThread } from './focasThread.js';
import { createLogger } from '../../logging/logger.js';
import type {
  FanucMachineConfig,
  FanucMachineData,
  FanucMachineStatus,
  MachineType,
  MacroConfig,
  MachineDataSnapshot,
} from '../../types/index.js';

const DEFAULT_FOCAS_PORT = 8193;
const DEFAULT_FOCAS_TIMEOUT_SECONDS = 10;

const EMERGENCY_STOP_ALARM_CODE = 'E-STOP';
const EMERGENCY_STOP_ALARM_MESSAGE = 'Emergency Stop Active';
/** The status says there is an alarm, but the alarm list is empty or cannot be read */
const UNKNOWN_ALARM_CODE = 'ALARM';
const UNKNOWN_ALARM_MESSAGE = 'Alarm active (the control gave no details)';

/**
 * The reads of one poll stop after this time, so a connection that dies in the middle of a poll fails it
 * before the poll limit of the scheduler (10 seconds), instead of waiting out the timeout of each read
 */
const POLL_READS_DEADLINE_MS = 8000;

/** The Series 15 controls give cnc_statinfo another layout (ODBST), which Chatter does not read */
const SERIES_15 = '15';

const log = createLogger('fanuc');

/** What the control is, read once after each connect */
interface ControlInfo {
  /** The series, for example "31" or "0" */
  series?: string;
  /** M (mill), T (lathe), TT ... */
  type?: string;
  /** The number of paths. Chatter reads only path 1. */
  paths?: number;
}

/**
 * Connector for FANUC CNC machines via FOCAS2 protocol.
 * The FOCAS calls run on a FOCAS thread of this machine (focasThread.ts), so a slow control never stops
 * the server or the other machines.
 */
export class FanucConnector extends BaseMachineConnector {
  readonly type: MachineType = 'fanuc';

  public focasPort: number;
  public toolNumberVariable?: number;
  public partCounterVariable?: number;
  public ignoredMessageTypes: number[];
  public macros: MacroConfig[];

  private focas: FocasSession | null = null;
  /** The FOCAS thread of this machine. It starts at the first connect, and stops when the machine is removed. */
  private thread: FocasThread | null = null;
  /** Counts the disconnects, so a connect that ends after a disconnect does not keep its connection */
  private disconnects = 0;
  private data: FanucMachineData = {};
  private prevData: FanucMachineData = {};
  private connectionTimeoutSeconds: number;
  /** After this time (Date.now()), the reads of the poll that runs stop */
  private pollDeadline = Infinity;
  /** The optional reads that failed, each logged once until it works again */
  private readonly failingReads = new Set<string>();
  private controlInfo: ControlInfo = {};
  /** ODBST.tmmode of the last status read, as the control gives it */
  private tmMode: number | undefined;
  /** The last control information that was logged, so each control is logged once */
  private loggedControlInfo = '';

  constructor(config: FanucMachineConfig) {
    super({
      id: config.id,
      name: config.name || 'FANUC CNC',
      host: config.host,
      ftpPort: config.ftpPort,
      ftpUser: config.ftpUser,
      ftpPassword: config.ftpPassword,
      timeout: config.timeout,
    });

    this.id = config.id || `fanuc_${Date.now()}`;
    this.focasPort = config.focasPort || DEFAULT_FOCAS_PORT;
    this.toolNumberVariable = config.toolNumberVariable;
    this.partCounterVariable = config.partCounterVariable;
    this.ignoredMessageTypes = config.ignoredMessageTypes || [];
    this.macros = config.macros || [];
    this.connectionTimeoutSeconds = config.timeout || DEFAULT_FOCAS_TIMEOUT_SECONDS;
  }

  /** True when FOCAS works on this computer and its library file is installed */
  static isAvailable(): boolean {
    return Focas.isAvailable();
  }

  /** Why FOCAS is or is not available on this computer */
  static getPlatformMessage(): string {
    return Focas.getPlatformMessage();
  }

  async connect(): Promise<void> {
    try {
      if (!Focas.isAvailable()) {
        throw new Error(Focas.getPlatformMessage());
      }

      this.disconnect();
      const disconnects = this.disconnects;
      this.thread ??= focasThreads.thread();
      const session = await this.thread.connect(this.host, this.focasPort, this.connectionTimeoutSeconds);
      await this.readControlInfo(session);
      if (disconnects !== this.disconnects) {
        // The machine was disconnected or removed while it connected, so it must not keep the connection
        session.disconnect().catch(() => undefined);
        throw new Error('Disconnected while connecting');
      }
      this.focas = session;

      this.connected = true;
      this.clearErrors();
    } catch (error) {
      this.connected = false;
      this.addError(`Connection failed: ${errorMessage(error, 'Unknown connection error')}`);
      throw error;
    }
  }

  disconnect(): void {
    this.disconnects++;
    if (this.focas) {
      this.focas.disconnect().catch(() => {
        // The connection may be gone already; the connector is disconnected either way
      });
      this.focas = null;
    }
    this.connected = false;
  }

  /** Stop the FOCAS thread of the machine too. A connect that still waits on it fails. */
  dispose(): void {
    this.disconnect();
    const thread = this.thread;
    this.thread = null;
    thread?.stop().catch(() => undefined);
  }

  async poll(): Promise<FanucMachineStatus> {
    this.clearErrors();

    if (!this.focas || !this.connected) {
      if (!(await this.ensureConnected())) {
        return this.getStatus();
      }
    }

    this.prevData = { ...this.data };

    try {
      await this.readMachineValues(this.connectedFocas());
      this.updatePollTime();
      this.emitDataChanges(this.prevData, this.data);
    } catch (error) {
      this.handlePollError(error);
    }
    return this.getStatus();
  }

  /**
   * What the control is: its series and type (cnc_sysinfo), and its number of paths (cnc_getpath).
   * Each read may fail, and then that value stays unknown. A Series 15 control is refused,
   * because its status reply has another layout, so every value would be wrong.
   */
  private async readControlInfo(session: FocasSession): Promise<void> {
    try {
      const system = await this.readIfSupported('system information', () => session.readSystemInfo());
      const paths = await this.readIfSupported('path count', () => session.readPathCount());
      this.controlInfo = { series: system?.cncType, type: system?.mtType, paths };
    } catch (error) {
      session.disconnect().catch(() => undefined);
      throw error;
    }

    if (this.controlInfo.series === SERIES_15) {
      session.disconnect().catch(() => undefined);
      log.warn('Chatter cannot read a FANUC Series 15 control', { machine: this.id });
      throw new Error('This is a Series 15 control. Chatter cannot read its status.');
    }
    this.logControlInfo();
  }

  /** Log the control once, and warn once when it has more than one path */
  private logControlInfo(): void {
    const info = JSON.stringify(this.controlInfo);
    if (info === this.loggedControlInfo) return;
    this.loggedControlInfo = info;

    log.info('FANUC control', { machine: this.id, ...this.controlInfo });
    if ((this.controlInfo.paths ?? 1) > 1) {
      log.warn('The FANUC control has more than one path. Chatter reads only path 1.', {
        machine: this.id, paths: this.controlInfo.paths,
      });
    }
  }

  /**
   * Run a read that some controls or setups do not support. Gives undefined when the read fails,
   * and logs the failure once, until the read works again.
   * A lost connection (EW_SOCKET or EW_HANDLE) still throws, so the poll stops its other reads at once,
   * fails, and the next poll connects again. A poll that runs past its deadline fails the same way.
   */
  private async readIfSupported<T>(name: string, read: () => Promise<T>): Promise<T | undefined> {
    if (Date.now() > this.pollDeadline) throw new Error('The reads of this poll took too long');
    try {
      const value = await read();
      this.failingReads.delete(name);
      return value;
    } catch (error) {
      if (isConnectionLost(error)) throw error;
      if (!this.failingReads.has(name)) {
        this.failingReads.add(name);
        log.info('A FANUC read did not work, so its value is left out', { machine: this.id, read: name, error: errorMessage(error) });
      }
      return undefined;
    }
  }

  /** The status read must work, or the poll fails. The other values are optional. */
  private async readMachineValues(focas: FocasSession): Promise<void> {
    this.pollDeadline = Date.now() + POLL_READS_DEADLINE_MS;
    try {
      await this.readAllValues(focas);
    } finally {
      this.pollDeadline = Infinity;
    }
  }

  private async readAllValues(focas: FocasSession): Promise<void> {
    const status = await focas.readStatus();
    this.tmMode = status.tmMode;
    this.data.mode = status.mode;
    this.data.runState = status.runState;
    this.data.emergency = status.emergency;
    this.data.alarm = status.alarm;
    this.data.motion = status.motion;

    await this.readSpindleAndProgram(focas);
    await this.readCounterMacros(focas);
    // The status alarm flag may not show every alarm type, so read the alarm list too
    await this.readAlarmData(focas, status.alarm);
    this.markEmergencyStopAsAlarm();
    await this.readOperatorMessageData(focas);
    await this.readConfiguredMacros(focas);
  }

  /** A read that fails forgets the old value, so an old value is never shown as the current one */
  private async readSpindleAndProgram(focas: FocasSession): Promise<void> {
    this.data.spindleSpeed = await this.readIfSupported('spindle speed', async () => (await focas.readSpindleSpeed()).speed);

    // An analog spindle gives no load
    this.data.spindleLoad = await this.readIfSupported('spindle load', () => focas.readSpindleLoad());

    const program = await this.readIfSupported('program', () => focas.readProgram());
    this.data.program = program ? program.name || `O${program.number}` : undefined;
  }

  /** The tool number and the part count, from the macro variables that the user set. A failed read forgets the old value. */
  private async readCounterMacros(focas: FocasSession): Promise<void> {
    if (this.toolNumberVariable) {
      const toolNumber = await this.readMacroValue(focas, this.toolNumberVariable);
      this.data.toolNumber = toolNumber === undefined ? undefined : Math.floor(toolNumber);
    }

    if (this.partCounterVariable) {
      const partCount = await this.readMacroValue(focas, this.partCounterVariable);
      this.data.partCount = partCount === undefined ? undefined : Math.floor(partCount);
    }
  }

  /** A failed read forgets the old value */
  private async readConfiguredMacros(focas: FocasSession): Promise<void> {
    for (const macro of this.macros) {
      this.data[this.formatMacroLabel(macro.location, macro.name)] = await this.readMacroValue(focas, macro.location);
    }
  }

  /** The value of a macro variable, or undefined when the variable does not exist */
  private readMacroValue(focas: FocasSession, macroNumber: number): Promise<number | undefined> {
    return this.readIfSupported(`macro ${macroNumber}`, async () => (await focas.readMacro(macroNumber)).value);
  }

  /**
   * When the alarm list is empty or cannot be read, the alarm flag of the status decides.
   * An alarm with no list gets a general code and message, never the text of an older alarm.
   */
  private async readAlarmData(focas: FocasSession, statusAlarm: boolean): Promise<void> {
    const alarms = await this.readIfSupported('alarms', () => focas.readAlarms());
    if (alarms && alarms.length > 0) {
      this.data.alarm = true;
      this.data.alarmCode = String(alarms[0].alarmNo);
      this.data.alarmMessage = alarms[0].message;
    } else if (statusAlarm) {
      this.data.alarm = true;
      this.data.alarmCode = UNKNOWN_ALARM_CODE;
      this.data.alarmMessage = UNKNOWN_ALARM_MESSAGE;
    } else {
      this.data.alarm = false;
      this.data.alarmCode = undefined;
      this.data.alarmMessage = undefined;
    }
  }

  /** An emergency stop is an alarm too, but the code and message of a real alarm come first */
  private markEmergencyStopAsAlarm(): void {
    if (!this.data.emergency) return;

    this.data.alarm = true;
    if (!this.data.alarmCode || this.data.alarmCode === UNKNOWN_ALARM_CODE) {
      this.data.alarmCode = EMERGENCY_STOP_ALARM_CODE;
      this.data.alarmMessage = EMERGENCY_STOP_ALARM_MESSAGE;
    }
  }

  /**
   * Show the newest message whose type the user does not ignore. Some controls cannot read messages.
   * No message, or a read that fails, clears the old message.
   */
  private async readOperatorMessageData(focas: FocasSession): Promise<void> {
    const messages = await this.readIfSupported('operator messages', () => focas.readOperatorMessages()) ?? [];
    const shownMessages = messages.filter(message => !this.ignoredMessageTypes.includes(message.type));
    this.data.operatorMessage = shownMessages.at(-1)?.message;
  }

  private connectedFocas(): FocasSession {
    if (!this.focas) {
      throw new Error('Not connected');
    }
    return this.focas;
  }

  getStatus(): FanucMachineStatus {
    return {
      id: this.id,
      name: this.name,
      host: this.host,
      type: 'fanuc',
      focasPort: this.focasPort,
      ftpPort: this.ftpPort,
      ftpUser: this.ftpUser,
      hasFtpPassword: this.hasFtpPassword,
      toolNumberVariable: this.toolNumberVariable,
      partCounterVariable: this.partCounterVariable,
      ignoredMessageTypes: this.ignoredMessageTypes,
      connected: this.connected,
      lastPollTime: this.lastPollTime,
      errors: this.errors,
      data: { ...this.data },
      macros: this.macros,
    };
  }

  /**
   * True while connected. A failed poll disconnects, so this needs no FOCAS call:
   * a call could wait for the control, and this check must answer at once.
   */
  checkConnection(): boolean {
    return this.focas !== null && this.connected;
  }

  /** What the control is, as read-only snapshot fields. Only the values the control gave. */
  private controlInfoFields(): Record<string, string | number | boolean> {
    const { series, type, paths } = this.controlInfo;
    const fields: Record<string, string | number | boolean> = {};
    if (series) fields.controlSeries = series;
    if (type) {
      fields.controlType = type;
      fields.lathe = type.startsWith('T');
    }
    if (paths !== undefined) fields.paths = paths;
    if (this.tmMode !== undefined) fields.tmMode = this.tmMode;
    return fields;
  }

  getDataSnapshot(): MachineDataSnapshot {
    const custom: Record<string, string | number | boolean> = {};
    if (this.data.motion !== undefined) {
      custom.motion = this.data.motion;
    }
    if (this.data.operatorMessage) {
      custom.operatorMessage = this.data.operatorMessage;
    }
    Object.assign(custom, this.controlInfoFields());

    return this.buildSnapshot({
      mode: this.data.mode,
      runState: this.data.runState,
      program: this.data.program,
      spindleSpeed: this.data.spindleSpeed,
      spindleLoad: this.data.spindleLoad,
      toolNumber: this.data.toolNumber,
      partCount: this.data.partCount,
      alarm: this.data.alarm,
      alarmCode: this.data.alarmCode,
      alarmMessage: this.data.alarmMessage,
      emergency: this.data.emergency,
    }, { ...custom, ...this.macroValues(this.macros, this.data) });
  }

  updateMacros(macros: MacroConfig[]): void {
    this.macros = macros;
  }

  /** The next poll connects again, on the new port */
  updateFocasPort(port: number): void {
    this.focasPort = port;
    if (this.connected) {
      this.disconnect();
    }
  }

  updateToolNumberVariable(variable: number | undefined): void {
    this.toolNumberVariable = variable;
  }

  updatePartCounterVariable(variable: number | undefined): void {
    this.partCounterVariable = variable;
  }

  updateIgnoredMessageTypes(types: number[]): void {
    this.ignoredMessageTypes = types;
  }
}
