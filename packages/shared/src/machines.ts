import type { MachineData, MachinePath, MacroConfig, ToolSyncState, ToolTable } from './machineData.js';
import type { PollTimings } from './pollTimings.js';

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
  /** How long the polls take. Only connectors that measure their polls send it. */
  pollTimings?: PollTimings;
}

/** One change of the connection of a machine, as the server log tells it */
export interface ConnectionEvent {
  /** ISO text */
  time: string;
  /** "Machine went offline: connect ECONNREFUSED 10.0.0.5:10000" */
  text: string;
  /** good: connected or back online. bad: offline or a problem. */
  tone: 'good' | 'bad';
}

/** GET /api/machine/:id/health: why a machine is offline, and since when */
export interface MachineHealth {
  /** When the machine went offline (ISO text), or null while it is online or before its first result */
  offlineSince: string | null;
  /** The last error of the machine and when it first came (ISO text), or null */
  lastError: { text: string; time: string } | null;
  /** The last 10 connection changes, newest first */
  events: ConnectionEvent[];
  /** The time of the last good poll (ISO text), or null */
  lastPollTime: string | null;
  /** The time of the server when it sent this reply (ISO text). The clock of the browser can be different. */
  serverTime: string;
}

// ============================================
// Brother Machine Types
// ============================================

export interface BrotherMachineData extends MachineData {
  toolTable?: ToolTable;
  toolSync?: ToolSyncState;
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
  warning?: string;          // A warning of the status, such as "Battery low" (not an alarm)
  /**
   * Each path of a control with more than one, such as a two-path lathe, path 1 (the main path) first.
   * Undefined for a control with one path. The values above are of the whole machine: runState is
   * that of a path that runs (see combinedRunState), and the spindle is the first spindle of path 1.
   */
  paths?: MachinePath[];
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

/**
 * The control showed a certificate that is not the trusted one, so Chatter did not log in (F-11).
 * An Admin checks the control, and then trusts the new certificate with POST /api/machine/:id/opcua/trust-certificate.
 */
export interface OpcUaCertificateChange {
  /**
   * The thumbprint (SHA-256, 64 hex digits) of the certificate that the control shows now. Null when it shows none.
   * Chatter keeps this thumbprint, and the trust route takes it.
   */
  presentedThumbprint: string | null;
  /**
   * The SHA-1 thumbprint (40 hex digits) of the same certificate, to compare with the screen of the control, which can
   * show only SHA-1. Only for that comparison: Chatter does not trust a certificate by its SHA-1. Null when it shows none.
   */
  presentedSha1Thumbprint: string | null;
}

export interface SiemensMachine extends BaseMachine {
  type: 'siemens';
  opcuaPort: number;
  /** Empty for an anonymous login */
  opcuaUser?: string;
  /** Only whether an OPC UA password is saved. The server never sends the password itself. */
  hasOpcuaPassword?: boolean;
  opcuaSecurity: OpcUaSecurity;
  /**
   * The thumbprint (SHA-256 of the DER certificate, 64 lowercase hex digits) of the OPC UA certificate of the control
   * that Chatter trusts. Chatter trusts the certificate of the first connect. Null before that, and after a change of
   * the IP address or the OPC UA port.
   */
  opcuaServerThumbprint?: string | null;
  /** Set while the control shows a different certificate. Chatter does not connect until an Admin trusts it. */
  opcuaCertificateChanged?: OpcUaCertificateChange;
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
