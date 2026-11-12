import { describe, expect, it } from 'vitest';
import { hashPassword, passwordMatches } from './passwords.js';

describe('passwords', () => {
  it('makes a hash that does not hold the password', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt:[0-9a-f]+:[0-9a-f]+$/);
    expect(hash).not.toContain('correct horse');
  });

  it('gives two different hashes for the same password', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('matches only the right password', async () => {
    const hash = await hashPassword('correct horse');
    expect(await passwordMatches('correct horse', hash)).toBe(true);
    expect(await passwordMatches('wrong horse', hash)).toBe(false);
  });

  it('does not match a hash in an unknown format', async () => {
    expect(await passwordMatches('anything', 'plain-text')).toBe(false);
  });
});
