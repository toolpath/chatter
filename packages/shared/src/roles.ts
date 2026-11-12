/**
 * The roles of the Chatter users, and what each role can do.
 * The server checks these rules on each request. The web app uses them to hide what a user cannot do.
 * Each user that is logged in can see the machines and their history, and download files.
 */

/** From the fewest rights to the most */
export const ROLES = ['viewer', 'operator', 'admin'] as const;
export type Role = typeof ROLES[number];

/**
 * send-files: send files to a machine, and delete files on it.
 * manage-machines: add, change, and remove machines, and scan the network for them.
 * manage-chatter: add users and change their roles, and change the HTTPS, proxy, and login settings.
 * manage-updates: update Chatter to a new version (Settings > Updates). Chatter stops during the install.
 */
export const PERMISSIONS = ['send-files', 'manage-machines', 'manage-chatter', 'manage-updates'] as const;
export type Permission = typeof PERMISSIONS[number];

const PERMISSIONS_OF: Record<Role, readonly Permission[]> = {
  viewer: [],
  operator: ['send-files'],
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
