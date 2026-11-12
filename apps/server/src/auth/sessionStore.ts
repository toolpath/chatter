import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';

/**
 * A session is one browser that is logged in.
 * The browser keeps a random token in its cookie. The database keeps only a hash of the token
 * (a fingerprint that cannot be turned back into the token), so a copy of the database cannot log anyone in.
 */

export const SESSION_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
const SESSION_LIFETIME_MS = SESSION_LIFETIME_SECONDS * 1000;
/** A login past this many sessions of one user removes their session that was used the longest time ago */
export const MAX_SESSIONS = 50;
/** The "last seen" time is saved at most this often, so each request does not write to the database */
export const SEEN_INTERVAL_MS = 60 * 1000;
/** A browser can send a very long User-Agent header */
const MAX_USER_AGENT_LENGTH = 256;
const MAX_ADDRESS_LENGTH = 64;
/** 32 random bytes (256 bits): nobody can guess a token */
const TOKEN_BYTES = 32;

/** The browser that logs in */
export interface SessionClient {
  /** The User-Agent header, which names the browser and the computer */
  userAgent: string;
  address: string;
}

export interface Session extends SessionClient {
  /** The hash of the token */
  id: string;
  /** The user who logged in */
  userId: number;
  createdAt: Date;
  lastSeenAt: Date;
}

interface SessionRow {
  id: string;
  user_id: number;
  user_agent: string;
  address: string;
  created_at: number;
  last_seen_at: number;
}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');
const shortAddress = (address: string) => address.slice(0, MAX_ADDRESS_LENGTH);

/** The browsers that are logged in, in the "sessions" table of the SQLite database */
export class SessionStore {
  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {
    dropSessionsWithoutUsers(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        user_agent TEXT NOT NULL,
        address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id)');
  }

  /** For tests: the sessions are kept in memory only */
  static inMemory(now?: () => number): SessionStore {
    return new SessionStore(new Database(':memory:'), now);
  }

  /** Start a session for a user. Returns the token for the browser cookie. */
  create(userId: number, { userAgent, address }: SessionClient): string {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const now = this.now();
    this.db.transaction(() => {
      this.removeExpired();
      this.db
        .prepare('INSERT INTO sessions (id, user_id, user_agent, address, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(hashOf(token), userId, userAgent.slice(0, MAX_USER_AGENT_LENGTH), shortAddress(address), now, now);
      this.removeLeastRecentlySeen(userId);
    })();
    return token;
  }

  /** The session of this token, or null when it was logged out or is too old */
  find(token: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(hashOf(token)) as SessionRow | undefined;
    if (!row || this.isExpired(row)) return null;
    return toSession(row);
  }

  /** The sessions of a user, the newest use first */
  listOf(userId: number): Session[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE user_id = ? AND created_at > ? ORDER BY last_seen_at DESC')
      .all(userId, this.oldestValidCreation()) as SessionRow[];
    return rows.map(toSession);
  }

  /** Save that the browser was used now, from this address. Skips the write when it was saved a short time ago. */
  markSeen(session: Session, address: string): void {
    const isRecent = this.now() - session.lastSeenAt.getTime() < SEEN_INTERVAL_MS;
    if (isRecent && address === session.address) return;
    this.db
      .prepare('UPDATE sessions SET last_seen_at = ?, address = ? WHERE id = ?')
      .run(this.now(), shortAddress(address), session.id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Delete the other sessions of the same user */
  deleteOthersOf(session: Session): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(session.userId, session.id);
  }

  deleteAllOf(userId: number): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  deleteAll(): void {
    this.db.prepare('DELETE FROM sessions').run();
  }

  private isExpired(row: SessionRow): boolean {
    return row.created_at <= this.oldestValidCreation();
  }

  private oldestValidCreation(): number {
    return this.now() - SESSION_LIFETIME_MS;
  }

  private removeExpired(): void {
    this.db.prepare('DELETE FROM sessions WHERE created_at <= ?').run(this.oldestValidCreation());
  }

  private removeLeastRecentlySeen(userId: number): void {
    this.db
      .prepare(`
        DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
          SELECT id FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC, created_at DESC LIMIT ?
        )
      `)
      .run(userId, userId, MAX_SESSIONS);
  }
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    userAgent: row.user_agent,
    address: row.address,
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
  };
}

/** Older versions had one account, so their sessions name no user. Those browsers must log in again. */
function dropSessionsWithoutUsers(db: Database.Database): void {
  const columns = db.pragma('table_info(sessions)') as { name: string }[];
  const isOldTable = columns.length > 0 && !columns.some(column => column.name === 'user_id');
  if (isOldTable) db.exec('DROP TABLE sessions');
}
