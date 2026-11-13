import { BaseMachineConnector, errorMessage } from '../BaseMachineConnector.js';
import { Focas } from './focas.js';
import { isConnectionLost } from './focasError.js';
import { focasThreads, type FocasSession, type FocasThread } from './focasThread.js';
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

/**
 * Run a read that some controls or setups do not support. Gives undefined when the read fails.
 * A lost connection (EW_SOCKET or EW_HANDLE) still throws, so the poll fails and the next poll connects again.
 */
async function readIfSupported<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (isConnectionLost(error)) throw error;
    return undefined;
  }
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

  /** The status read must work, or the poll fails. The other values are optional. */
  private async readMachineValues(focas: FocasSession): Promise<void> {
    const status = await focas.readStatus();
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

  private async readSpindleAndProgram(focas: FocasSession): Promise<void> {
    const spindleSpeed = await readIfSupported(async () => (await focas.readSpindleSpeed()).speed);
    if (spindleSpeed !== undefined) {
      this.data.spindleSpeed = spindleSpeed;
    }

    // An analog spindle gives no load, so a failed read forgets the old value
    this.data.spindleLoad = await readIfSupported(() => focas.readSpindleLoad());

    const program = await readIfSupported(() => focas.readProgram());
    if (program) {
      this.data.program = program.name || `O${program.number}`;
    }
  }

  /** The tool number and the part count, from the macro variables that the user set */
  private async readCounterMacros(focas: FocasSession): Promise<void> {
    if (this.toolNumberVariable) {
      const toolNumber = await this.readMacroValue(focas, this.toolNumberVariable);
      if (toolNumber !== undefined) this.data.toolNumber = Math.floor(toolNumber);
    }

    if (this.partCounterVariable) {
      const partCount = await this.readMacroValue(focas, this.partCounterVariable);
      if (partCount !== undefined) this.data.partCount = Math.floor(partCount);
    }
  }

  private async readConfiguredMacros(focas: FocasSession): Promise<void> {
    for (const macro of this.macros) {
      const value = await this.readMacroValue(focas, macro.location);
      if (value !== undefined) {
        this.data[this.formatMacroLabel(macro.location, macro.name)] = value;
      }
    }
  }

  /** The value of a macro variable, or undefined when the variable does not exist */
  private readMacroValue(focas: FocasSession, macroNumber: number): Promise<number | undefined> {
    return readIfSupported(async () => (await focas.readMacro(macroNumber)).value);
  }

  /** When the alarm list cannot be read, the alarm flag of the status decides */
  private async readAlarmData(focas: FocasSession, statusAlarm: boolean): Promise<void> {
    const alarms = await readIfSupported(() => focas.readAlarms());
    if (alarms && alarms.length > 0) {
      this.data.alarm = true;
      this.data.alarmCode = String(alarms[0].alarmNo);
      this.data.alarmMessage = alarms[0].message;
    } else if (!statusAlarm) {
      this.data.alarm = false;
      this.data.alarmCode = undefined;
      this.data.alarmMessage = undefined;
    }
  }

  /** An emergency stop is an alarm too, but the code and message of a real alarm come first */
  private markEmergencyStopAsAlarm(): void {
    if (!this.data.emergency) return;

    this.data.alarm = true;
    if (!this.data.alarmCode) {
      this.data.alarmCode = EMERGENCY_STOP_ALARM_CODE;
      this.data.alarmMessage = EMERGENCY_STOP_ALARM_MESSAGE;
    }
  }

  /** Show the newest message whose type the user does not ignore. Some controls cannot read messages. */
  private async readOperatorMessageData(focas: FocasSession): Promise<void> {
    const messages = await readIfSupported(() => focas.readOperatorMessages());
    if (!messages || messages.length === 0) return;

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

  getDataSnapshot(): MachineDataSnapshot {
    const custom: Record<string, string | number | boolean> = {};
    if (this.data.motion !== undefined) {
      custom.motion = this.data.motion;
    }
    if (this.data.operatorMessage) {
      custom.operatorMessage = this.data.operatorMessage;
    }

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
