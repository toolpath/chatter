import { describe, expect, it } from 'vitest';
import { newPasswordProblem } from './PasswordForm';

describe('newPasswordProblem', () => {
  it('refuses a short password', () => {
    expect(newPasswordProblem('short', 'short')).toBe('The password must have at least 8 characters');
  });

  it('refuses two different passwords', () => {
    expect(newPasswordProblem('long-enough', 'long-enougH')).toBe('The two passwords are not the same');
  });

  it('accepts a long password typed two times', () => {
    expect(newPasswordProblem('long-enough', 'long-enough')).toBeNull();
  });
});
