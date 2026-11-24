import { describe, expect, it } from 'vitest';
import { newPasswordFormProblem } from './PasswordForm';

describe('newPasswordFormProblem', () => {
  it('refuses a short password', () => {
    expect(newPasswordFormProblem('short', 'short', 'pat')).toBe('The password must have at least 8 characters');
  });

  it('refuses the username as the password, in any case', () => {
    expect(newPasswordFormProblem('Machinist', 'Machinist', 'machinist')).toBe('The password cannot be the username');
  });

  it('refuses a common password', () => {
    expect(newPasswordFormProblem('password1', 'password1', 'pat')).toBe('The password is too common. Use a different password');
  });

  it('refuses two different passwords', () => {
    expect(newPasswordFormProblem('long-enough', 'long-enougH', 'pat')).toBe('The two passwords are not the same');
  });

  it('accepts a long password typed two times', () => {
    expect(newPasswordFormProblem('long-enough', 'long-enough', 'pat')).toBeNull();
  });
});
