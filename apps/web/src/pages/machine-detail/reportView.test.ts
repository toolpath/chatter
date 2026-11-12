import { describe, expect, it } from 'vitest';
import { formatDuration, formatShare } from './reportView';

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [45_000, '45 s'],
    [59_900, '59 s'],
    [12 * 60_000 + 30_000, '12 min'],
    [3 * 3_600_000 + 25 * 60_000, '3 h 25 min'],
    [5 * 3_600_000, '5 h'],
    [50 * 3_600_000, '50 h'],
  ])('shows %i ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('formatShare', () => {
  it('shows the part as a whole percent', () => {
    expect(formatShare(5_000, 8_000)).toBe('63%');
  });

  it('shows nothing when the whole is zero', () => {
    expect(formatShare(0, 0)).toBe('');
  });
});
