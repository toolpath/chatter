import { randomBytes, scrypt, timingSafeEqual, type BinaryLike } from 'node:crypto';

/**
 * Password hashing with scrypt.
 * A hash is a one-way scramble: the server can check a password against it,
 * but nobody can get the password back from it.
 * scrypt is slow on purpose, so a guess costs an attacker time.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const FORMAT = 'scrypt';

function scryptKey(password: BinaryLike, salt: BinaryLike): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Returns "scrypt:<salt>:<hash>". The salt is random, so two equal passwords get different hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptKey(password, salt);
  return [FORMAT, salt.toString('hex'), key.toString('hex')].join(':');
}

export async function passwordMatches(password: string, storedHash: string): Promise<boolean> {
  const [format, saltHex, keyHex] = storedHash.split(':');
  if (format !== FORMAT || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptKey(password, Buffer.from(saltHex, 'hex'));
  // A normal compare stops at the first wrong byte. That time difference can leak the hash.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
