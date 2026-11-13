import type { MachineData, MacroConfig, ToolTable } from './machineData.js';

// ============================================
// Machine Type Definitions
// ============================================

// MachineType is a string to allow easy extension for new machine types
// Known types: 'brother', 'haas', 'mtconnect', 'fanuc', 'siemens'
export type MachineType = string;

// Base machine interface - all machine types have these properties
export interface BaseMachine {
  id: string;
  name: string;
  host: string;
  type: MachineType;
  connected: boolean;
  /** True while Chatter tries to reach the machine for the first time, for at most 30 seconds */
  connecting?: boolean;
  lastPollTime: string | null;
  errors: string[];
  data: MachineData;
  dataPort?: number;
  queryPort?: number;
  ftpPort?: number;
  ftpUser?: string;
  /** Only whether an FTP password is saved. The server never sends the password itself. */
  hasFtpPassword?: boolean;
  macros?: MacroConfig[];
}

// ============================================
// Brother Machine Types
// ============================================

export interface BrotherMachineData extends MachineData {
  toolTable?: ToolTable;
  hasPocketInfo?: boolean;  // true if ATC command returns valid data (pocket != tool number)
  controlType?: 'C00' | 'D00' | null;  // C00 uses ATCTL, D00 uses ATCTLD
}

export interface BrotherMachine extends BaseMachine {
  type: 'brother';
  dataPort: number;
  ftpPort: number;
  defaultUnit?: string;
  data: BrotherMachineData;
}

export interface BrotherMachineUpdate {
  name?: string;
  host?: string;
  dataPort?: number;
  ftpPort?: number;
  ftpUser?: string;
  ftpPassword?: string;
  defaultUnit?: string;
  macros?: MacroConfig[];
}

// ============================================
// Haas Machine Types
// ============================================

export interface HaasMachineData extends MachineData {
}

export interface HaasMachine extends BaseMachine {
  type: 'haas';
  dataPort: number;
  queryPort: number;
  ftpPort?: number;
  data: HaasMachineData;
}

export interface HaasMachineUpdate {
  name?: string;
  host?: string;
  dataPort?: number;
  queryPort?: number;
  ftpPort?: number;
  ftpUser?: string;
  ftpPassword?: string;
  macros?: MacroConfig[];
}

// ============================================
// MTConnect Machine Types
// ============================================

/** MTConnect machines send only the shared fields, "execution" included */
export type MTConnectMachineData = MachineData;

export interface MTConnectMachine extends BaseMachine {
  type: 'mtconnect';
  mtConnectPort: number;
  mtConnectDeviceId?: string;  // Optional filter for multi-device agents
  agentType?: string;          // e.g., 'dmg_mori', 'hurco', 'okuma', 'mazak', 'generic'
  ftpPort?: number;
  data: MTConnectMachineData;
}

export interface MTConnectMachineUpdate {
  name?: string;
  host?: string;
  mtConnectPort?: number;
  mtConnectDeviceId?: string;
  agentType?: string;
  ftpPort?: number;
  ftpUser?: string;
  ftpPassword?: string;
  macros?: MacroConfig[];
}

// ============================================
// FANUC Machine Types
// ============================================

export interface FanucMachineData extends MachineData {
  runState?: string;         // Running state (RESET, STOP, HOLD, START, MSTR)
  emergency?: boolean;       // Emergency stop status
  alarmMessage?: string;     // Alarm message text
  motion?: number;           // Axis motion status
  operatorMessage?: string;  // Last operator message from control
}

export interface FanucMachine extends BaseMachine {
  type: 'fanuc';
  focasPort: number;         // FOCAS port (default 8193)
  ftpPort?: number;
  toolNumberVariable?: number;   // Macro variable for current tool number
  partCounterVariable?: number;  // Macro variable for part counter
  ignoredMessageTypes?: number[]; // Operator message types to ignore
  data: FanucMachineData;
}

export interface FanucMachineUpdate {
  name?: string;
  host?: string;
  focasPort?: number;
  ftpPort?: number;
  ftpUser?: string;
  ftpPassword?: string;
  toolNumberVariable?: number;
  partCounterVariable?: number;
  ignoredMessageTypes?: number[];
  macros?: MacroConfig[];
}

// ============================================
// Siemens SINUMERIK Machine Types
// ============================================

/** How Chatter talks to the OPC UA server of the control: no security, or signed and encrypted (Basic256Sha256) */
export type OpcUaSecurity = 'none' | 'signAndEncrypt';

export const OPCUA_SECURITY_MODES: readonly OpcUaSecurity[] = ['none', 'signAndEncrypt'];

export interface SiemensMachineData extends MachineData {
  /** The program state: RUNNING, STOPPED, WAITING, INTERRUPTED or ABORTED */
  programStatus?: string;
  /** The name of the tool in the spindle */
  toolName?: string;
  /** The path feed */
  feedrate?: number;
  /** The feed override in percent */
  feedOverride?: number;
}

export interface SiemensMachine extends BaseMachine {
  type: 'siemens';
  opcuaPort: number;
  /** Empty for an anonymous login */
  opcuaUser?: string;
  /** Only whether an OPC UA password is saved. The server never sends the password itself. */
  hasOpcuaPassword?: boolean;
  opcuaSecurity: OpcUaSecurity;
  data: SiemensMachineData;
}

export interface SiemensMachineUpdate {
  name?: string;
  host?: string;
  opcuaPort?: number;
  opcuaUser?: string;
  /** An empty password removes the saved one. A missing one keeps it. */
  opcuaPassword?: string;
  opcuaSecurity?: OpcUaSecurity;
  ftpPort?: number;
  ftpUser?: string;
  ftpPassword?: string;
  /** R parameters: location 5 is R5 */
  macros?: MacroConfig[];
}

// ============================================
// Unified Machine Types
// ============================================

export type Machine = BrotherMachine | HaasMachine | MTConnectMachine | FanucMachine | SiemensMachine;

export interface MachineUpdate {
  name?: string;
  host?: string;
  dataPort?: number;
  queryPort?: number;
  ftpPort?: number;
  ftpUser?: string;
  ftpPassword?: string;
  defaultUnit?: string;
  macros?: MacroConfig[];
  // MTConnect-specific
  mtConnectPort?: number;
  mtConnectDeviceId?: string;
  agentType?: string;
  // FANUC-specific
  focasPort?: number;
  toolNumberVariable?: number | string;
  partCounterVariable?: number | string;
  ignoredMessageTypes?: number[];
  // Siemens-specific
  opcuaPort?: number;
  opcuaUser?: string;
  opcuaPassword?: string;
  opcuaSecurity?: OpcUaSecurity;
}

// Type guards
export function isBrotherMachine(machine: Machine): machine is BrotherMachine {
  return machine.type === 'brother';
}

export function isHaasMachine(machine: Machine): machine is HaasMachine {
  return machine.type === 'haas';
}

export function isMTConnectMachine(machine: Machine): machine is MTConnectMachine {
  return machine.type === 'mtconnect';
}

export function isFanucMachine(machine: Machine): machine is FanucMachine {
  return machine.type === 'fanuc';
}

export function isSiemensMachine(machine: Machine): machine is SiemensMachine {
  return machine.type === 'siemens';
}

export function isMachine(obj: unknown): obj is Machine {
  return typeof obj === 'object' && obj !== null && 'connected' in obj && 'errors' in obj && 'data' in obj;
}
