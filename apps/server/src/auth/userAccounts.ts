import type { Role, UserToAdd } from '@local-chatter/shared';
import { hashPassword } from './passwords.js';
import type { SessionStore } from './sessionStore.js';
import type { User, UserStore } from './userStore.js';

/**
 * What an admin does on the Users and roles tab: add users, change their roles,
 * set a new password for them, and remove them.
 * A new role takes effect at the next request, because each request reads the role again.
 */
export class UserAccounts {
  constructor(private readonly users: UserStore, private readonly sessions: SessionStore) {}

  /** Sorted by username */
  list(): User[] {
    return this.users.list();
  }

  /** Throws UsernameTakenError */
  async add({ username, password, role }: UserToAdd): Promise<User> {
    return this.users.add({ username, passwordHash: await hashPassword(password), role });
  }

  /** Returns false when there is no such user. Throws LastAdminError. */
  changeRole(id: number, role: Role): boolean {
    return this.users.setRole(id, role);
  }

  /** Returns false when there is no such user. Each browser of the user is logged out. */
  async setPassword(id: number, password: string): Promise<boolean> {
    const passwordHash = await hashPassword(password);
    // Read the user after the slow hash, because an admin can remove the user while it runs
    if (!this.users.find(id)) return false;
    this.users.setPasswordHash(id, passwordHash);
    this.sessions.deleteAllOf(id);
    return true;
  }

  /** Returns false when there is no such user. Throws LastAdminError. Each browser of the user is logged out. */
  remove(id: number): boolean {
    if (!this.users.remove(id)) return false;
    this.sessions.deleteAllOf(id);
    return true;
  }
}
