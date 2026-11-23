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
