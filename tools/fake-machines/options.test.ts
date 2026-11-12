import { describe, expect, it } from 'vitest';
import { readOptions } from './options.js';

describe('readOptions', () => {
  it('gives the defaults without options', () => {
    expect(readOptions([])).toEqual({ speed: 5, add: false, api: 'http://localhost:3001', lan: false, slowStartSeconds: 10 });
  });

  it('reads --lan', () => {
    expect(readOptions(['--lan']).lan).toBe(true);
  });

  it('reads --speed, --add and --api together with --lan', () => {
    expect(readOptions(['--lan', '--speed', '10', '--add', '--api', 'http://chatter.local:3001'])).toEqual({
      speed: 10, add: true, api: 'http://chatter.local:3001', lan: true, slowStartSeconds: 10,
    });
  });

  it('stops when --speed is not a number above 0', () => {
    expect(() => readOptions(['--speed', '0'])).toThrow(/--speed/);
  });

  it('stops when --api has no value', () => {
    expect(() => readOptions(['--api', '--lan'])).toThrow(/--api needs a value/);
  });

  it('reads --slow-start, and 0 turns it off', () => {
    expect(readOptions(['--slow-start', '20']).slowStartSeconds).toBe(20);
    expect(readOptions(['--slow-start', '0']).slowStartSeconds).toBe(0);
  });

  it('stops when --slow-start is below 0', () => {
    expect(() => readOptions(['--slow-start', '-1'])).toThrow(/--slow-start/);
  });
});
