import net from 'net';
import { BaseMachineConnector } from '../BaseMachineConnector.js';
import type {
  BrotherMachineConfig,
  BrotherMachineStatus,
  BrotherMachineData,
  ToolTable,
  DataItem,
  DataItemType,
  DataItemTransform,
  ParsedResponse,
  MachineType,
  MacroConfig,
  MachineDataSnapshot,
} from '../../types/index.js';

const DEFAULT_DATA_PORT = 10000;
const DEFAULT_UNIT = 'in';

const PANEL_MODES = ['MANUAL', 'MDI', 'MEMORY', 'EDIT'];

/** The two-digit start of an ALARM E01 value, and the letters that Brother shows for it */
const ALARM_PREFIXES: Record<string, string> = {
  '01': 'EX', '02': 'EC', '03': 'SV', '04': 'NC', '05': 'IO', '06': 'SP',
  '07': 'SM', '08': 'SL', '09': 'CM', '10': 'ES', '11': 'FC', '90': 'OM',
};
/** CM is a communication message and OM means no alarm, so neither is a machine alarm */
const NOT_ALARMS = ['CM', 'OM'];

/** MEM A01 "operation status", in MTConnect execution words */
const OPERATION_STATUS_EXECUTION: Record<string, string> = {
  '0': 'READY', '1': 'ACTIVE', '2': 'FEED_HOLD', '3': 'INTERRUPTED',
};

// Transformers for special value parsing
const TRANSFORMS: Record<string, DataItemTransform> = {
  mode: (val) => {
    const index = Math.floor(parseFloat(String(val)));
    return PANEL_MODES[index] ?? index;
  },

  alarm: (val) => {
    const prefix = ALARM_PREFIXES[String(val).trim().substring(0, 2)];
    return prefix !== undefined && !NOT_ALARMS.includes(prefix);
  },

  // From open-source schemas that cite the Brother manual (C00 5.6.4.8, D00 3.6.5.8). Not tested on a real machine yet.
  execution: (val) => OPERATION_STATUS_EXECUTION[String(val).trim()] ?? '',

  alarmCode: (val) => {
    const trimmed = String(val).trim();
    const prefix = ALARM_PREFIXES[trimmed.substring(0, 2)];
    if (prefix === 'OM') return '';
    return prefix ? prefix + trimmed.substring(2) : trimmed;
  },
};

// Data item definitions: [label, command, key, index, type, transform?]
// Labels use normalized camelCase field names matching MachineData interface
const DATA_ITEMS: DataItem[] = [
  ['mode',         'PANEL',  'K01', 0, 'string', TRANSFORMS.mode],
  ['program',      'MEM',    'A01', 1, 'string'],
  ['execution',    'MEM',    'A01', 2, 'string', TRANSFORMS.execution],
  ['partCount',    'WKCNTR', 'A01', 1, 'int'],
  ['partGoal',     'WKCNTR', 'A01', 2, 'int'],
  ['toolNumber',   'PDSP',   'X01', 3, 'int'],
  ['spindleSpeed', 'PDSP',   'X01', 1, 'int'],
  ['alarm',        'ALARM',  'E01', 0, 'bool', TRANSFORMS.alarm],
  ['alarmCode',    'ALARM',  'E01', 0, 'string', TRANSFORMS.alarmCode],
];

/** The value of each type when the machine sends nothing */
const EMPTY_VALUES: Record<DataItemType, string | number | boolean> = {
  int: 0,
  float: 0,
  bool: false,
  string: '',
};

/** Brother puts text values in single quotes */
function withoutQuotes(text: string): string {
  return text.trim().replace(/^'|'$/g, '').trim();
}

/** Convert a raw value to the given type, after the transform when there is one */
function parseValue(
  raw: string | undefined,
  type: DataItemType,
  transform?: DataItemTransform
): string | number | boolean {
  let val: string | number | boolean = typeof raw === 'string' ? withoutQuotes(raw) : (raw ?? '');
  if (transform) val = transform(val);

  if (val === '' || val === null || val === undefined) {
    return EMPTY_VALUES[type] ?? '';
  }

  switch (type) {
    case 'int': return Math.floor(parseFloat(String(val)));
    case 'float': return parseFloat(String(val));
    case 'bool': return Boolean(val);
    default: return String(val);
  }
}

/** A Brother request: "%CLOD    <command>  ", then a checksum, between % signs */
export function brotherCommand(command: string): string {
  const cmdBody = 'CLOD'.padEnd(8) + command.padEnd(8) + '  \r\n';
  const checksum = [...cmdBody].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 16;
  return `%${cmdBody}\r\n${String(checksum).padStart(2, '0')}%\r\n`;
}

type ControlType = 'C00' | 'D00';
type AtcCommand = 'ATCTL' | 'ATCTLD';

/** Each control type has its own command for the tool in each ATC pot. Chatter tries them in this order. */
const ATC_COMMANDS: Array<{ command: AtcCommand; controlType: ControlType }> = [
  { command: 'ATCTL', controlType: 'C00' },
  { command: 'ATCTLD', controlType: 'D00' },
];

/** The ATC reply has the keys M02 to M51, for pots 1 to 50 */
const FIRST_POT_KEY = 2;
const LAST_POT_KEY = 51;
const MAX_TOOL_NUMBER = 99;

/** The position of each value in a row of the tool data reply */
const TOOL_DATA_COLUMN = { length: 0, lengthWear: 1, diameter: 2, diameterWear: 3, name: 8 } as const;

/** A valid ATC reply has M## keys */
function isValidAtcResponse(response: ParsedResponse): boolean {
  return Object.keys(response).some(key => /^M\d{2}$/.test(key));
}

/**
 * Connector for Brother CNC machines via telnet
 */
export class BrotherConnector extends BaseMachineConnector {
  readonly type: MachineType = 'brother';

  public dataPort: number;
  public defaultUnit: string;
  public macros: MacroConfig[];

  private socket: net.Socket | null = null;
  private data: BrotherMachineData = {};
  private prevData: BrotherMachineData = {};
  private toolTable: ToolTable = {};
  private hasPocketInfo = false;
  private controlType: ControlType | null = null;
  private atcCommand: AtcCommand | null = null;
  private toolDataCommand: string;
  private macroCommand: string;
  private dataItems: DataItem[];

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
  }

  /** The standard data items, then one item for each configured macro */
  private buildDataItems(): DataItem[] {
    const macroItems = this.macros.map((macro): DataItem =>
      [this.formatMacroLabel(macro.location, macro.name), this.macroCommand, 'C' + macro.location, 0, 'float']);
    return [...DATA_ITEMS, ...macroItems];
  }

  updateMacros(macros: MacroConfig[]): void {
    this.macros = macros;
    this.dataItems = this.buildDataItems();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) this.socket.destroy();

      this.socket = new net.Socket();
      this.socket.setTimeout(this.timeout);

      this.socket.on('timeout', () => {
        this.connected = false;
        this.addError('Connection timeout');
        this.socket?.destroy();
        reject(new Error('Connection timeout'));
      });

      this.socket.on('error', (err: Error) => {
        this.connected = false;
        this.addError(`Socket error: ${err.message}`);
        reject(err);
      });

      this.socket.on('close', () => { this.connected = false; });

      this.socket.connect(this.dataPort, this.host, () => {
        this.connected = true;
        this.clearErrors();
        resolve();
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  /** Send a command and wait for the reply between % signs */
  async sendCommand(command: string): Promise<ParsedResponse> {
    const socket = this.socket;
    if (!socket || !this.connected) throw new Error('Not connected');

    return new Promise((resolve, reject) => {
      let reply = '';

      const onData = (chunk: Buffer) => {
        reply += chunk.toString('ascii');
        const match = reply.match(/%([^%]*)%/);
        if (match) {
          cleanup();
          resolve(this.parseResponse(match[1]));
        }
      };

      const onError = (err: Error) => { cleanup(); reject(err); };
      const onTimeout = () => { cleanup(); reject(new Error('Command timeout')); };

      const cleanup = () => {
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('timeout', onTimeout);
      };

      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('timeout', onTimeout);
      socket.write(brotherCommand(command), 'ascii');
    });
  }

  /** Each reply line is "KEY,value,value,..."; lines with no comma are headers */
  parseResponse(response: string): ParsedResponse {
    const result: ParsedResponse = {};
    for (const line of response.split('\r\n')) {
      const parts = line.split(',');
      if (parts.length > 1) {
        result[parts[0]] = parts.slice(1).map(s => s.trim());
      }
    }
    return result;
  }

  /** Find which ATC command this control supports. With neither, the tool table has no pots. */
  private async detectControlType(): Promise<void> {
    if (this.atcCommand !== null) return;

    for (const { command, controlType } of ATC_COMMANDS) {
      try {
        if (isValidAtcResponse(await this.sendCommand(command))) {
          this.atcCommand = command;
          this.controlType = controlType;
          return;
        }
      } catch {
        // A control that does not know this command; try the next one
      }
    }
  }

  /** The tool in each pot, from the ATC reply */
  private updateToolTable(atcResponse: ParsedResponse): void {
    this.toolTable = {};
    for (let potKey = FIRST_POT_KEY; potKey <= LAST_POT_KEY; potKey++) {
      const rawValue = atcResponse[`M${String(potKey).padStart(2, '0')}`]?.[0];
      const toolNum = parseInt(rawValue, 10);
      if (toolNum >= 1 && toolNum <= MAX_TOOL_NUMBER) {
        this.toolTable[potKey - 1] = { toolNum };
      }
    }
    this.hasPocketInfo = Object.keys(this.toolTable).length > 0;
  }

  /** Add the offsets and names from the tool data reply to the tools in the tool table */
  private updateToolOffsets(toolDataResponse: ParsedResponse): void {
    // Some controls send 3-digit keys (T001), others 2-digit keys (T01)
    const keyDigits = toolDataResponse['T001'] !== undefined ? 3 : 2;

    for (let toolNum = 1; toolNum <= MAX_TOOL_NUMBER; toolNum++) {
      const values = toolDataResponse[`T${String(toolNum).padStart(keyDigits, '0')}`];
      if (!values) continue;

      const tool = Object.values(this.toolTable).find(t => t?.toolNum === toolNum);
      if (tool) {
        tool.length = parseFloat(values[TOOL_DATA_COLUMN.length]) || 0;
        tool.lengthWear = parseFloat(values[TOOL_DATA_COLUMN.lengthWear]) || 0;
        tool.diameter = parseFloat(values[TOOL_DATA_COLUMN.diameter]) || 0;
        tool.diameterWear = parseFloat(values[TOOL_DATA_COLUMN.diameterWear]) || 0;
        tool.name = withoutQuotes(values[TOOL_DATA_COLUMN.name] || '');
      }
    }
  }

  async poll(): Promise<BrotherMachineStatus> {
    this.clearErrors();

    if (!this.socket || !this.connected) {
      if (!(await this.ensureConnected())) {
        return this.getStatus();
      }
    }

    if (this.controlType === null) {
      await this.detectControlType();
    }

    this.prevData = { ...this.data };

    const responses = await this.sendPollCommands();
    if (!responses) {
      return this.getStatus();
    }

    this.saveDataItems(responses);
    if (this.atcCommand && responses[this.atcCommand]) {
      this.updateToolTable(responses[this.atcCommand]);
    }
    if (responses[this.toolDataCommand]) {
      this.updateToolOffsets(responses[this.toolDataCommand]);
    }

    this.updatePollTime();
    this.emitDataChanges(this.prevData, this.data);

    return this.getStatus();
  }

  /** Send each command once, and get the replies by command. Gives null when a command fails. */
  private async sendPollCommands(): Promise<Record<string, ParsedResponse> | null> {
    const commands = [...new Set(this.dataItems.map(([, command]) => command)), this.toolDataCommand];
    if (this.atcCommand) {
      commands.push(this.atcCommand);
    }

    const responses: Record<string, ParsedResponse> = {};
    for (const command of commands) {
      try {
        responses[command] = await this.sendCommand(command);
      } catch (err) {
        this.handlePollError(err);
        return null;
      }
    }
    return responses;
  }

  private saveDataItems(responses: Record<string, ParsedResponse>): void {
    for (const [label, command, key, index, type, transform] of this.dataItems) {
      const raw = responses[command]?.[key]?.[index];
      if (raw !== undefined) {
        this.data[label] = parseValue(raw, type, transform);
      }
    }
  }

  getStatus(): BrotherMachineStatus {
    return {
      id: this.id,
      name: this.name,
      host: this.host,
      dataPort: this.dataPort,
      ftpPort: this.ftpPort,
      ftpUser: this.ftpUser,
      hasFtpPassword: this.hasFtpPassword,
      type: 'brother',
      connected: this.connected,
      lastPollTime: this.lastPollTime,
      errors: this.errors,
      data: { ...this.data, toolTable: this.toolTable, hasPocketInfo: this.hasPocketInfo, controlType: this.controlType },
      macros: this.macros
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

// Export transformers for testing
export { TRANSFORMS, parseValue };
