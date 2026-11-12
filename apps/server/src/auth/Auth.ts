import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Role } from '@local-chatter/shared';
import { hashPassword, passwordMatches } from './passwords.js';
import type { Session, SessionClient, SessionStore } from './sessionStore.js';
import type { StoredUser, UserStore } from './userStore.js';

/** A username and a password, as a person or a program sends them */
export interface Login {
  username: string;
  password: string;
}

/** The user who sent a request */
export interface CurrentUser {
  id: number;
  username: string;
  role: Role;
}

/** A browser session, and the user that it belongs to */
export interface UserSession extends Session {
  user: CurrentUser;
}

/** The current password and the new one, as the "Your account" tab sends them */
export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
}

/** The last program login of a user that matched */
interface KnownLogin {
  /** A SHA-256 digest of the username and the password */
  digest: Buffer;
  /** The password hash at that time. When the password changes, the known login stops. */
  passwordHash: string;
}

/** The length of the random password behind the hash for a username that does not exist */
const MISSING_USER_PASSWORD_BYTES = 16;

// A username has no line breaks (the schema refuses control characters), so this text is never ambiguous
const digestOf = (login: Login) =>
  createHash('sha256').update(`${login.username.toLowerCase()}\n${login.password}`).digest();

const currentUserOf = ({ id, username, role }: StoredUser): CurrentUser => ({ id, username, role });

/**
 * Logins to Chatter: the first-run setup, browser sessions, and the password checks for programs.
 * The first visitor makes the first admin. People log in with a username and a password,
 * and programs send them with each request.
 *
 * The users are read from the store on each check (a fast SQLite read),
 * so a new role or a reset from the command line takes effect at once.
 */
export class Auth {
  /** For each user id, so each request of a program does not run the slow scrypt */
  private readonly knownLogins = new Map<number, KnownLogin>();
  /** A password hash to check against when the username does not exist. It is made at the start, so no request waits for it. */
  private readonly hashForMissingUser = hashPassword(randomBytes(MISSING_USER_PASSWORD_BYTES).toString('hex'));

  constructor(private readonly users: UserStore, private readonly sessions: SessionStore) {}

  /** False until the first admin exists */
  isSetUp(): boolean {
    return this.users.hasAdmin();
  }

  /**
   * Make the first admin. Returns a session token, or null when an admin exists already.
   * Throws UsernameTakenError.
   */
  async setUp({ username, password }: Login, client: SessionClient): Promise<string | null> {
    if (this.isSetUp()) return null;
    const passwordHash = await hashPassword(password);
    // Two setup requests can run at the same time. The first one to save wins.
    const admin = this.users.addFirstAdmin({ username, passwordHash });
    return admin && this.startSession(admin.id, client);
  }

  /** Returns a session token, or null when the username or the password is wrong */
  async logIn(login: Login, client: SessionClient): Promise<string | null> {
    const user = await this.matchingUser(login);
    return user && this.isStillSaved(user) ? this.startSession(user.id, client) : null;
  }

  /** Returns a new session token, or null when the current password is wrong. The other sessions of the user stop. */
  async changePassword(
    user: CurrentUser,
    { currentPassword, newPassword }: PasswordChange,
    client: SessionClient,
  ): Promise<string | null> {
    const stored = await this.matchingUser({ username: user.username, password: currentPassword });
    if (!stored) return null;
    const passwordHash = await hashPassword(newPassword);
    if (!this.isStillSaved(stored)) return null;
    this.users.setPasswordHash(stored.id, passwordHash);
    this.sessions.deleteAllOf(stored.id);
    return this.sessions.create(stored.id, client);
  }

  /** The browsers where this user is logged in, the newest use first */
  browserSessions(user: CurrentUser): Session[] {
    return this.sessions.listOf(user.id);
  }

  /** Save that the browser was used now, from this address */
  markSeen(session: Session, address: string): void {
    this.sessions.markSeen(session, address);
  }

  logOut(session: Session): void {
    this.sessions.delete(session.id);
  }

  logOutOtherBrowsers(session: Session): void {
    this.sessions.deleteOthersOf(session);
  }

  /** True when a user has this username. Only the login log uses it: a login reply never tells it. */
  hasUser(username: string): boolean {
    return this.users.findByName(username) !== null;
  }

  /** The session of a token, or null when the token is not valid or the user was removed */
  sessionOf(token: string): UserSession | null {
    const session = this.sessions.find(token);
    const user = session && this.users.find(session.userId);
    return user ? { ...session, user: currentUserOf(user) } : null;
  }

  /**
   * The user of a login that matched before, or null. This check is fast and is not a guess,
   * so a program with the right login keeps working while its address is blocked for wrong tries.
   */
  knownUserOf(login: Login): CurrentUser | null {
    const user = this.users.findByName(login.username);
    const known = user && this.knownLogins.get(user.id);
    if (!known || known.passwordHash !== user.passwordHash) return null;
    return timingSafeEqual(known.digest, digestOf(login)) ? currentUserOf(user) : null;
  }

  /** The user of a program login, or null when the login is wrong */
  async userOf(login: Login): Promise<CurrentUser | null> {
    const known = this.knownUserOf(login);
    if (known) return known;
    const user = await this.matchingUser(login);
    if (!user) return null;
    this.knownLogins.set(user.id, { digest: digestOf(login), passwordHash: user.passwordHash });
    this.users.markLoggedIn(user.id);
    return currentUserOf(user);
  }

  private startSession(userId: number, client: SessionClient): string {
    this.users.markLoggedIn(userId);
    return this.sessions.create(userId, client);
  }

  /**
   * The password check is slow, so the password can change or the user can be removed while it runs.
   * Then the check used an old password hash, and it must not start a session.
   */
  private isStillSaved(user: StoredUser): boolean {
    return this.users.find(user.id)?.passwordHash === user.passwordHash;
  }

  private async matchingUser({ username, password }: Login): Promise<StoredUser | null> {
    const user = this.users.findByName(username);
    // The password is always checked, so a wrong username takes as long as a wrong password
    const passwordIsRight = await passwordMatches(password, user?.passwordHash ?? (await this.hashForMissingUser));
    return user && passwordIsRight ? user : null;
  }
}
