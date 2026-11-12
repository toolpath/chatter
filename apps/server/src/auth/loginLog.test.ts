import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { LoginLog, MAX_LOGGED_TRIES } from './loginLog.js';

const A_TRY = { username: 'sam', address: '10.0.0.5', result: 'wrong-password' } as const;

describe('LoginLog', () => {
  it('gives the newest try first, with its time', () => {
    let now = new Date('2026-11-09T10:00:00Z');
    const log = LoginLog.inMemory(() => now);
    log.record(A_TRY);
    now = new Date('2026-11-09T10:01:00Z');
    log.record({ ...A_TRY, result: 'logged-in' });

    expect(log.recent()).toEqual([
      { ...A_TRY, result: 'logged-in', at: new Date('2026-11-09T10:01:00Z') },
      { ...A_TRY, at: new Date('2026-11-09T10:00:00Z') },
    ]);
  });

  it(`keeps only the last ${MAX_LOGGED_TRIES} tries`, () => {
    const log = LoginLog.inMemory();
    for (let i = 0; i <= MAX_LOGGED_TRIES; i++) log.record({ ...A_TRY, username: `user-${i}` });

    const tries = log.recent();
    expect(tries).toHaveLength(MAX_LOGGED_TRIES);
    expect(tries[0].username).toBe(`user-${MAX_LOGGED_TRIES}`);
    expect(tries.at(-1)?.username).toBe('user-1');
  });

  it('cuts a very long username', () => {
    const log = LoginLog.inMemory();
    log.record({ ...A_TRY, username: 'x'.repeat(500) });
    expect(log.recent()[0].username).toHaveLength(64);
  });

  it('keeps the tries in the database, so they are there after a restart', () => {
    const db = new Database(':memory:');
    new LoginLog(db).record(A_TRY);
    expect(new LoginLog(db).recent()).toHaveLength(1);
  });
});
