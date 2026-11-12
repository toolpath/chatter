import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MAX_SESSIONS, SEEN_INTERVAL_MS, SESSION_LIFETIME_SECONDS, SessionStore } from './sessionStore.js';

const BROWSER = { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130.0', address: '192.168.1.20' };
const SAM = 1;
const JO = 2;

describe('SessionStore', () => {
  it('finds the session of a token, but not of a made-up token', () => {
    const sessions = SessionStore.inMemory();
    const token = sessions.create(SAM, BROWSER);

    expect(sessions.find(token)).toMatchObject(BROWSER);
    expect(sessions.find('made-up-token')).toBeNull();
  });

  it('keeps only a hash of the token in the database', () => {
    const db = new Database(':memory:');
    const token = new SessionStore(db).create(SAM, BROWSER);

    const ids = db.prepare('SELECT id FROM sessions').all() as { id: string }[];
    expect(ids).toHaveLength(1);
    expect(ids[0].id).not.toContain(token);
  });

  it('stops a session after one year', () => {
    let now = 0;
    const sessions = SessionStore.inMemory(() => now);
    const token = sessions.create(SAM, BROWSER);

    now = SESSION_LIFETIME_SECONDS * 1000;
    expect(sessions.find(token)).toBeNull();
    expect(sessions.listOf(SAM)).toEqual([]);
  });

  it('lists the newest use first', () => {
    let now = 0;
    const sessions = SessionStore.inMemory(() => now);
    sessions.create(SAM, { ...BROWSER, address: 'first' });
    now = 1000;
    sessions.create(SAM, { ...BROWSER, address: 'second' });

    expect(sessions.listOf(SAM).map(session => session.address)).toEqual(['second', 'first']);
  });

  it('saves the last use at most one time each minute, but at once for a new address', () => {
    let now = 0;
    const sessions = SessionStore.inMemory(() => now);
    const token = sessions.create(SAM, BROWSER);

    now = SEEN_INTERVAL_MS - 1;
    sessions.markSeen(sessions.find(token)!, BROWSER.address);
    expect(sessions.find(token)!.lastSeenAt.getTime()).toBe(0);

    sessions.markSeen(sessions.find(token)!, '10.0.0.9');
    expect(sessions.find(token)).toMatchObject({ address: '10.0.0.9', lastSeenAt: new Date(now) });
  });

  it(`keeps at most ${MAX_SESSIONS} sessions, and removes the one used the longest time ago`, () => {
    let now = 0;
    const sessions = SessionStore.inMemory(() => now);
    const tokens = Array.from({ length: MAX_SESSIONS + 1 }, () => {
      now += 1000;
      return sessions.create(SAM, BROWSER);
    });

    expect(sessions.listOf(SAM)).toHaveLength(MAX_SESSIONS);
    expect(sessions.find(tokens[0])).toBeNull();
    expect(sessions.find(tokens.at(-1)!)).not.toBeNull();
  });

  it('logs out the other sessions of the same user only', () => {
    const sessions = SessionStore.inMemory();
    const mine = sessions.create(SAM, BROWSER);
    const other = sessions.create(SAM, BROWSER);
    const ofJo = sessions.create(JO, BROWSER);

    sessions.deleteOthersOf(sessions.find(mine)!);
    expect(sessions.find(mine)).not.toBeNull();
    expect(sessions.find(other)).toBeNull();
    expect(sessions.find(ofJo)).not.toBeNull();
  });

  it('logs out each session of one user', () => {
    const sessions = SessionStore.inMemory();
    const ofSam = sessions.create(SAM, BROWSER);
    const ofJo = sessions.create(JO, BROWSER);

    sessions.deleteAllOf(SAM);
    expect(sessions.find(ofSam)).toBeNull();
    expect(sessions.find(ofJo)).not.toBeNull();
  });

  it('lists only the sessions of the user', () => {
    const sessions = SessionStore.inMemory();
    sessions.create(SAM, BROWSER);
    sessions.create(JO, BROWSER);

    expect(sessions.listOf(SAM)).toEqual([expect.objectContaining({ userId: SAM })]);
  });

  it(`does not remove the sessions of other users when one user has ${MAX_SESSIONS}`, () => {
    let now = 0;
    const sessions = SessionStore.inMemory(() => now);
    const ofJo = sessions.create(JO, BROWSER);
    for (let i = 0; i < MAX_SESSIONS + 1; i++) {
      now += 1000;
      sessions.create(SAM, BROWSER);
    }

    expect(sessions.find(ofJo)).not.toBeNull();
  });

  it('drops the sessions of an older version, because they name no user', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, user_agent TEXT, address TEXT, created_at INTEGER, last_seen_at INTEGER)');
    db.prepare("INSERT INTO sessions VALUES ('old', 'browser', '10.0.0.1', 0, 0)").run();

    new SessionStore(db).create(SAM, BROWSER);

    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 1 });
  });

  it('removes the old sessions from the database at the next login', () => {
    let now = 0;
    const db = new Database(':memory:');
    const sessions = new SessionStore(db, () => now);
    sessions.create(SAM, BROWSER);

    now = SESSION_LIFETIME_SECONDS * 1000;
    sessions.create(SAM, BROWSER);
    expect(db.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 1 });
  });

  it('cuts a very long User-Agent and address', () => {
    const sessions = SessionStore.inMemory();
    const token = sessions.create(SAM, { userAgent: 'x'.repeat(1000), address: 'y'.repeat(1000) });

    expect(sessions.find(token)?.userAgent).toHaveLength(256);
    expect(sessions.find(token)?.address).toHaveLength(64);
  });

  it('logs out every session', () => {
    const sessions = SessionStore.inMemory();
    const token = sessions.create(SAM, BROWSER);
    sessions.deleteAll();
    expect(sessions.find(token)).toBeNull();
  });
});
