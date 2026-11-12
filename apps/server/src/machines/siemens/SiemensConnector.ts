import { DEFAULT_OPCUA_PORT } from '@local-chatter/shared';
import { BaseMachineConnector, errorMessage } from '../BaseMachineConnector.js';
import type {
  MachineDataSnapshot,
  MachineType,
  MacroConfig,
  OpcUaSecurity,
  SiemensMachineConfig,
  SiemensMachineData,
  SiemensMachineStatus,
} from '../../types/index.js';
import { ActiveAlarms } from './sinumerikAlarms.js';
import { openSinumerikSession, type OpenSinumerikSession, type SinumerikSession, type SinumerikValue } from './sinumerikClient.js';
import {
  executionOf,
  modeName,
  programDisplayName,
  programStatusName,
  rParameterPath,
  SINUMERIK_PATHS,
  type SinumerikValueName,
} from './sinumerikValues.js';

const DEFAULT_TIMEOUT_MS = 5000;

/** The values of each poll, read together in one request */
const VALUE_NAMES = Object.keys(SINUMERIK_PATHS) as SinumerikValueName[];

type ReadValues = Record<SinumerikValueName, SinumerikValue>;

function numberOf(value: SinumerikValue): number | undefined {
  return typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : undefined;
}

function textOf(value: SinumerikValue): string | undefined {
  return typeof value.value === 'string' && value.value.trim() !== '' ? value.value.trim() : undefined;
}

/**
 * Connector for Siemens SINUMERIK controls (840D sl, 828D, ONE) through the OPC UA server of the control.
 * The control needs its OPC UA option, and a user with read rights (or anonymous access).
 * Each poll reads the values in one request. The alarms come as OPC UA events.
 */
export class SiemensConnector extends BaseMachineConnector {
  readonly type: MachineType = 'siemens';

  public opcuaPort: number;
  public opcuaUser: string;
  public opcuaSecurity: OpcUaSecurity;
  public macros: MacroConfig[];

  private opcuaPassword: string;
  private session: SinumerikSession | null = null;
  private readonly alarms = new ActiveAlarms();
  /** Why the alarms cannot be read, or null while they can */
  private alarmProblem: string | null = null;
  /** What may be missing from the alarms, or null */
  private alarmWarning: string | null = null;
  private data: SiemensMachineData = {};

  constructor(config: SiemensMachineConfig, private readonly openSession: OpenSinumerikSession = openSinumerikSession) {
    super({
      id: config.id,
      name: config.name || 'Siemens SINUMERIK',
      host: config.host,
      ftpPort: config.ftpPort,
      ftpUser: config.ftpUser,
      ftpPassword: config.ftpPassword,
      timeout: config.timeout || DEFAULT_TIMEOUT_MS,
    });

    this.id = config.id || `siemens_${Date.now()}`;
    this.opcuaPort = config.opcuaPort || DEFAULT_OPCUA_PORT;
    this.opcuaUser = config.opcuaUser || '';
    this.opcuaPassword = config.opcuaPassword || '';
    this.opcuaSecurity = config.opcuaSecurity || 'none';
    this.macros = config.macros || [];
  }

  async connect(): Promise<void> {
    this.disconnect();
    try {
      this.session = await this.openSession({
        host: this.host,
        port: this.opcuaPort,
        user: this.opcuaUser || undefined,
        password: this.opcuaPassword || undefined,
        security: this.opcuaSecurity,
        timeoutMs: this.timeout,
      });
      this.connected = true;
      this.clearErrors();
    } catch (error) {
      this.connected = false;
      this.addError(`Connection failed: ${errorMessage(error, 'Unknown connection error')}`);
      throw error;
    }
    await this.watchAlarms(this.session);
  }

  /** The values still come when the alarms do not, so a failed alarm subscription is only a warning */
  private async watchAlarms(session: SinumerikSession): Promise<void> {
    this.alarms.clear();
    this.alarmWarning = null;
    try {
      // An old session can still send an event while it closes. Only the current one counts.
      this.alarmWarning = await session.watchAlarms(event => {
        if (this.session === session) this.alarms.apply(event);
      });
      this.alarmProblem = null;
    } catch (error) {
      this.alarmProblem = errorMessage(error, 'Unknown error');
    }
  }

  disconnect(): void {
    if (this.session) {
      this.session.close().catch(() => {
        // The connection may be gone already; the connector is disconnected either way
      });
      this.session = null;
    }
    this.connected = false;
  }

  async poll(): Promise<SiemensMachineStatus> {
    this.clearErrors();

    if (!this.session || !this.connected) {
      if (!(await this.ensureConnected())) {
        return this.getStatus();
      }
    }

    const previous = { ...this.data };
    try {
      await this.readValues(this.connectedSession());
      this.updateAlarm();
      this.updatePollTime();
      this.emitDataChanges(previous, this.data);
    } catch (error) {
      this.handlePollError(error);
    }
    return this.getStatus();
  }

  /** The channel status must come, or the poll fails. The control may not have the other values. */
  private async readValues(session: SinumerikSession): Promise<void> {
    const macroPaths = this.macros.map(macro => rParameterPath(macro.location));
    const results = await session.read([...VALUE_NAMES.map(name => SINUMERIK_PATHS[name]), ...macroPaths]);
    const values = Object.fromEntries(VALUE_NAMES.map((name, i) => [name, results[i]])) as ReadValues;

    const channelStatus = numberOf(values.channelStatus);
    if (channelStatus === undefined) {
      throw new Error(`Cannot read ${SINUMERIK_PATHS.channelStatus} (${values.channelStatus.status})`);
    }

    this.data.execution = executionOf(channelStatus);
    this.data.programStatus = programStatusName(numberOf(values.programStatus));
    this.data.mode = modeName(numberOf(values.operatingMode));
    this.data.program = programDisplayName(textOf(values.selectedProgram));
    this.data.partCount = numberOf(values.partCount);
    this.data.partGoal = numberOf(values.partGoal);
    this.data.toolNumber = numberOf(values.toolNumber);
    this.data.toolName = textOf(values.toolName);
    this.data.spindleSpeed = numberOf(values.spindleSpeed);
    this.data.spindleLoad = numberOf(values.spindleLoad);
    this.data.feedrate = numberOf(values.feedrate);
    this.data.feedOverride = numberOf(values.feedOverride);

    this.macros.forEach((macro, i) => {
      this.data[this.formatMacroLabel(macro.location, macro.name)] = numberOf(results[VALUE_NAMES.length + i]);
    });
  }

  /** The first active alarm is shown. Without the alarm events, Chatter does not know, so it does not guess. */
  private updateAlarm(): void {
    if (this.alarmProblem) {
      this.addError(`Alarms cannot be read: ${this.alarmProblem}`);
      this.data.alarm = undefined;
      this.data.alarmCode = undefined;
      this.data.alarmText = undefined;
      return;
    }
    if (this.alarmWarning) this.addError(this.alarmWarning);
    const [first] = this.alarms.list();
    this.data.alarm = first !== undefined;
    this.data.alarmCode = first?.code || undefined;
    this.data.alarmText = first?.text || undefined;
  }

  private connectedSession(): SinumerikSession {
    if (!this.session) throw new Error('Not connected');
    return this.session;
  }

  getStatus(): SiemensMachineStatus {
    return {
      id: this.id,
      name: this.name,
      host: this.host,
      type: 'siemens',
      opcuaPort: this.opcuaPort,
      opcuaUser: this.opcuaUser,
      hasOpcuaPassword: this.opcuaPassword !== '',
      opcuaSecurity: this.opcuaSecurity,
      ftpPort: this.ftpPort,
      ftpUser: this.ftpUser,
      hasFtpPassword: this.hasFtpPassword,
      connected: this.connected,
      lastPollTime: this.lastPollTime,
      errors: this.errors,
      data: { ...this.data },
      macros: this.macros,
    };
  }

  /** True while connected. A failed poll disconnects, so this needs no call to the control. */
  checkConnection(): boolean {
    return this.session !== null && this.connected;
  }

  getDataSnapshot(): MachineDataSnapshot {
    const custom: Record<string, string | number | boolean> = {};
    if (this.data.programStatus !== undefined) custom.programStatus = this.data.programStatus;
    if (this.data.toolName !== undefined) custom.toolName = this.data.toolName;
    if (this.data.feedOverride !== undefined) custom.feedOverride = this.data.feedOverride;

    return this.buildSnapshot({
      mode: this.data.mode,
      execution: this.data.execution,
      program: this.data.program,
      spindleSpeed: this.data.spindleSpeed,
      spindleLoad: this.data.spindleLoad,
      feedrate: this.data.feedrate,
      toolNumber: this.data.toolNumber,
      partCount: this.data.partCount,
      partGoal: this.data.partGoal,
      alarm: this.data.alarm,
      alarmCode: this.data.alarmCode,
      alarmMessage: this.data.alarmText,
    }, { ...custom, ...this.macroValues(this.macros, this.data) });
  }

  /** R parameters: location 5 is R5 */
  updateMacros(macros: MacroConfig[]): void {
    this.macros = macros;
  }

  /** The next poll connects again with the new settings */
  updateOpcUaSettings(settings: { port?: number; user?: string; password?: string; security?: OpcUaSecurity }): void {
    if (settings.port !== undefined) this.opcuaPort = settings.port;
    if (settings.user !== undefined) this.opcuaUser = settings.user;
    if (settings.password !== undefined) this.opcuaPassword = settings.password;
    if (settings.security !== undefined) this.opcuaSecurity = settings.security;
    this.disconnect();
  }
}
