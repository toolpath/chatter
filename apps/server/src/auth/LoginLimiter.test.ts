import { describe, expect, it } from 'vitest';
import { LoginLimiter } from './LoginLimiter.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function failTimes(limiter: LoginLimiter, address: string, times: number) {
  for (let i = 0; i < times; i++) limiter.recordAttempt(address, 'admin');
}

describe('LoginLimiter', () => {
  it('blocks an address after 10 password tries', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 9);
    expect(limiter.isBlocked('10.0.0.5')).toBe(false);

    limiter.recordAttempt('10.0.0.5', 'admin');
    expect(limiter.isBlocked('10.0.0.5')).toBe(true);
    expect(limiter.isBlocked('10.0.0.6')).toBe(false);
  });

  it('forgets the failures after a good password', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 9);
    limiter.recordSuccess('10.0.0.5');
    limiter.recordAttempt('10.0.0.5', 'admin');
    expect(limiter.isBlocked('10.0.0.5')).toBe(false);
  });

  it('blocks tries that start at the same time, before any check ends', () => {
    const limiter = new LoginLimiter();
    const allowed = Array.from({ length: 50 }).filter(() => {
      if (limiter.isBlocked('10.0.0.5')) return false;
      limiter.recordAttempt('10.0.0.5', 'admin');
      return true;
    });
    expect(allowed).toHaveLength(10);
  });

  it('never tracks more than 1000 addresses', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 1001; i++) limiter.recordAttempt(`address-${i}`, 'admin');
    failTimes(limiter, 'address-1000', 9);
    expect(limiter.isBlocked('address-1000')).toBe(true);
    // The oldest entry was dropped to make room
    failTimes(limiter, 'address-0', 9);
    expect(limiter.isBlocked('address-0')).toBe(false);
  });

  it('lets the address try again after 15 minutes', () => {
    let now = 0;
    const limiter = new LoginLimiter(() => now);
    failTimes(limiter, '10.0.0.5', 10);

    now = FIFTEEN_MINUTES + 1;
    expect(limiter.isBlocked('10.0.0.5')).toBe(false);
  });

  it('lists the locked addresses with the last username and the end of the lock', () => {
    let now = 1000;
    const limiter = new LoginLimiter(() => now);
    failTimes(limiter, '10.0.0.5', 9);
    limiter.recordAttempt('10.0.0.5', 'sam');
    failTimes(limiter, '10.0.0.6', 9);

    expect(limiter.lockedAddresses()).toEqual([
      { address: '10.0.0.5', username: 'sam', until: new Date(1000 + FIFTEEN_MINUTES) },
    ]);
    now = 1000 + FIFTEEN_MINUTES + 1;
    expect(limiter.lockedAddresses()).toEqual([]);
  });

  it('lets an unlocked address try again at once', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 10);

    limiter.unlock('10.0.0.5');
    expect(limiter.isBlocked('10.0.0.5')).toBe(false);
    expect(limiter.lockedAddresses()).toEqual([]);
  });

  it('reports only the first blocked try of each lock', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 10);

    expect(limiter.isFirstBlockedTry('10.0.0.5')).toBe(true);
    expect(limiter.isFirstBlockedTry('10.0.0.5')).toBe(false);
    limiter.unlock('10.0.0.5');
    failTimes(limiter, '10.0.0.5', 10);
    expect(limiter.isFirstBlockedTry('10.0.0.5')).toBe(true);
  });
});
