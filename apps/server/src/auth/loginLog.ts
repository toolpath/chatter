import Database from 'better-sqlite3';

/** The log keeps only this many tries. When it is full, the oldest try goes. */
export const MAX_LOGGED_TRIES = 50;
/** Longer text is cut. A program can send a very long username in its "Authorization: Basic" header. */
const MAX_TEXT_LENGTH = 64;

/**
 * logged-in: the username and password were right.
 * password-changed: the current password was right, and the password changed.
 * wrong-password: the account exists, but the password was wrong.
 * no-such-user: no account has this username.
 * locked: the computer had too many wrong passwords, so Chatter did not check the password.
 */
export type LoginResult = 'logged-in' | 'password-changed' | 'wrong-password' | 'no-such-user' | 'locked';

/** One password try */
export interface LoginTry {
  at: Date;
  username: string;
  /** The computer that tried */
  address: string;
  result: LoginResult;
}

interface LoginTryRow {
  at: string;
  username: string;
  address: string;
  result: LoginResult;
}

/**
 * The last password tries, saved in the "login_tries" table of the SQLite database.
 * The admin reads them in Settings > Logins.
 */
export class LoginLog {
  constructor(private readonly db: Database.Database, private readonly now: () => Date = () => new Date()) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS login_tries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        username TEXT NOT NULL,
        address TEXT NOT NULL,
        result TEXT NOT NULL
      )
    `);
  }

  /** For tests: the log is kept in memory only, so it is lost when Chatter stops */
  static inMemory(now?: () => Date): LoginLog {
    return new LoginLog(new Database(':memory:'), now);
  }

  record({ username, address, result }: Omit<LoginTry, 'at'>): void {
    const insert = this.db.prepare('INSERT INTO login_tries (at, username, address, result) VALUES (?, ?, ?, ?)');
    const dropOldest = this.db.prepare(
      'DELETE FROM login_tries WHERE id <= (SELECT id FROM login_tries ORDER BY id DESC LIMIT 1 OFFSET ?)',
    );
    this.db.transaction(() => {
      insert.run(this.now().toISOString(), cut(username), cut(address), result);
      dropOldest.run(MAX_LOGGED_TRIES);
    })();
  }

  /** The newest first */
  recent(): LoginTry[] {
    const rows = this.db
      .prepare('SELECT at, username, address, result FROM login_tries ORDER BY id DESC LIMIT ?')
      .all(MAX_LOGGED_TRIES) as LoginTryRow[];
    return rows.map(row => ({ ...row, at: new Date(row.at) }));
  }
}

const cut = (text: string) => text.slice(0, MAX_TEXT_LENGTH);
