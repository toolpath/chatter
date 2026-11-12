import type { MacroConfig } from './machineData.js';
import type { OpcUaSecurity } from './machines.js';

// ============================================
// API Request Types
// ============================================

/** The password rules that the server checks and the web form shows */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

/** The machine types that the server can add */
export const SUPPORTED_MACHINE_TYPES = ['brother', 'haas', 'mtconnect', 'fanuc', 'siemens'] as const;
export type SupportedMachineType = typeof SUPPORTED_MACHINE_TYPES[number];

/** A machine that the network scan found. Send `machine` to POST /api/machines to add it. */
export interface FoundMachine {
  machine: AddMachineRequest;
  /** False when Chatter saw only an open port, and could not ask the machine what it is */
  isConfirmed: boolean;
  /** What the machine said about itself, such as "Serial number 1234567" */
  detail: string;
}

export interface AddMachineRequest {
  type: SupportedMachineType;
  name: string;
  host: string;
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
  // Siemens-specific
  opcuaPort?: number;
  opcuaUser?: string;
  opcuaPassword?: string;
  opcuaSecurity?: OpcUaSecurity;
}
