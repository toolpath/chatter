import { describe, expect, it } from 'vitest';
import { maskUnknownUsername } from './unknownUsername.js';

describe('maskUnknownUsername', () => {
  it('keeps the first 2 characters and the length of a long text', () => {
    expect(maskUnknownUsername('john-secret1')).toBe('jo… (12 characters)');
    expect(maskUnknownUsername('x'.repeat(500))).toBe('xx… (500 characters)');
  });

  it('never shows more than a third of the text', () => {
    expect(maskUnknownUsername('abcdef')).toBe('ab… (6 characters)');
    expect(maskUnknownUsername('abcde')).toBe('a… (5 characters)');
    expect(maskUnknownUsername('abc')).toBe('a… (3 characters)');
    expect(maskUnknownUsername('ab')).toBe('… (2 characters)');
    expect(maskUnknownUsername('a')).toBe('… (1 character)');
    expect(maskUnknownUsername('')).toBe('… (0 characters)');
  });

  it('counts and cuts on whole characters, not on halves of a surrogate pair', () => {
    expect(maskUnknownUsername('😀😀😀😀😀😀')).toBe('😀😀… (6 characters)');
    expect(maskUnknownUsername('😀ab')).toBe('😀… (3 characters)');
  });

  it('keeps a control character in the prefix as it is, so the log escapes it as before', () => {
    expect(maskUnknownUsername('\r\nINFO fake line')).toBe('\r\n… (16 characters)');
  });
});
