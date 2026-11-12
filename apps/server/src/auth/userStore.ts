import Database from 'better-sqlite3';
import type { Role } from '@local-chatter/shared';
import { SettingsTable } from '../storage/settingsTable.js';

/** A Chatter user, as the Users and roles tab shows it */
export interface User {
  id: number;
  username: string;
  role: Role;
  createdAt: Date;
  /** Null until the first login */
  lastLoginAt: Date | null;
}

/** A user and the hash of their password */
export interface StoredUser extends User {
  passwordHash: string;
}

/** What it takes to make a user */
export interface NewUser {
  username: string;
  passwordHash: string;
  role: Role;
}

export class UsernameTakenError extends Error {
  constructor() {
    super('A user with this username exists already');
  }
}

/** Chatter must keep at least one admin, or nobody can add users or change the settings */
export class LastAdminError extends Error {
  constructor() {
    super('Chatter must keep at least one admin. Make another user an admin first.');
  }
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  created_at: number;
  last_login_at: number | null;
}

/** Older versions kept their one account in the "settings" table, with these keys */
const OLD_ACCOUNT_KEYS = { username: 'username', passwordHash: 'password_hash' };
/** Older versions signed the login cookies with this secret */
const OLD_SESSION_SECRET = 'session_secret';

/**
 * The users, in the "users" table of the SQLite database.
 * A username does not care about upper and lower case, so "Sam" and "sam" are the same user.
 */
export class UserStore {
  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {
    // AUTOINCREMENT: a new user never gets the id of a removed user, so old sessions cannot belong to them
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      )
    `);
    this.moveOldAccount();
  }

  /** For tests: the users are kept in memory only */
  static inMemory(now?: () => number): UserStore {
    return new UserStore(new Database(':memory:'), now);
  }

  hasAdmin(): boolean {
    return this.db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get() !== undefined;
  }

  find(id: number): StoredUser | null {
    const row = this.rowOf(id);
    return row ? toStoredUser(row) : null;
  }

  findByName(username: string): StoredUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    return row ? toStoredUser(row) : null;
  }

  /** Sorted by username */
  list(): User[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as UserRow[];
    return rows.map(toUser);
  }

  /** Throws UsernameTakenError */
  add(user: NewUser): User {
    return this.db.transaction(() => this.insert(user))();
  }

  /**
   * Make the first admin, at the first-run setup.
   * Returns null when an admin exists already. Throws UsernameTakenError.
   */
  addFirstAdmin(user: Omit<NewUser, 'role'>): User | null {
    return this.db.transaction(() => (this.hasAdmin() ? null : this.insert({ ...user, role: 'admin' })))();
  }

  setPasswordHash(id: number, passwordHash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  }

  /** Returns false when there is no such user. Throws LastAdminError. */
  setRole(id: number, role: Role): boolean {
    return this.db.transaction(() => {
      const user = this.find(id);
      if (!user) return false;
      if (role !== 'admin') this.keepAnAdminBesides(user);
      this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
      return true;
    })();
  }

  /** Returns false when there is no such user. Throws LastAdminError. */
  remove(id: number): boolean {
    return this.db.transaction(() => {
      const user = this.find(id);
      if (!user) return false;
      this.keepAnAdminBesides(user);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return true;
    })();
  }

  /** For the password reset from the command line. The other users stay. */
  removeAdmins(): void {
    this.db.prepare("DELETE FROM users WHERE role = 'admin'").run();
  }

  markLoggedIn(id: number): void {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(this.now(), id);
  }

  private insert({ username, passwordHash, role }: NewUser): User {
    if (this.findByName(username)) throw new UsernameTakenError();
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .run(username, passwordHash, role, this.now());
    return toUser(this.rowOf(Number(lastInsertRowid))!);
  }

  private rowOf(id: number): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  private hasUsers(): boolean {
    return this.db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined;
  }

  private keepAnAdminBesides(user: User): void {
    if (user.role !== 'admin') return;
    const otherAdmin = this.db.prepare("SELECT 1 FROM users WHERE role = 'admin' AND id != ? LIMIT 1").get(user.id);
    if (!otherAdmin) throw new LastAdminError();
  }

  /** The account of an older version becomes the first admin */
  private moveOldAccount(): void {
    const settings = new SettingsTable(this.db);
    const username = settings.get(OLD_ACCOUNT_KEYS.username);
    const passwordHash = settings.get(OLD_ACCOUNT_KEYS.passwordHash);
    this.db.transaction(() => {
      if (username && passwordHash && !this.hasUsers()) this.insert({ username, passwordHash, role: 'admin' });
      settings.delete([OLD_ACCOUNT_KEYS.username, OLD_ACCOUNT_KEYS.passwordHash, OLD_SESSION_SECRET]);
    })();
  }
}

function toUser({ id, username, role, created_at, last_login_at }: UserRow): User {
  return {
    id,
    username,
    role,
    createdAt: new Date(created_at),
    lastLoginAt: last_login_at === null ? null : new Date(last_login_at),
  };
}

function toStoredUser(row: UserRow): StoredUser {
  return { ...toUser(row), passwordHash: row.password_hash };
}
