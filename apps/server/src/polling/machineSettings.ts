import { BaseMachineConnector, DEFAULT_FTP_USER } from '../machines/BaseMachineConnector.js';
import type { BrotherConnector } from '../machines/brother/BrotherConnector.js';
import type { HaasConnector } from '../machines/haas/HaasConnector.js';
import { MTConnectConnector } from '../machines/mtconnect/MTConnectConnector.js';
import { DmgMoriConnector } from '../machines/mtconnect/DmgMoriConnector.js';
import type { FanucConnector } from '../machines/fanuc/FanucConnector.js';
import type { SiemensConnector } from '../machines/siemens/SiemensConnector.js';
import { DEFAULT_DATA_PORTS, DEFAULT_HAAS_QUERY_PORT } from './machinePorts.js';
import type {
  BaseMachineConfig,
  BrotherMachineConfig,
  BrotherMachineUpdate,
  FanucMachineConfig,
  FanucMachineUpdate,
  HaasMachineConfig,
  HaasMachineUpdate,
  MacroConfig,
  MTConnectMachineConfig,
  MTConnectMachineUpdate,
  SiemensMachineConfig,
  SiemensMachineUpdate,
  UpdateMachineRequest,
  AddMachineRequest,
} from '../types/index.js';

/**
 * Settings rules for machines:
 * the defaults for a new machine, and how changed settings reach a live connector.
 */

const DEFAULT_FTP_PORT = 21;
const DEFAULT_BROTHER_UNIT = 'in';
const DEFAULT_MTCONNECT_AGENT = 'generic';

/** A config with every default filled in. `Optional` fields may still be empty. */
type Complete<Config, Optional extends keyof Config = never> =
  Required<Omit<Config, 'timeout' | Optional>> & Pick<Config, Optional>;

export type NewBrotherMachine = Complete<BrotherMachineConfig>;
export type NewHaasMachine = Complete<HaasMachineConfig>;
export type NewMTConnectMachine = Complete<MTConnectMachineConfig, 'mtConnectDeviceId'>;
export type NewFanucMachine = Complete<FanucMachineConfig, 'toolNumberVariable' | 'partCounterVariable'>;
export type NewSiemensMachine = Complete<SiemensMachineConfig>;

type FtpSettings = Pick<BaseMachineConfig, 'ftpPort' | 'ftpUser' | 'ftpPassword'>;

/** The FTP settings, with a default for each one that is empty */
export function withFtpDefaults(settings: FtpSettings): Required<FtpSettings> {
  return {
    ftpPort: settings.ftpPort || DEFAULT_FTP_PORT,
    ftpUser: settings.ftpUser || DEFAULT_FTP_USER,
    ftpPassword: settings.ftpPassword || '',
  };
}

/** An ID made from the machine type and the time, for a new machine that has no ID */
function newMachineId(type: string): string {
  return `${type}_${Date.now()}`;
}

export function newBrotherMachine(config: BrotherMachineConfig): NewBrotherMachine {
  return {
    id: config.id || newMachineId('brother'),
    name: config.name,
    host: config.host,
    dataPort: config.dataPort || DEFAULT_DATA_PORTS.brother,
    ...withFtpDefaults(config),
    defaultUnit: config.defaultUnit || DEFAULT_BROTHER_UNIT,
    macros: config.macros || [],
  };
}

export function newHaasMachine(config: HaasMachineConfig): NewHaasMachine {
  return {
    id: config.id || newMachineId('haas'),
    name: config.name,
    host: config.host,
    dataPort: config.dataPort || DEFAULT_DATA_PORTS.haas,
    queryPort: config.queryPort || DEFAULT_HAAS_QUERY_PORT,
    ...withFtpDefaults(config),
    macros: config.macros || [],
  };
}

export function newMTConnectMachine(config: MTConnectMachineConfig): NewMTConnectMachine {
  return {
    id: config.id || newMachineId('mtconnect'),
    name: config.name,
    host: config.host,
    // The port scan runs on the first poll, so the default is only a first guess
    mtConnectPort: config.mtConnectPort || DEFAULT_DATA_PORTS.mtconnect,
    mtConnectDeviceId: config.mtConnectDeviceId || undefined,
    agentType: config.agentType || DEFAULT_MTCONNECT_AGENT,
    ...withFtpDefaults(config),
    macros: config.macros || [],
  };
}

export function newFanucMachine(config: FanucMachineConfig): NewFanucMachine {
  return {
    id: config.id || newMachineId('fanuc'),
    name: config.name,
    host: config.host,
    focasPort: config.focasPort || DEFAULT_DATA_PORTS.fanuc,
    ...withFtpDefaults(config),
    toolNumberVariable: config.toolNumberVariable || undefined,
    partCounterVariable: config.partCounterVariable || undefined,
    ignoredMessageTypes: config.ignoredMessageTypes || [],
    macros: config.macros || [],
  };
}

export function newSiemensMachine(config: SiemensMachineConfig): NewSiemensMachine {
  return {
    id: config.id || newMachineId('siemens'),
    name: config.name,
    host: config.host,
    opcuaPort: config.opcuaPort || DEFAULT_DATA_PORTS.siemens,
    opcuaUser: config.opcuaUser?.trim() || '',
    opcuaPassword: config.opcuaPassword || '',
    opcuaSecurity: config.opcuaSecurity || 'none',
    ...withFtpDefaults(config),
    macros: config.macros || [],
  };
}

/**
 * Copy only the fields an add request may set.
 * A JSON body can carry more, such as an id, and those must not reach the database.
 */
export function fieldsOfAddRequest(request: AddMachineRequest): Omit<AddMachineRequest, 'type'> {
  return {
    name: request.name,
    host: request.host,
    dataPort: request.dataPort,
    queryPort: request.queryPort,
    ftpPort: request.ftpPort,
    ftpUser: request.ftpUser,
    ftpPassword: request.ftpPassword,
    defaultUnit: request.defaultUnit,
    macros: request.macros,
    mtConnectPort: request.mtConnectPort,
    mtConnectDeviceId: request.mtConnectDeviceId,
    agentType: request.agentType,
    focasPort: request.focasPort,
    opcuaPort: request.opcuaPort,
    opcuaUser: request.opcuaUser,
    opcuaPassword: request.opcuaPassword,
    opcuaSecurity: request.opcuaSecurity,
  };
}

/** Pick the MTConnect connector that fits the agent type */
export function createMTConnectConnector(config: MTConnectMachineConfig): MTConnectConnector {
  return config.agentType === 'dmg_mori' ? new DmgMoriConnector(config) : new MTConnectConnector(config);
}

interface CommonUpdate {
  name?: string;
  host?: string;
  ftpPort?: number;
  ftpUser?: string;
  ftpPassword?: string;
  macros?: MacroConfig[];
}

type ConnectorWithMacros = BaseMachineConnector & { updateMacros(macros: MacroConfig[]): void };

/** An empty FTP password removes the saved one. A missing one keeps it. */
function applyCommonUpdate(connector: ConnectorWithMacros, updates: CommonUpdate): void {
  if (updates.name !== undefined) connector.name = updates.name;
  connector.updateFTPConfig({
    host: updates.host,
    ftpPort: updates.ftpPort,
    ftpUser: updates.ftpUser,
    ftpPassword: updates.ftpPassword,
  });
  if (updates.macros !== undefined) connector.updateMacros(updates.macros);
}

/** Drop the connection, so the next poll connects with the new settings */
function reconnect(connector: BaseMachineConnector): void {
  connector.disconnect();
  connector.connected = false;
}

export function applyBrotherUpdate(connector: BrotherConnector, updates: BrotherMachineUpdate): void {
  applyCommonUpdate(connector, updates);
  if (updates.dataPort !== undefined) connector.dataPort = updates.dataPort;
  if (updates.host !== undefined || updates.dataPort !== undefined) reconnect(connector);
}

export function applyHaasUpdate(connector: HaasConnector, updates: HaasMachineUpdate): void {
  applyCommonUpdate(connector, updates);
  if (updates.dataPort !== undefined) connector.dataPort = updates.dataPort;
  if (updates.queryPort !== undefined) connector.queryPort = updates.queryPort;
  if (updates.host !== undefined || updates.dataPort !== undefined || updates.queryPort !== undefined) {
    reconnect(connector);
  }
}

export function applyMTConnectUpdate(connector: MTConnectConnector, updates: MTConnectMachineUpdate): void {
  applyCommonUpdate(connector, updates);
  if (updates.mtConnectPort !== undefined) connector.mtConnectPort = updates.mtConnectPort;
  if (updates.mtConnectDeviceId !== undefined) connector.mtConnectDeviceId = updates.mtConnectDeviceId || undefined;
  if (updates.agentType !== undefined) connector.agentType = updates.agentType;
  if (updates.host !== undefined || updates.mtConnectPort !== undefined || updates.mtConnectDeviceId !== undefined) {
    reconnect(connector);
  }
}

export function applyFanucUpdate(connector: FanucConnector, updates: FanucMachineUpdate): void {
  applyCommonUpdate(connector, updates);
  if (updates.focasPort !== undefined) connector.updateFocasPort(updates.focasPort);
  if (updates.toolNumberVariable !== undefined) connector.updateToolNumberVariable(updates.toolNumberVariable);
  if (updates.partCounterVariable !== undefined) connector.updatePartCounterVariable(updates.partCounterVariable);
  if (updates.ignoredMessageTypes !== undefined) connector.updateIgnoredMessageTypes(updates.ignoredMessageTypes);
  if (updates.host !== undefined) reconnect(connector);
}

export function applySiemensUpdate(connector: SiemensConnector, updates: SiemensMachineUpdate): void {
  applyCommonUpdate(connector, updates);
  const opcua = {
    port: updates.opcuaPort,
    user: updates.opcuaUser?.trim(),
    password: updates.opcuaPassword,
    security: updates.opcuaSecurity,
  };
  if (Object.values(opcua).some(value => value !== undefined)) {
    connector.updateOpcUaSettings(opcua);
  } else if (updates.host !== undefined) {
    reconnect(connector);
  }
}

/** Only the fields that a Siemens machine has */
export function toSiemensUpdate(updates: UpdateMachineRequest): SiemensMachineUpdate {
  return {
    name: updates.name,
    host: updates.host,
    opcuaPort: updates.opcuaPort,
    opcuaUser: updates.opcuaUser?.trim(),
    opcuaPassword: updates.opcuaPassword,
    opcuaSecurity: updates.opcuaSecurity,
    ftpPort: updates.ftpPort,
    ftpUser: updates.ftpUser,
    ftpPassword: updates.ftpPassword,
    macros: updates.macros,
  };
}

/** The web UI may send the FANUC macro variable numbers as text */
export function toFanucUpdate(updates: UpdateMachineRequest): FanucMachineUpdate {
  return {
    name: updates.name,
    host: updates.host,
    focasPort: updates.focasPort,
    ftpPort: updates.ftpPort,
    ftpUser: updates.ftpUser,
    ftpPassword: updates.ftpPassword,
    toolNumberVariable: toOptionalNumber(updates.toolNumberVariable),
    partCounterVariable: toOptionalNumber(updates.partCounterVariable),
    ignoredMessageTypes: updates.ignoredMessageTypes,
    macros: updates.macros,
  };
}

function toOptionalNumber(value: number | string | undefined): number | undefined {
  return value === '' || value === undefined ? undefined : Number(value);
}
