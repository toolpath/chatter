import type {
  BrotherMachineData,
  FanucMachineData,
  HaasMachineData,
  MachineType,
  MachineUpdate,
  MacroConfig,
  MTConnectMachineData,
  OpcUaSecurity,
  SiemensMachineData,
} from '@local-chatter/shared';

// ============================================
// Shared types the server uses
// ============================================
// The web app and the server share these through @local-chatter/shared.
// They are re-exported here so server code has one place to import types from.

export type {
  AddMachineRequest,
  BrotherMachineData,
  BrotherMachineUpdate,
  FanucMachineData,
  FanucMachineUpdate,
  FTPFileInfo,
  FTPTreeNode,
  HaasMachineData,
  HaasMachineUpdate,
  MachineData,
  MachineType,
  MacroConfig,
  MTConnectMachineData,
  MTConnectMachineUpdate,
  OpcUaSecurity,
  SiemensMachineData,
  SiemensMachineUpdate,
  ToolTable,
} from '@local-chatter/shared';

// ============================================
// Connector config (how to reach one machine)
// ============================================
// A connector is built from one of these. Ports and FTP login are optional
// because each connector falls back to the factory default for its control.

export interface BaseMachineConfig {
  id?: string;
  name: string;
  host: string;
  ftpPort?: number;
  ftpUser?: string;
  ftpPassword?: string;
  timeout?: number;
}

export interface BrotherMachineConfig extends BaseMachineConfig {
  dataPort?: number;
  defaultUnit?: string;
  macros?: MacroConfig[];
}

export interface HaasMachineConfig extends BaseMachineConfig {
  dataPort?: number;
  queryPort?: number;
  macros?: MacroConfig[];
}

export interface MTConnectMachineConfig extends BaseMachineConfig {
  mtConnectPort?: number;
  mtConnectDeviceId?: string;
  agentType?: string;
  macros?: MacroConfig[];
}

export interface FanucMachineConfig extends BaseMachineConfig {
  focasPort?: number;
  /** Macro variable to read the tool number from. When it is not set, no tool number is read. */
  toolNumberVariable?: number;
  /** Macro variable to read the part count from. When it is not set, no part count is read. */
  partCounterVariable?: number;
  /** Operator message types to skip when choosing which operator message to show. */
  ignoredMessageTypes?: number[];
  macros?: MacroConfig[];
}

export interface SiemensMachineConfig extends BaseMachineConfig {
  opcuaPort?: number;
  /** No user means an anonymous login */
  opcuaUser?: string;
  opcuaPassword?: string;
  opcuaSecurity?: OpcUaSecurity;
  /** R parameters to read: location 5 is R5 */
  macros?: MacroConfig[];
}

// ============================================
// API request
// ============================================

/** The web UI sends the FANUC variables as text, so the request is the shared MachineUpdate. */
export type UpdateMachineRequest = MachineUpdate;

// ============================================
// Connector status (what the API sends to the web app)
// ============================================

export interface BaseMachineStatus {
  id: string;
  name: string;
  host: string;
  type: MachineType;
  connected: boolean;
  /** True while Chatter tries to reach the machine for the first time, for at most 30 seconds. The poller sets it. */
  connecting?: boolean;
  lastPollTime: string | null;
  errors: string[];
  data: Record<string, unknown>;
  dataPort?: number;
  queryPort?: number;
  ftpPort?: number;
  ftpUser?: string;
  /** Only whether a password is saved. The password itself never leaves the server. */
  hasFtpPassword: boolean;
  macros?: MacroConfig[];
}

export interface BrotherMachineStatus extends BaseMachineStatus {
  type: 'brother';
  dataPort: number;
  ftpPort: number;
  data: BrotherMachineData;
}

export interface HaasMachineStatus extends BaseMachineStatus {
  type: 'haas';
  dataPort: number;
  queryPort: number;
  data: HaasMachineData;
}

export interface MTConnectMachineStatus extends BaseMachineStatus {
  type: 'mtconnect';
  mtConnectPort: number;
  mtConnectDeviceId?: string;
  agentType?: string;
  data: MTConnectMachineData;
}

export interface FanucMachineStatus extends BaseMachineStatus {
  type: 'fanuc';
  focasPort: number;
  toolNumberVariable?: number;
  partCounterVariable?: number;
  ignoredMessageTypes: number[];
  data: FanucMachineData;
}

export interface SiemensMachineStatus extends BaseMachineStatus {
  type: 'siemens';
  opcuaPort: number;
  opcuaUser: string;
  /** Only whether an OPC UA password is saved. The password itself never leaves the server. */
  hasOpcuaPassword: boolean;
  opcuaSecurity: OpcUaSecurity;
  data: SiemensMachineData;
}

// ============================================
// Machine data snapshot (for time-series history)
// ============================================

/**
 * One poll of one machine, in the same shape for every control type.
 * Each connector maps its own fields to these names, so the history and
 * report code does not need to know which control the data came from.
 */
export interface MachineDataSnapshot {
  // Identification
  timestamp: string;
  machineId: string;
  machineType: MachineType;
  connected: boolean;

  // Operational data. A field is undefined when the control does not report it.
  mode?: string;
  runState?: string;
  execution?: string;
  program?: string;
  spindleSpeed?: number;
  /** Spindle load in percent */
  spindleLoad?: number;
  feedrate?: number;
  toolNumber?: number;
  partCount?: number;
  partGoal?: number;

  // Alarm state
  alarm?: boolean;
  alarmCode?: string;
  alarmMessage?: string;
  emergency?: boolean;

  // Machine-specific and custom data (macros, etc.)
  custom?: Record<string, string | number | boolean | object>;
}

// ============================================
// Database rows (SQLite)
// ============================================
// Field names match the snake_case column names. JSON columns (macros,
// ignored_message_types) are shown here already parsed; the repository
// parses them after it reads a row.

export interface BrotherMachineRow {
  id: string;
  name: string;
  host: string;
  data_port: number;
  ftp_port: number;
  ftp_user: string;
  ftp_password: string;
  default_unit: string;
  macros: MacroConfig[];
  created_at: string;
}

export interface HaasMachineRow {
  id: string;
  name: string;
  host: string;
  data_port: number;
  query_port: number;
  ftp_port: number;
  ftp_user: string;
  ftp_password: string;
  macros: MacroConfig[];
  created_at: string;
}

export interface MTConnectMachineRow {
  id: string;
  name: string;
  host: string;
  mtconnect_port: number;
  mtconnect_device_id: string | null;
  agent_type: string;
  ftp_port: number;
  ftp_user: string;
  ftp_password: string;
  macros: MacroConfig[];
  created_at: string;
}

export interface FanucMachineRow {
  id: string;
  name: string;
  host: string;
  focas_port: number;
  ftp_port: number;
  ftp_user: string;
  ftp_password: string;
  tool_number_variable: number | null;
  part_counter_variable: number | null;
  ignored_message_types: number[];
  macros: MacroConfig[];
  created_at: string;
}

export interface SiemensMachineRow {
  id: string;
  name: string;
  host: string;
  opcua_port: number;
  opcua_user: string;
  opcua_password: string;
  opcua_security: string;
  ftp_port: number;
  ftp_user: string;
  ftp_password: string;
  macros: MacroConfig[];
  created_at: string;
}

export interface UploadFileRow {
  id: number;
  machine_id: string;
  file_name: string;
  created_at: string;
  updated_at: string;
  /** Only set by the file list query, which counts and joins the upload events. */
  event_count?: number;
  last_path?: string;
}

export interface UploadEventRow {
  id: number;
  file_id: number;
  target_name: string | null;
  remote_path: string;
  /** Stored gzipped (Buffer) and becomes text after it is unzipped. Not selected by the list query, so absent there. */
  file_content: Buffer | string | null;
  uploaded_at: string;
  /** Only set when the query joins the upload file. */
  file_name?: string;
  machine_id?: string;
}

// ============================================
// FTP
// ============================================

export interface FTPConfig {
  host: string;
  port?: number;
  user?: string;
  password?: string;
}

export interface FTPUploadFile {
  remotePath: string;
  source: Buffer | string;
}

/**
 * When one file fails, the upload records it and still tries the rest, so the
 * result lists both outcomes. A lost connection throws instead.
 */
export interface FTPUploadResult {
  success: Array<{ remotePath: string }>;
  failed: Array<{ remotePath: string; error: string }>;
}

// ============================================
// Brother protocol parsing
// ============================================

export type DataItemType = 'string' | 'int' | 'float' | 'bool';

export type DataItemTransform = (val: string | number) => string | number | boolean;

/**
 * Where to find one value in a Brother reply: send `command`, find the reply
 * line that starts with `key`, and read the value at `index` after the key
 * (index 0 is the first value, not the key).
 */
export type DataItem = [
  label: string,
  command: string,
  key: string,
  index: number,
  type: DataItemType,
  transform?: DataItemTransform,
];

/** A Brother reply, split into lines: the first field of each line is the key, the rest are its values. */
export interface ParsedResponse {
  [key: string]: string[];
}
