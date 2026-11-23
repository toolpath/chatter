import { afterEach, describe, expect, it } from 'vitest';
import { captureLog, type CapturedLog } from '../logging/testSupport.js';
import { LoginLimiter, MAX_DEVICE_FAILURES, MAX_FAILURES, MAX_LOGGED_UNKNOWN_USERS, MAX_USER_FAILURES } from './LoginLimiter.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function failTimes(limiter: LoginLimiter, address: string, times: number, username = 'admin') {
  for (let i = 0; i < times; i++) limiter.recordAttempt(address, username);
}

/** Wrong passwords for one user from many addresses, at most 5 from each address */
function failFromManyAddresses(limiter: LoginLimiter, username: string, times: number) {
  for (let i = 0; i < times; i++) limiter.recordAttempt(`10.0.${Math.floor(i / 5)}.1`, username);
}

describe('LoginLimiter', () => {
  it('blocks an address for one user after 10 password tries', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 9);
    expect(limiter.isBlocked('10.0.0.5', 'admin')).toBe(false);

    limiter.recordAttempt('10.0.0.5', 'admin');
    expect(limiter.isBlocked('10.0.0.5', 'admin')).toBe(true);
    expect(limiter.isBlocked('10.0.0.6', 'admin')).toBe(false);
  });

  it('does not block the other users of a shared address', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 10, 'admin');
    expect(limiter.isBlocked('10.0.0.5', 'bob')).toBe(false);
  });

  it('forgets the failures of the user after a good password', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 9);
    limiter.recordAttempt('10.0.0.5', 'admin');
    limiter.recordSuccess('10.0.0.5', 'admin');
    limiter.recordAttempt('10.0.0.5', 'admin');
    expect(limiter.isBlocked('10.0.0.5', 'admin')).toBe(false);
  });

  it('keeps the failures of another user after a good password from the same address', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 9, 'admin');
    limiter.recordAttempt('10.0.0.5', 'bob');
    limiter.recordSuccess('10.0.0.5', 'bob');

    limiter.recordAttempt('10.0.0.5', 'admin');
    expect(limiter.isBlocked('10.0.0.5', 'admin')).toBe(true);
  });

  it('counts the username as the login reads it, with no case and no spaces at the ends', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 5, 'Admin');
    failTimes(limiter, '10.0.0.5', 5, ' admin ');
    expect(limiter.isBlocked('10.0.0.5', 'ADMIN')).toBe(true);
  });

  it('counts the tries from two IPv6 addresses in one /64 together', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '2001:db8:1:2::66', 5);
    failTimes(limiter, '2001:db8:1:2:aaaa:bbbb:cccc:dddd', 5);

    expect(limiter.isBlocked('2001:db8:1:2::1', 'admin')).toBe(true);
    expect(limiter.isBlocked('2001:db8:1:3::1', 'admin')).toBe(false);
  });

  it('counts an IPv4-mapped address as its IPv4 address, and keeps other IPv4 computers apart', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '::ffff:192.168.1.66', 5);
    failTimes(limiter, '192.168.1.66', 5);

    expect(limiter.isBlocked('::ffff:c0a8:142', 'admin')).toBe(true);
    expect(limiter.isBlocked('::ffff:192.168.1.20', 'admin')).toBe(false);
    expect(limiter.lockedAddresses().map(locked => locked.address)).toEqual(['192.168.1.66']);
  });

  it('blocks a user on all addresses after 30 tries from many addresses', () => {
    expect(MAX_USER_FAILURES).toBe(30);
    const limiter = new LoginLimiter();
    failFromManyAddresses(limiter, 'admin', MAX_USER_FAILURES - 1);
    expect(limiter.isBlocked('10.9.9.9', 'admin')).toBe(false);

    limiter.recordAttempt('10.9.9.8', 'admin');
    expect(limiter.isBlocked('10.9.9.9', 'admin')).toBe(true);
    expect(limiter.isBlocked('10.9.9.9', 'bob')).toBe(false);
  });

  it('does not lock a user after 30 good logins', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < MAX_USER_FAILURES; i++) {
      const address = `10.0.${i}.1`;
      expect(limiter.isBlocked(address, 'admin')).toBe(false);
      limiter.recordAttempt(address, 'admin');
      limiter.recordSuccess(address, 'admin');
    }

    expect(limiter.isBlocked('10.9.9.9', 'admin')).toBe(false);
    expect(limiter.lockedUsers()).toEqual([]);
  });

  it('keeps the wrong passwords of the user on all addresses after a good password', () => {
    const limiter = new LoginLimiter();
    failFromManyAddresses(limiter, 'admin', MAX_USER_FAILURES - 1);
    limiter.recordAttempt('10.8.8.8', 'admin');
    limiter.recordSuccess('10.8.8.8', 'admin');
    expect(limiter.isBlocked('10.9.9.9', 'admin')).toBe(false);

    limiter.recordAttempt('10.9.9.8', 'admin');
    expect(limiter.isBlocked('10.9.9.9', 'admin')).toBe(true);
  });

  it('reports the first blocked try again when a good login ends a user lock and a new lock starts', () => {
    const limiter = new LoginLimiter();
    failFromManyAddresses(limiter, 'admin', MAX_USER_FAILURES - 1);
    // The good password of the owner is the try that reaches the limit
    limiter.recordAttempt('10.8.8.8', 'admin');
    expect(limiter.isFirstBlockedTry('10.9.9.9', 'admin')).toBe(true);
    limiter.recordSuccess('10.8.8.8', 'admin');
    expect(limiter.isBlocked('10.9.9.9', 'admin')).toBe(false);

    limiter.recordAttempt('10.9.9.8', 'admin');
    expect(limiter.isFirstBlockedTry('10.9.9.9', 'admin')).toBe(true);
  });

  it('blocks tries that start at the same time, before any check ends', () => {
    const limiter = new LoginLimiter();
    const allowed = Array.from({ length: 50 }).filter(() => {
      if (limiter.isBlocked('10.0.0.5', 'admin')) return false;
      limiter.recordAttempt('10.0.0.5', 'admin');
      return true;
    });
    expect(allowed).toHaveLength(MAX_FAILURES);
  });

  it('never tracks more than 1000 entries', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 1001; i++) limiter.recordAttempt(`address-${i}`, `user-${i}`);
    failTimes(limiter, 'address-1000', 9, 'user-1000');
    expect(limiter.isBlocked('address-1000', 'user-1000')).toBe(true);
    // The oldest entry with the fewest tries was dropped to make room
    failTimes(limiter, 'address-0', 9, 'user-0');
    expect(limiter.isBlocked('address-0', 'user-0')).toBe(false);
  });

  it('removes the old entries first when the list is full, so a new count does not push out a live one', () => {
    let now = 0;
    const limiter = new LoginLimiter(() => now);
    // 999 old entries with 2 tries each: more than the live entry below
    for (let i = 0; i < 999; i++) failTimes(limiter, `address-${i}`, 2, `user-${i}`);
    now = 10 * 60 * 1000;
    limiter.recordAttempt('10.0.0.5', 'admin');

    now = FIFTEEN_MINUTES + 1;
    limiter.recordAttempt('10.0.0.9', 'new-user');
    failTimes(limiter, '10.0.0.5', MAX_FAILURES - 1);
    expect(limiter.isBlocked('10.0.0.5', 'admin')).toBe(true);
  });

  it('keeps the count of a guessed user when many new usernames fill the list', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 9);
    for (let i = 0; i < 2000; i++) limiter.recordAttempt('10.0.0.5', `made-up-${i}`);

    limiter.recordAttempt('10.0.0.5', 'admin');
    expect(limiter.isBlocked('10.0.0.5', 'admin')).toBe(true);
  });

  it('lets the address and the user try again after 15 minutes', () => {
    let now = 0;
    const limiter = new LoginLimiter(() => now);
    failTimes(limiter, '10.0.0.5', 10);
    failFromManyAddresses(limiter, 'bob', MAX_USER_FAILURES);

    now = FIFTEEN_MINUTES + 1;
    expect(limiter.isBlocked('10.0.0.5', 'admin')).toBe(false);
    expect(limiter.isBlocked('10.0.0.5', 'bob')).toBe(false);
  });

  it('lists the locked addresses with the username and the end of the lock', () => {
    let now = 1000;
    const limiter = new LoginLimiter(() => now);
    failTimes(limiter, '10.0.0.5', 10, 'Sam');
    failTimes(limiter, '10.0.0.6', 9);
    failTimes(limiter, '2001:db8:1:2::66', 10);

    expect(limiter.lockedAddresses()).toEqual([
      { address: '10.0.0.5', username: 'sam', until: new Date(1000 + FIFTEEN_MINUTES) },
      { address: '2001:db8:1:2::/64', username: 'admin', until: new Date(1000 + FIFTEEN_MINUTES) },
    ]);
    now = 1000 + FIFTEEN_MINUTES + 1;
    expect(limiter.lockedAddresses()).toEqual([]);
  });

  it('lists the users that are locked on all addresses', () => {
    const limiter = new LoginLimiter(() => 1000);
    failFromManyAddresses(limiter, 'Admin', MAX_USER_FAILURES);
    failFromManyAddresses(limiter, 'bob', MAX_USER_FAILURES - 1);

    expect(limiter.lockedUsers()).toEqual([{ username: 'admin', until: new Date(1000 + FIFTEEN_MINUTES) }]);
  });

  it('unlocks all users of an address at once, also by the /64 that the list shows', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 10, 'admin');
    failTimes(limiter, '10.0.0.5', 10, 'bob');
    failTimes(limiter, '2001:db8:1:2::66', 10);

    limiter.unlock('10.0.0.5');
    limiter.unlock('2001:db8:1:2::/64');
    expect(limiter.isBlocked('10.0.0.5', 'admin')).toBe(false);
    expect(limiter.isBlocked('10.0.0.5', 'bob')).toBe(false);
    expect(limiter.isBlocked('2001:db8:1:2::66', 'admin')).toBe(false);
    expect(limiter.lockedAddresses()).toEqual([]);
  });

  it('unlocks a user on all addresses', () => {
    const limiter = new LoginLimiter();
    failFromManyAddresses(limiter, 'admin', MAX_USER_FAILURES);

    limiter.unlockUser('ADMIN');
    expect(limiter.isBlocked('10.9.9.9', 'admin')).toBe(false);
    expect(limiter.lockedUsers()).toEqual([]);
  });

  it('reports only the first blocked try of each lock', () => {
    const limiter = new LoginLimiter();
    failTimes(limiter, '10.0.0.5', 10);

    expect(limiter.isFirstBlockedTry('10.0.0.5', 'admin')).toBe(true);
    expect(limiter.isFirstBlockedTry('10.0.0.5', 'admin')).toBe(false);
    limiter.unlock('10.0.0.5');
    failTimes(limiter, '10.0.0.5', 10);
    expect(limiter.isFirstBlockedTry('10.0.0.5', 'admin')).toBe(true);
  });

  it('reports only the first blocked try of a user lock, from any address', () => {
    const limiter = new LoginLimiter();
    failFromManyAddresses(limiter, 'admin', MAX_USER_FAILURES);

    expect(limiter.isFirstBlockedTry('10.9.9.1', 'admin')).toBe(true);
    expect(limiter.isFirstBlockedTry('10.9.9.2', 'admin')).toBe(false);
  });
});

describe('LoginLimiter for a known device', () => {
  const DEVICE = 'device-1';

  function failOnDevice(limiter: LoginLimiter, times: number, device = DEVICE, username = 'admin') {
    for (let i = 0; i < times; i++) limiter.recordAttempt('10.0.0.5', username, device);
  }

  it('lets a known device try while the user and its address are locked', () => {
    const limiter = new LoginLimiter();
    failFromManyAddresses(limiter, 'admin', MAX_USER_FAILURES);
    failTimes(limiter, '10.0.0.5', MAX_FAILURES);

    expect(limiter.isBlocked('10.0.0.5', 'admin')).toBe(true);
    expect(limiter.isBlocked('10.0.0.5', 'admin', DEVICE)).toBe(false);
  });

  it('blocks a known device after 10 wrong passwords, and only that device', () => {
    expect(MAX_DEVICE_FAILURES).toBe(10);
    const limiter = new LoginLimiter();
    failOnDevice(limiter, MAX_DEVICE_FAILURES - 1);
    expect(limiter.isBlocked('10.0.0.5', 'admin', DEVICE)).toBe(false);

    failOnDevice(limiter, 1);
    expect(limiter.isBlocked('10.0.0.5', 'admin', DEVICE)).toBe(true);
    expect(limiter.isBlocked('10.0.0.5', 'admin', 'device-2')).toBe(false);
  });

  it('does not count the tries of a known device for the user or the address', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < MAX_USER_FAILURES; i++) failOnDevice(limiter, 1, `device-${i}`);

    expect(limiter.isBlocked('10.0.0.5', 'admin')).toBe(false);
    expect(limiter.lockedUsers()).toEqual([]);
    expect(limiter.lockedAddresses()).toEqual([]);
  });

  it('forgets the tries of a device after a good password', () => {
    const limiter = new LoginLimiter();
    failOnDevice(limiter, MAX_DEVICE_FAILURES - 1);
    limiter.recordAttempt('10.0.0.5', 'admin', DEVICE);
    limiter.recordSuccess('10.0.0.5', 'admin', DEVICE);

    failOnDevice(limiter, 1);
    expect(limiter.isBlocked('10.0.0.5', 'admin', DEVICE)).toBe(false);
  });

  it('reports only the first blocked try of a device', () => {
    const limiter = new LoginLimiter();
    failOnDevice(limiter, MAX_DEVICE_FAILURES);

    expect(limiter.isFirstBlockedTry('10.0.0.5', 'admin', DEVICE)).toBe(true);
    expect(limiter.isFirstBlockedTry('10.0.0.5', 'admin', DEVICE)).toBe(false);
  });

  it('lets the device try again after 15 minutes', () => {
    let now = 0;
    const limiter = new LoginLimiter(() => now);
    failOnDevice(limiter, MAX_DEVICE_FAILURES);

    now = FIFTEEN_MINUTES + 1;
    expect(limiter.isBlocked('10.0.0.5', 'admin', DEVICE)).toBe(false);
  });

  it('unlocks the devices of a user when an admin unlocks the user', () => {
    const limiter = new LoginLimiter();
    failOnDevice(limiter, MAX_DEVICE_FAILURES, DEVICE, 'Admin');
    failOnDevice(limiter, MAX_DEVICE_FAILURES, 'device-of-bob', 'bob');

    limiter.unlockUser('admin');
    expect(limiter.isBlocked('10.0.0.5', 'admin', DEVICE)).toBe(false);
    expect(limiter.isBlocked('10.0.0.5', 'bob', 'device-of-bob')).toBe(true);
  });

  it('keeps the count of a guessed device when many new devices fill the list', () => {
    const limiter = new LoginLimiter();
    failOnDevice(limiter, MAX_DEVICE_FAILURES - 1);
    for (let i = 0; i < 2000; i++) failOnDevice(limiter, 1, `new-device-${i}`);

    failOnDevice(limiter, 1);
    expect(limiter.isBlocked('10.0.0.5', 'admin', DEVICE)).toBe(true);
  });
});

describe('LoginLimiter tries with an unknown username', () => {
  it('counts the tries of each address group, also for many different usernames', () => {
    const limiter = new LoginLimiter();
    expect(limiter.countUnknownUser('10.0.0.5')).toBe(1);
    expect(limiter.countUnknownUser('10.0.0.5')).toBe(2);
    expect(limiter.countUnknownUser('10.0.0.6')).toBe(1);
    expect(limiter.countUnknownUser('2001:db8:1:2::66')).toBe(1);
    expect(limiter.countUnknownUser('2001:db8:1:2::67')).toBe(2);
  });

  it('starts the count again after 15 minutes', () => {
    let now = 0;
    const limiter = new LoginLimiter(() => now);
    for (let i = 0; i < 5; i++) limiter.countUnknownUser('10.0.0.5');

    now = FIFTEEN_MINUTES + 1;
    expect(limiter.countUnknownUser('10.0.0.5')).toBe(1);
  });

  it('keeps the count of a busy address when many new addresses fill the list', () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < MAX_LOGGED_UNKNOWN_USERS; i++) limiter.countUnknownUser('10.0.0.5');
    for (let i = 0; i < 2000; i++) limiter.countUnknownUser(`10.1.${Math.floor(i / 250)}.${i % 250}`);

    expect(limiter.countUnknownUser('10.0.0.5')).toBe(MAX_LOGGED_UNKNOWN_USERS + 1);
  });

  describe('the floods that ended', () => {
    it('gives each address group that had more tries than the logs write, one time, after its 15 minutes', () => {
      let now = 0;
      const limiter = new LoginLimiter(() => now);
      for (let i = 0; i < MAX_LOGGED_UNKNOWN_USERS + 3; i++) limiter.countUnknownUser('10.0.0.5');
      for (let i = 0; i < MAX_LOGGED_UNKNOWN_USERS; i++) limiter.countUnknownUser('10.0.0.6');
      expect(limiter.takeEndedUnknownUserFloods()).toEqual([]);

      now = FIFTEEN_MINUTES + 1;

      expect(limiter.takeEndedUnknownUserFloods()).toEqual([{ address: '10.0.0.5', notLogged: 3 }]);
      expect(limiter.takeEndedUnknownUserFloods()).toEqual([]);
    });

    it('gives the flood of an address group also when the next try of that group comes first', () => {
      let now = 0;
      const limiter = new LoginLimiter(() => now);
      for (let i = 0; i < MAX_LOGGED_UNKNOWN_USERS + 2; i++) limiter.countUnknownUser('2001:db8:1:2::66');

      now = FIFTEEN_MINUTES + 1;
      expect(limiter.countUnknownUser('2001:db8:1:2::67')).toBe(1);

      expect(limiter.takeEndedUnknownUserFloods()).toEqual([{ address: '2001:db8:1:2::/64', notLogged: 2 }]);
    });

    it('gives the flood of an address group that a full list pushed out early', () => {
      const limiter = new LoginLimiter();
      for (let i = 0; i < MAX_LOGGED_UNKNOWN_USERS + 1; i++) limiter.countUnknownUser('10.0.0.5');
      for (let i = 0; i < 2000; i++) {
        for (let j = 0; j < MAX_LOGGED_UNKNOWN_USERS + 2; j++) limiter.countUnknownUser(`10.1.${Math.floor(i / 250)}.${i % 250}`);
      }

      expect(limiter.takeEndedUnknownUserFloods()).toContainEqual({ address: '10.0.0.5', notLogged: 1 });
    });
  });
});

describe('LoginLimiter log', () => {
  let log: CapturedLog | undefined;

  afterEach(() => {
    log?.restore();
    log = undefined;
  });

  it('writes one warning when a user lock starts, with the user, the address group and the count', () => {
    const limiter = new LoginLimiter();
    failFromManyAddresses(limiter, 'Admin', MAX_USER_FAILURES - 1);
    log = captureLog();
    expect(log.text('warn')).toBe('');

    limiter.recordAttempt('2001:db8:1:2::66', 'Admin');
    limiter.recordAttempt('10.9.9.9', 'admin');

    const warnings = log.lines.filter(line => line.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].text).toContain('User locked on all addresses');
    expect(warnings[0].text).toContain('username=admin');
    expect(warnings[0].text).toContain('address=2001:db8:1:2::/64');
    expect(warnings[0].text).toContain(`count=${MAX_USER_FAILURES}`);
  });
});
