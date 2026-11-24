/**
 * The roles of the Chatter users, and what each role can do.
 * The server checks these rules on each request. The web app uses them to hide what a user cannot do.
 * Each user that is logged in can see the machines and their history, and the names of the program files.
 */

/** From the fewest rights to the most */
export const ROLES = ['viewer', 'operator', 'admin'] as const;
export type Role = typeof ROLES[number];

/**
 * read-files: download a program file, and read its text (on the machine or in the upload history).
 * send-files: send files to a machine, and delete files on it.
 * sync-tools: tell Chatter to read the tool table of a machine now (the Sync button). Chatter also reads it by itself.
 * manage-machines: add, change, and delete machines, and scan the network for them.
 * manage-chatter: add users and change their roles, and change the HTTPS, proxy, and login settings.
 * manage-updates: update Chatter to a new version (Settings > Updates). Chatter stops during the install.
 */
export const PERMISSIONS = ['read-files', 'send-files', 'sync-tools', 'manage-machines', 'manage-chatter', 'manage-updates'] as const;
export type Permission = typeof PERMISSIONS[number];

const PERMISSIONS_OF: Record<Role, readonly Permission[]> = {
  viewer: [],
  operator: ['read-files', 'send-files', 'sync-tools'],
  admin: PERMISSIONS,
};

/** What an admin types to add a user */
export interface UserToAdd {
  username: string;
  password: string;
  role: Role;
}

export function roleCan(role: Role, permission: Permission): boolean {
  return PERMISSIONS_OF[role].includes(permission);
}

/** Which details of a send of a program a role may see. True means that the role sees the field. */
export interface UploadSenderFields {
  uploaded_by: boolean;
  address: boolean;
}

/**
 * Decision D4: a Viewer does not see who sent a program. An Operator sees who sent it, but only an Admin sees the
 * address of the computer. The server removes the other fields, and the web app shows only these fields.
 */
export function uploadSenderFieldsFor(role: Role): UploadSenderFields {
  return { uploaded_by: roleCan(role, 'read-files'), address: roleCan(role, 'manage-chatter') };
}

/**
 * Decision D4: a Viewer does not see the connection settings of a machine (the address, the ports, the usernames, the
 * security mode and the saved passwords). An Operator and an Admin see them.
 */
export function seesMachineSettings(role: Role): boolean {
  return ROLES.indexOf(role) >= ROLES.indexOf('operator');
}

/**
 * The fields of a machine status that a Viewer gets: what the dashboard and the machine page show, and the warnings.
 * Only these fields: a new field of the status stays hidden from a Viewer until a person adds it here.
 * `macros` are the names of the values that the page shows. `opcuaCertificateChanged` has only the thumbprints of the
 * certificate that the control shows to each device on the network, so it is no secret.
 */
const VIEWER_MACHINE_FIELDS = [
  'id', 'name', 'type', 'connected', 'connecting', 'lastPollTime', 'errors', 'data', 'macros', 'pollTimings',
  'defaultUnit', 'agentType', 'opcuaCertificateChanged', 'opcuaSecurityWarning',
] as const;

/** The parts of a machine that its texts can tell */
export interface MachineAddressParts {
  host?: string;
  ftpUser?: string;
  opcuaUser?: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The text, with "the machine address" in place of the IP address of the machine (and its port), and "the user" in place
 * of each username of the machine. A Viewer gets the errors of a machine in this form (D4).
 */
export function hideMachineAddress(text: string, machine: MachineAddressParts): string {
  let hidden = text;
  if (machine.host) {
    // Not a part of a longer address: 192.168.1.6 is not in 192.168.1.60 or in 10.192.168.1.6
    hidden = hidden.replace(new RegExp(`(?<![\\d.])${escapeRegExp(machine.host)}(?![\\d.])(:\\d+)?`, 'g'), 'the machine address');
  }
  for (const user of [machine.ftpUser, machine.opcuaUser]) {
    if (user?.trim()) hidden = hidden.replace(new RegExp(`(?<![\\w-])${escapeRegExp(user)}(?![\\w-])`, 'g'), 'the user');
  }
  return hidden;
}

/**
 * The machine status that the role may see. An Operator and an Admin get it as it is. A Viewer gets only the fields in
 * VIEWER_MACHINE_FIELDS, and its errors with no address and no username (D4).
 */
export function machineStatusFor<T extends MachineAddressParts & { errors?: string[] }>(role: Role, machine: T): Partial<T> {
  if (seesMachineSettings(role)) return machine;
  const viewed: Record<string, unknown> = {};
  for (const field of VIEWER_MACHINE_FIELDS) {
    if (field in machine) viewed[field] = (machine as Record<string, unknown>)[field];
  }
  if (machine.errors) viewed.errors = machine.errors.map(error => hideMachineAddress(error, machine));
  return viewed as Partial<T>;
}
