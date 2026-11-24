import { addressGroup } from './addressGroup.js';
import { createLogger } from '../logging/logger.js';
import { maskUnknownUsername } from './unknownUsername.js';

const log = createLogger('auth');

/**
 * Slows down password guessing. It keeps three counts of the password tries:
 * - For each address and username. After 10 tries, that address must wait before it can try that user again.
 *   The other users of a shared address (NAT, a proxy, Docker Desktop) can still log in.
 * - For each username, from all addresses. After 30 tries, nobody can try that user until the lock ends.
 *   This stops a guess of one password from many computers.
 * - For each known device: a browser with a valid device cookie for the user (see deviceCookie.ts).
 *   Its tries count only here, and the two counts above do not stop it. After 10 tries, that browser must wait.
 *   So a person on the network who locks a user cannot lock that user out of their own browser.
 *
 * Each try counts before the password check, so tries sent at the same time cannot all get past the limit.
 * A good password removes the count of that address and that username, and takes its own try back off the count of the username.
 * So good logins never lock a user, and a person who knows one password cannot reset the guesses at another.
 * An IPv6 address counts as its /64 (see addressGroup).
 */

/** After this many wrong passwords for one user, the address must wait */
export const MAX_FAILURES = 10;
/**
 * After this many wrong passwords for one user from all addresses, the user is locked everywhere.
 * It is higher than MAX_FAILURES, so one computer alone cannot lock a user out. A person who
 * controls 3 or more addresses can lock a user for LOCK_MINUTES. Sessions and the known logins
 * of programs still work during the lock, and an admin can unlock the user.
 */
export const MAX_USER_FAILURES = 30;
/** After this many wrong passwords from one known device, that device must wait. A stolen cookie gives no more guesses than this. */
export const MAX_DEVICE_FAILURES = 10;
/**
 * The server log and the audit log write at most this many tries with an unknown username from one address in LOCK_MINUTES.
 * The limiter does not stop tries with new usernames, so without this limit one computer could push all older lines out of the log files.
 * When that time ends, the logs write the count of the other tries (takeEndedUnknownUserFloods).
 */
export const MAX_LOGGED_UNKNOWN_USERS = 20;
/** How long the lock lasts, from the first wrong password */
export const LOCK_MINUTES = 15;
const WINDOW_MS = LOCK_MINUTES * 60 * 1000;
/** Each list never gets longer than this. When it is full, an entry with the fewest tries goes. */
const MAX_TRACKED = 1000;

/** The username as the login reads it: the user store ignores upper and lower case, and the login form trims it */
const normalUsername = (username: string) => username.trim().toLowerCase();

interface Failures {
  count: number;
  firstAt: number;
  /** True after the first try while the entry is locked */
  hasBlockedTry?: boolean;
}

interface AddressFailures extends Failures {
  /** The address group, as addressGroup gives it */
  address: string;
  username: string;
}

interface UserFailures extends Failures {
  username: string;
}

/** The tries with an unknown username from one address group */
interface UnknownUserTries extends Failures {
  address: string;
}

/** An address that must wait before it can try a password for this user again */
export interface LockedAddress {
  /** An IPv4 address, or an IPv6 /64 like "2001:db8:1:2::/64" */
  address: string;
  username: string;
  /** The address can try again at this time */
  until: Date;
}

/** A user that nobody can try a password for, from any address */
export interface LockedUser {
  username: string;
  until: Date;
}

/** The tries with unknown usernames from one address group that the logs did not write one by one */
export interface UnknownUserFlood {
  /** The address group, as addressGroup gives it */
  address: string;
  notLogged: number;
}

/**
 * The counts for one kind of key. It forgets old entries, and it never gets longer than MAX_TRACKED.
 * `onEnd` gets each entry that it forgets because its time ended or because the list is full.
 */
class FailureCounts<Entry extends Failures> {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number,
    private readonly limit: number,
    private readonly onEnd: (entry: Entry) => void = () => {},
  ) {}

  current(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry && this.isExpired(entry)) {
      this.end(key, entry);
      return undefined;
    }
    return entry;
  }

  /** Forget each entry whose time ended */
  endExpired(): void {
    for (const [key, entry] of this.entries) if (this.isExpired(entry)) this.end(key, entry);
  }

  isLocked(key: string): boolean {
    const entry = this.current(key);
    return entry !== undefined && entry.count >= this.limit;
  }

  /** True only for the first call while the entry is locked */
  isFirstBlockedTry(key: string): boolean {
    const entry = this.current(key);
    if (!entry || entry.count < this.limit || entry.hasBlockedTry) return false;
    entry.hasBlockedTry = true;
    return true;
  }

  /** Count one try. Returns the new count. */
  add(key: string, fields: Omit<Entry, keyof Failures>): number {
    const entry = this.current(key);
    if (entry) return ++entry.count;
    this.makeRoom();
    this.entries.set(key, { ...fields, count: 1, firstAt: this.now() } as Entry);
    return 1;
  }

  /** Take one try back off the count. The entry goes when its count is 0. */
  undo(key: string): void {
    const entry = this.current(key);
    if (!entry) return;
    entry.count--;
    if (entry.count <= 0) this.entries.delete(key);
    else if (entry.count < this.limit) entry.hasBlockedTry = false;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  deleteWhere(matches: (entry: Entry) => boolean): void {
    for (const [key, entry] of this.entries) if (matches(entry)) this.entries.delete(key);
  }

  /** The locked entries, the oldest first */
  locked(): (Entry & { until: Date })[] {
    return [...this.entries.values()]
      .filter(entry => !this.isExpired(entry) && entry.count >= this.limit)
      .map(entry => ({ ...entry, until: new Date(entry.firstAt + WINDOW_MS) }));
  }

  private isExpired(entry: Failures): boolean {
    return this.now() - entry.firstAt > WINDOW_MS;
  }

  private end(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.onEnd(entry);
  }

  /**
   * Remove the old entries. When the list is still full, remove the oldest entry with the fewest tries.
   * So many new usernames cannot push out the count of a user that someone guesses at.
   */
  private makeRoom(): void {
    if (this.entries.size < MAX_TRACKED) return;
    this.endExpired();
    if (this.entries.size < MAX_TRACKED) return;
    let fewest: [string, Entry] | undefined;
    // A Map keeps the order of insertion, so the first entry with the fewest tries is the oldest of them
    for (const item of this.entries) if (!fewest || item[1].count < fewest[1].count) fewest = item;
    if (fewest) this.end(...fewest);
  }
}

/** One key for each address group and username. JSON keeps the two parts apart, whatever text they have. */
const addressKey = (address: string, username: string) => JSON.stringify([addressGroup(address), normalUsername(username)]);

/**
 * Each method takes `device`: the device ID of a valid device cookie for this username, or undefined.
 * With a device, only the count of that device is used.
 */
export class LoginLimiter {
  private readonly byAddress: FailureCounts<AddressFailures>;
  private readonly byUser: FailureCounts<UserFailures>;
  private readonly byDevice: FailureCounts<UserFailures>;
  private readonly unknownUsers: FailureCounts<UnknownUserTries>;
  private endedFloods: UnknownUserFlood[] = [];

  /**
   * @param nameInLog The username for the warning when a user lock starts. It can be a password, so with no function the
   * warning masks each username. app.ts gives the full name of a user that exists. The counts always use the full username.
   */
  constructor(now: () => number = Date.now, private readonly nameInLog: (username: string) => string = maskUnknownUsername) {
    this.byAddress = new FailureCounts(now, MAX_FAILURES);
    this.byUser = new FailureCounts(now, MAX_USER_FAILURES);
    this.byDevice = new FailureCounts(now, MAX_DEVICE_FAILURES);
    this.unknownUsers = new FailureCounts(now, MAX_LOGGED_UNKNOWN_USERS, ({ address, count }) => {
      if (count > MAX_LOGGED_UNKNOWN_USERS) this.endedFloods.push({ address, notLogged: count - MAX_LOGGED_UNKNOWN_USERS });
    });
  }

  /**
   * Count one try with an unknown username from this address. Returns the count of its address group in LOCK_MINUTES.
   * It only tells the server log when to stop. It does not block the address.
   */
  countUnknownUser(address: string): number {
    const group = addressGroup(address);
    return this.unknownUsers.add(group, { address: group });
  }

  /**
   * The address groups whose LOCK_MINUTES ended with more than MAX_LOGGED_UNKNOWN_USERS tries with an unknown username,
   * each one time, with the count of the tries that had no line. So the logs count each try.
   */
  takeEndedUnknownUserFloods(): UnknownUserFlood[] {
    this.unknownUsers.endExpired();
    const ended = this.endedFloods;
    this.endedFloods = [];
    return ended;
  }

  isBlocked(address: string, username: string, device?: string): boolean {
    if (device !== undefined) return this.byDevice.isLocked(device);
    return this.byAddress.isLocked(addressKey(address, username)) || this.byUser.isLocked(normalUsername(username));
  }

  /**
   * Call it for each try that isBlocked() stopped.
   * Returns true only for the first one of each lock, so a computer that keeps trying cannot fill the login log.
   */
  isFirstBlockedTry(address: string, username: string, device?: string): boolean {
    if (device !== undefined) return this.byDevice.isFirstBlockedTry(device);
    const forAddress = this.byAddress.isFirstBlockedTry(addressKey(address, username));
    const forUser = this.byUser.isFirstBlockedTry(normalUsername(username));
    return forAddress || forUser;
  }

  /**
   * Count one password try. Call it before the (slow) password check,
   * so many tries sent at the same time cannot all get past isBlocked().
   * A good password then takes its try back with recordSuccess().
   */
  recordAttempt(address: string, username: string, device?: string): void {
    const user = normalUsername(username);
    if (device !== undefined) {
      this.byDevice.add(device, { username: user });
      return;
    }
    const group = addressGroup(address);
    this.byAddress.add(addressKey(address, username), { address: group, username: user });
    const count = this.byUser.add(user, { username: user });
    // Anyone on the network can start this lock, so the log tells the admin who did it
    if (count === MAX_USER_FAILURES) log.warn('User locked on all addresses after too many password tries', { username: this.nameInLog(user), address: group, count });
  }

  /**
   * Forget the tries of this address for this user only.
   * The count of the user on all addresses loses only this good try, so it keeps the wrong passwords from other addresses.
   */
  recordSuccess(address: string, username: string, device?: string): void {
    if (device !== undefined) {
      this.byDevice.delete(device);
      return;
    }
    this.byAddress.delete(addressKey(address, username));
    this.byUser.undo(normalUsername(username));
  }

  /** The addresses that must wait now, the oldest lock first */
  lockedAddresses(): LockedAddress[] {
    return this.byAddress.locked().map(({ address, username, until }) => ({ address, username, until }));
  }

  /** The users that are locked on all addresses now, the oldest lock first */
  lockedUsers(): LockedUser[] {
    return this.byUser.locked().map(({ username, until }) => ({ username, until }));
  }

  /** Let the address try again now, for each user. An admin does this for a person who forgot the password. */
  unlock(address: string): void {
    const group = addressGroup(address);
    this.byAddress.deleteWhere(entry => entry.address === group);
  }

  /** Let each address and each known device try this user again now */
  unlockUser(username: string): void {
    const user = normalUsername(username);
    this.byUser.delete(user);
    this.byDevice.deleteWhere(entry => entry.username === user);
  }
}
