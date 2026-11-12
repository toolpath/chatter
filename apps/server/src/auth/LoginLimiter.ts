/**
 * Slows down password guessing.
 * After too many wrong passwords from one address, that address must wait.
 */

/** After this many wrong passwords, the address must wait */
export const MAX_FAILURES = 10;
/** How long an address must wait, from its first wrong password */
export const LOCK_MINUTES = 15;
const WINDOW_MS = LOCK_MINUTES * 60 * 1000;
/** The list never gets longer than this. When it is full, the oldest entry goes. */
const MAX_TRACKED_ADDRESSES = 1000;

interface Failures {
  count: number;
  firstAt: number;
  /** The username of the last try */
  username: string;
  /** True after the first try while the address is locked */
  hasBlockedTry?: boolean;
}

/** An address that must wait before it can try a password again */
export interface LockedAddress {
  address: string;
  /** The username of the last try before the lock */
  username: string;
  /** The address can try again at this time */
  until: Date;
}

const isLocked = (entry: Failures) => entry.count >= MAX_FAILURES;

export class LoginLimiter {
  private readonly failures = new Map<string, Failures>();

  constructor(private readonly now: () => number = Date.now) {}

  isBlocked(address: string): boolean {
    const entry = this.currentEntry(address);
    return entry !== undefined && isLocked(entry);
  }

  /**
   * Call it for each try that isBlocked() stopped.
   * Returns true only for the first one of each lock, so a computer that keeps trying cannot fill the login log.
   */
  isFirstBlockedTry(address: string): boolean {
    const entry = this.currentEntry(address);
    if (!entry || entry.hasBlockedTry) return false;
    entry.hasBlockedTry = true;
    return true;
  }

  /**
   * Count one password try. Call it before the (slow) password check,
   * so many tries sent at the same time cannot all get past isBlocked().
   * A good password then removes the count with recordSuccess().
   */
  recordAttempt(address: string, username: string): void {
    const entry = this.currentEntry(address);
    if (entry) {
      entry.count++;
      entry.username = username;
      return;
    }
    this.makeRoom();
    this.failures.set(address, { count: 1, firstAt: this.now(), username });
  }

  recordSuccess(address: string): void {
    this.failures.delete(address);
  }

  /** The addresses that must wait now, the oldest lock first */
  lockedAddresses(): LockedAddress[] {
    return [...this.failures]
      .filter(([, entry]) => !this.isExpired(entry) && isLocked(entry))
      .map(([address, entry]) => ({ address, username: entry.username, until: new Date(entry.firstAt + WINDOW_MS) }));
  }

  /** Let the address try again now. An admin does this for a person who forgot the password. */
  unlock(address: string): void {
    this.failures.delete(address);
  }

  private currentEntry(address: string): Failures | undefined {
    const entry = this.failures.get(address);
    if (entry && this.isExpired(entry)) {
      this.failures.delete(address);
      return undefined;
    }
    return entry;
  }

  private isExpired(entry: Failures): boolean {
    return this.now() - entry.firstAt > WINDOW_MS;
  }

  private makeRoom(): void {
    if (this.failures.size < MAX_TRACKED_ADDRESSES) return;
    for (const [address, entry] of this.failures) {
      if (this.isExpired(entry)) this.failures.delete(address);
    }
    // A Map keeps the order of insertion, so the first key is the oldest
    const oldest = this.failures.keys().next();
    if (this.failures.size >= MAX_TRACKED_ADDRESSES && !oldest.done) this.failures.delete(oldest.value);
  }
}
