/**
 * Reads and writes machine settings in SQLite.
 * Each machine type has its own table.
 */
import type Database from 'better-sqlite3';
import type {
  BrotherMachineConfig,
  BrotherMachineRow,
  BrotherMachineUpdate,
  FanucMachineUpdate,
  HaasMachineUpdate,
  MTConnectMachineUpdate,
  FanucMachineConfig,
  FanucMachineRow,
  HaasMachineConfig,
  HaasMachineRow,
  MacroConfig,
  MTConnectMachineConfig,
  MTConnectMachineRow,
  SiemensMachineConfig,
  SiemensMachineRow,
  SiemensMachineUpdate,
} from '../types/index.js';
import {
  withFtpDefaults,
  type NewBrotherMachine,
  type NewFanucMachine,
  type NewHaasMachine,
  type NewMTConnectMachine,
  type NewSiemensMachine,
} from './machineSettings.js';

export type StoredMachineType = 'brother' | 'haas' | 'mtconnect' | 'fanuc' | 'siemens';

const TABLES: Record<StoredMachineType, string> = {
  brother: 'brother_machines',
  haas: 'haas_machines',
  mtconnect: 'mtconnect_machines',
  fanuc: 'fanuc_machines',
  siemens: 'siemens_machines',
};

export function isStoredMachineType(type: string): type is StoredMachineType {
  return Object.hasOwn(TABLES, type);
}

/** The update request of each machine type */
export interface MachineUpdateByType {
  brother: BrotherMachineUpdate;
  haas: HaasMachineUpdate;
  mtconnect: MTConnectMachineUpdate;
  fanuc: FanucMachineUpdate;
  siemens: SiemensMachineUpdate;
}

// SQLite keeps lists as JSON text
type StoredRow<Row, JsonColumns extends keyof Row> = Omit<Row, JsonColumns> & Record<JsonColumns, string>;
type BrotherRow = StoredRow<BrotherMachineRow, 'macros'>;
type HaasRow = StoredRow<HaasMachineRow, 'macros'>;
type MTConnectRow = StoredRow<MTConnectMachineRow, 'macros'>;
type FanucRow = StoredRow<FanucMachineRow, 'macros' | 'ignored_message_types'>;
type SiemensRow = StoredRow<SiemensMachineRow, 'macros'>;

type ColumnValue = string | number | null;

/** How one field of an update request is written to its column */
interface ColumnMapping<Update> {
  field: keyof Update & string;
  column: string;
  toColumn: (value: unknown) => ColumnValue;
}

const asIs = (value: unknown) => value as ColumnValue;
const asJson = (value: unknown) => JSON.stringify(value);
const emptyAsNull = (value: unknown) => (value || null) as ColumnValue;

function column<Update>(field: keyof Update & string, columnName: string = field, toColumn = asIs): ColumnMapping<Update> {
  return { field, column: columnName, toColumn };
}

interface FtpUpdate {
  ftpPort?: number;
  ftpUser?: string;
  ftpPassword?: string;
}

const FTP_COLUMNS: ColumnMapping<FtpUpdate>[] = [
  column('ftpPort', 'ftp_port'),
  column('ftpUser', 'ftp_user'),
  column('ftpPassword', 'ftp_password'),
];

const UPDATE_COLUMNS: { [Type in StoredMachineType]: ColumnMapping<MachineUpdateByType[Type]>[] } = {
  brother: [
    column('name'), column('host'), column('dataPort', 'data_port'), ...FTP_COLUMNS,
    column('defaultUnit', 'default_unit'), column('macros', 'macros', asJson),
  ],
  haas: [
    column('name'), column('host'), column('dataPort', 'data_port'), column('queryPort', 'query_port'),
    ...FTP_COLUMNS, column('macros', 'macros', asJson),
  ],
  mtconnect: [
    column('name'), column('host'), column('mtConnectPort', 'mtconnect_port'),
    column('mtConnectDeviceId', 'mtconnect_device_id', emptyAsNull), column('agentType', 'agent_type'),
    ...FTP_COLUMNS, column('macros', 'macros', asJson),
  ],
  fanuc: [
    column('name'), column('host'), column('focasPort', 'focas_port'), ...FTP_COLUMNS,
    column('toolNumberVariable', 'tool_number_variable', emptyAsNull),
    column('partCounterVariable', 'part_counter_variable', emptyAsNull),
    column('ignoredMessageTypes', 'ignored_message_types', asJson),
    column('macros', 'macros', asJson),
  ],
  siemens: [
    column('name'), column('host'), column('opcuaPort', 'opcua_port'), column('opcuaUser', 'opcua_user'),
    column('opcuaPassword', 'opcua_password'), column('opcuaSecurity', 'opcua_security'),
    ...FTP_COLUMNS, column('macros', 'macros', asJson),
  ],
};

function parseJsonList<T>(json: string | null | undefined): T[] {
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

const parseMacros = (json: string | null | undefined) => parseJsonList<MacroConfig>(json);

interface FtpColumns {
  ftp_port: number;
  ftp_user: string;
  ftp_password: string;
}

function ftpSettingsWithDefaults(row: FtpColumns) {
  return withFtpDefaults({ ftpPort: row.ftp_port, ftpUser: row.ftp_user, ftpPassword: row.ftp_password });
}

export class MachineRepository {
  constructor(private readonly db: Database.Database) {}

  loadBrotherMachines(): BrotherMachineConfig[] {
    return this.selectAll<BrotherRow>('brother').map(row => ({
      id: row.id,
      name: row.name,
      host: row.host,
      dataPort: row.data_port,
      ...ftpSettingsWithDefaults(row),
      defaultUnit: row.default_unit,
      macros: parseMacros(row.macros),
    }));
  }

  loadHaasMachines(): HaasMachineConfig[] {
    return this.selectAll<HaasRow>('haas').map(row => ({
      id: row.id,
      name: row.name,
      host: row.host,
      dataPort: row.data_port,
      queryPort: row.query_port,
      ...ftpSettingsWithDefaults(row),
      macros: parseMacros(row.macros),
    }));
  }

  loadMTConnectMachines(): MTConnectMachineConfig[] {
    return this.selectAll<MTConnectRow>('mtconnect').map(row => ({
      id: row.id,
      name: row.name,
      host: row.host,
      mtConnectPort: row.mtconnect_port,
      mtConnectDeviceId: row.mtconnect_device_id || undefined,
      agentType: row.agent_type,
      ftpPort: row.ftp_port,
      ftpUser: row.ftp_user,
      ftpPassword: row.ftp_password,
      macros: parseMacros(row.macros),
    }));
  }

  loadFanucMachines(): FanucMachineConfig[] {
    return this.selectAll<FanucRow>('fanuc').map(row => ({
      id: row.id,
      name: row.name,
      host: row.host,
      focasPort: row.focas_port,
      ...ftpSettingsWithDefaults(row),
      toolNumberVariable: row.tool_number_variable || undefined,
      partCounterVariable: row.part_counter_variable || undefined,
      ignoredMessageTypes: parseJsonList<number>(row.ignored_message_types),
      macros: parseMacros(row.macros),
    }));
  }

  loadSiemensMachines(): SiemensMachineConfig[] {
    return this.selectAll<SiemensRow>('siemens').map(row => ({
      id: row.id,
      name: row.name,
      host: row.host,
      opcuaPort: row.opcua_port,
      opcuaUser: row.opcua_user || undefined,
      opcuaPassword: row.opcua_password || undefined,
      opcuaSecurity: row.opcua_security === 'signAndEncrypt' ? 'signAndEncrypt' : 'none',
      ...ftpSettingsWithDefaults(row),
      macros: parseMacros(row.macros),
    }));
  }

  insertBrother(machine: NewBrotherMachine): void {
    this.db.prepare(
      'INSERT INTO brother_machines (id, name, host, data_port, ftp_port, ftp_user, ftp_password, default_unit, macros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(machine.id, machine.name, machine.host, machine.dataPort, machine.ftpPort, machine.ftpUser,
      machine.ftpPassword, machine.defaultUnit, JSON.stringify(machine.macros));
  }

  insertHaas(machine: NewHaasMachine): void {
    this.db.prepare(
      'INSERT INTO haas_machines (id, name, host, data_port, query_port, ftp_port, ftp_user, ftp_password, macros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(machine.id, machine.name, machine.host, machine.dataPort, machine.queryPort, machine.ftpPort,
      machine.ftpUser, machine.ftpPassword, JSON.stringify(machine.macros));
  }

  insertMTConnect(machine: NewMTConnectMachine): void {
    this.db.prepare(
      'INSERT INTO mtconnect_machines (id, name, host, mtconnect_port, mtconnect_device_id, agent_type, ftp_port, ftp_user, ftp_password, macros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(machine.id, machine.name, machine.host, machine.mtConnectPort, machine.mtConnectDeviceId ?? null,
      machine.agentType, machine.ftpPort, machine.ftpUser, machine.ftpPassword, JSON.stringify(machine.macros));
  }

  insertFanuc(machine: NewFanucMachine): void {
    this.db.prepare(
      'INSERT INTO fanuc_machines (id, name, host, focas_port, ftp_port, ftp_user, ftp_password, tool_number_variable, part_counter_variable, ignored_message_types, macros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(machine.id, machine.name, machine.host, machine.focasPort, machine.ftpPort, machine.ftpUser,
      machine.ftpPassword, machine.toolNumberVariable ?? null, machine.partCounterVariable ?? null,
      JSON.stringify(machine.ignoredMessageTypes), JSON.stringify(machine.macros));
  }

  insertSiemens(machine: NewSiemensMachine): void {
    this.db.prepare(
      'INSERT INTO siemens_machines (id, name, host, opcua_port, opcua_user, opcua_password, opcua_security, ftp_port, ftp_user, ftp_password, macros) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(machine.id, machine.name, machine.host, machine.opcuaPort, machine.opcuaUser, machine.opcuaPassword,
      machine.opcuaSecurity, machine.ftpPort, machine.ftpUser, machine.ftpPassword, JSON.stringify(machine.macros));
  }

  /**
   * Write the fields that are set in `updates`.
   * Returns false when `updates` has nothing to write.
   */
  update<Type extends StoredMachineType>(type: Type, id: string, updates: MachineUpdateByType[Type]): boolean {
    const mappings: ColumnMapping<MachineUpdateByType[Type]>[] = UPDATE_COLUMNS[type];
    const fieldValues = updates as Record<string, unknown>;
    const changedMappings = mappings.filter(mapping => fieldValues[mapping.field] !== undefined);
    if (changedMappings.length === 0) return false;

    const assignments = changedMappings.map(mapping => `${mapping.column} = ?`).join(', ');
    const columnValues = changedMappings.map(mapping => mapping.toColumn(fieldValues[mapping.field]));
    this.db.prepare(`UPDATE ${TABLES[type]} SET ${assignments} WHERE id = ?`).run(...columnValues, id);
    return true;
  }

  delete(type: StoredMachineType, id: string): void {
    this.db.prepare(`DELETE FROM ${TABLES[type]} WHERE id = ?`).run(id);
  }

  private selectAll<Row>(type: StoredMachineType): Row[] {
    return this.db.prepare(`SELECT * FROM ${TABLES[type]}`).all() as Row[];
  }
}
