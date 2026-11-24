import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from './commonPasswords.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './requests.js';
import { newPasswordProblem } from './passwordRule.js';

describe('newPasswordProblem', () => {
  it('accepts a password that is long, not the username and not common', () => {
    expect(newPasswordProblem('blue-lathe-at-dawn', 'pat')).toBeNull();
  });

  it('refuses a password that is too short', () => {
    expect(newPasswordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1), 'pat')).toBe('The password must have at least 8 characters');
    expect(newPasswordProblem('x7#kq2!m', 'pat')).toBeNull();
  });

  it('refuses a password that is too long', () => {
    expect(newPasswordProblem('a'.repeat(MAX_PASSWORD_LENGTH + 1), 'pat')).toBe('The password is too long');
  });

  it('refuses the username as the password, with no case and no spaces at the two ends', () => {
    const problem = 'The password cannot be the username';
    expect(newPasswordProblem('machinist', 'machinist')).toBe(problem);
    expect(newPasswordProblem('MachiNist', 'machinist')).toBe(problem);
    expect(newPasswordProblem(' machinist ', 'Machinist')).toBe(problem);
    expect(newPasswordProblem('machinist', ' MACHINIST ')).toBe(problem);
  });

  it('accepts a password that only has the username in it', () => {
    expect(newPasswordProblem('machinist-blue-42', 'machinist')).toBeNull();
  });

  it('refuses a common password, with no case and no spaces at the two ends', () => {
    const problem = 'The password is too common. Use a different password';
    expect(newPasswordProblem('password', 'pat')).toBe(problem);
    expect(newPasswordProblem('PassWord', 'pat')).toBe(problem);
    expect(newPasswordProblem(' 12345678 ', 'pat')).toBe(problem);
    expect(newPasswordProblem('qwertyuiop', 'pat')).toBe(problem);
  });

  it('refuses the name of the app as the password', () => {
    expect(newPasswordProblem('chatterbox', 'pat')).toBe('The password is too common. Use a different password');
    expect(newPasswordProblem('Chatter123', 'pat')).toBe('The password is too common. Use a different password');
  });

  it('checks the length before the other rules', () => {
    expect(newPasswordProblem('pat', 'pat')).toBe('The password must have at least 8 characters');
  });
});

describe('COMMON_PASSWORDS', () => {
  it('has about 1,000 passwords, each in lower case and long enough to pass the length rule', () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThan(990);
    expect(COMMON_PASSWORDS.size).toBeLessThan(1100);
    for (const password of COMMON_PASSWORDS) {
      expect(password).toBe(password.trim().toLowerCase());
      expect(password.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    }
  });
});
