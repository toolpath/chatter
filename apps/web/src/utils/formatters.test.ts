import { describe, expect, it } from 'vitest';
import { formatAgo, formatDateTime, formatSize } from './formatters';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = Date.parse('2026-11-06T12:00:00.000Z');
const before = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatDateTime', () => {
  it('says "Never" for no time', () => {
    expect(formatDateTime(null)).toBe('Never');
    expect(formatDateTime(undefined)).toBe('Never');
  });
});

describe('formatAgo', () => {
  it('uses the largest unit that fits', () => {
    expect(formatAgo(before(4 * SECOND), NOW)).toBe('4 s ago');
    expect(formatAgo(before(2 * MINUTE + 5 * SECOND), NOW)).toBe('2 min ago');
    expect(formatAgo(before(3 * HOUR), NOW)).toBe('3 h ago');
    expect(formatAgo(before(2 * DAY), NOW)).toBe('2 d ago');
  });

  it('says "0 s ago" for a time after now, and "Never" for no time', () => {
    expect(formatAgo(before(-5 * SECOND), NOW)).toBe('0 s ago');
    expect(formatAgo(null, NOW)).toBe('Never');
  });
});

describe('formatSize', () => {
  it('uses the largest unit that fits, with at most one decimal', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3 MB');
    expect(formatSize(2.25 * 1024 ** 3)).toBe('2.3 GB');
  });

  it('says "0 B" for zero bytes, and gives no text for a size that is not a number', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(NaN)).toBe('');
  });
});
