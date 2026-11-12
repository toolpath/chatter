import type { Machine, MacroConfig, OpcUaSecurity } from '../../types';
import { DEFAULT_MTCONNECT_PORT, DEFAULT_OPCUA_PORT } from '../../types';

/** The values in the "Edit Machine" form. Each machine type uses only some of them. */
export interface EditFormState {
  name: string;
  host: string;
  dataPort: number;
  queryPort: number;
  ftpPort: number;
  ftpUser: string;
  /** A new FTP password. Empty means "keep the saved password". */
  ftpPassword: string;
  /** True after the user clicks "Remove password" */
  removeFtpPassword: boolean;
  macros: MacroConfig[];
  // MTConnect-specific
  mtConnectPort: number;
  mtConnectDeviceId: string;
  agentType: string;
  // FANUC-specific
  focasPort: number;
  // Text, because the input can be empty
  toolNumberVariable: string;
  partCounterVariable: string;
  ignoredMessageTypes: string[];
  // Siemens-specific
  opcuaPort: number;
  /** Empty for an anonymous login */
  opcuaUser: string;
  /** A new OPC UA password. Empty means "keep the saved password". */
  opcuaPassword: string;
  /** True after the user clicks "Remove password" */
  removeOpcuaPassword: boolean;
  opcuaSecurity: OpcUaSecurity;
}

export const DEFAULT_PORTS = {
  brotherData: 10000,
  haasData: 9998,
  haasQuery: 5051,
  ftp: 21,
  focas: 8193,
  opcua: DEFAULT_OPCUA_PORT,
} as const;

const DEFAULT_FTP_USER = 'anonymous';
const DEFAULT_AGENT_TYPE = 'generic';

export const EMPTY_EDIT_FORM: EditFormState = {
  name: '',
  host: '',
  dataPort: DEFAULT_PORTS.brotherData,
  queryPort: DEFAULT_PORTS.haasQuery,
  ftpPort: DEFAULT_PORTS.ftp,
  ftpUser: DEFAULT_FTP_USER,
  ftpPassword: '',
  removeFtpPassword: false,
  macros: [],
  mtConnectPort: DEFAULT_MTCONNECT_PORT,
  mtConnectDeviceId: '',
  agentType: DEFAULT_AGENT_TYPE,
  focasPort: DEFAULT_PORTS.focas,
  toolNumberVariable: '',
  partCounterVariable: '',
  ignoredMessageTypes: [],
  opcuaPort: DEFAULT_PORTS.opcua,
  opcuaUser: '',
  opcuaPassword: '',
  removeOpcuaPassword: false,
  opcuaSecurity: 'none',
};

/** Fill the form from the machine's saved settings */
export function editFormFromMachine(machine: Machine): EditFormState {
  const common: EditFormState = {
    ...EMPTY_EDIT_FORM,
    name: machine.name,
    host: machine.host,
    ftpPort: machine.ftpPort || DEFAULT_PORTS.ftp,
    ftpUser: machine.ftpUser || DEFAULT_FTP_USER,
    macros: machine.macros || [],
  };

  switch (machine.type) {
    case 'brother':
      return { ...common, dataPort: machine.dataPort || DEFAULT_PORTS.brotherData };
    case 'haas':
      return {
        ...common,
        dataPort: machine.dataPort || DEFAULT_PORTS.haasData,
        queryPort: machine.queryPort || DEFAULT_PORTS.haasQuery,
      };
    case 'mtconnect':
      return {
        ...common,
        mtConnectPort: machine.mtConnectPort || DEFAULT_MTCONNECT_PORT,
        mtConnectDeviceId: machine.mtConnectDeviceId || '',
        agentType: machine.agentType || DEFAULT_AGENT_TYPE,
      };
    case 'fanuc':
      return {
        ...common,
        focasPort: machine.focasPort || DEFAULT_PORTS.focas,
        toolNumberVariable: machine.toolNumberVariable?.toString() || '',
        partCounterVariable: machine.partCounterVariable?.toString() || '',
        ignoredMessageTypes: (machine.ignoredMessageTypes || []).map(String),
      };
    case 'siemens':
      return {
        ...common,
        opcuaPort: machine.opcuaPort || DEFAULT_PORTS.opcua,
        opcuaUser: machine.opcuaUser || '',
        opcuaSecurity: machine.opcuaSecurity || 'none',
      };
  }
}

/**
 * The server never sends a saved password back, so the form only says what to change:
 * a new password, an empty one to remove it, or nothing to keep it.
 */
function passwordChange(newPassword: string, remove: boolean): string | undefined {
  if (newPassword !== '') return newPassword;
  if (remove) return '';
  return undefined;
}

/**
 * The form as the server wants it: the message types become numbers, and bad entries are dropped.
 * A macro row with no location yet is not sent.
 * An empty password box keeps the saved password.
 */
export function editFormToUpdate(form: EditFormState) {
  const { ftpPassword, removeFtpPassword, opcuaPassword, removeOpcuaPassword, ...fields } = form;
  const newFtpPassword = passwordChange(ftpPassword, removeFtpPassword);
  const newOpcuaPassword = passwordChange(opcuaPassword, removeOpcuaPassword);
  return {
    ...fields,
    ...(newFtpPassword !== undefined && { ftpPassword: newFtpPassword }),
    ...(newOpcuaPassword !== undefined && { opcuaPassword: newOpcuaPassword }),
    macros: form.macros.filter(macro => Number.isInteger(macro.location)),
    ignoredMessageTypes: form.ignoredMessageTypes
      .map(text => parseInt(text, 10))
      .filter(number => !isNaN(number)),
  };
}

/** After a save, the typed passwords are gone from the page. The server now has them. */
export function withoutPasswordChange(form: EditFormState): EditFormState {
  return { ...form, ftpPassword: '', removeFtpPassword: false, opcuaPassword: '', removeOpcuaPassword: false };
}

/** The text under a password box. It tells what happens to the password on save. */
function passwordHint(newPassword: string, remove: boolean, hasSavedPassword: boolean): string {
  if (newPassword !== '') return 'This new password is saved when you click Save changes.';
  if (remove) return 'The saved password is removed when you click Save changes.';
  if (hasSavedPassword) return 'A password is saved. Leave this empty to keep it.';
  return 'No password is saved.';
}

export function ftpPasswordHint(form: EditFormState, hasSavedPassword: boolean): string {
  return passwordHint(form.ftpPassword, form.removeFtpPassword, hasSavedPassword);
}

export function opcuaPasswordHint(form: EditFormState, hasSavedPassword: boolean): string {
  return passwordHint(form.opcuaPassword, form.removeOpcuaPassword, hasSavedPassword);
}
