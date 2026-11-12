import { describe, expect, it } from 'vitest';
import { addressesIn, guessRanges, hostWithoutPort, isLocalRange, rangeOf } from './addressRange.js';

describe('isLocalRange', () => {
  it('accepts the local network ranges and this computer', () => {
    for (const range of ['10.0.0', '172.16.5', '172.31.255', '192.168.1', '127.0.0']) {
      expect(isLocalRange(range)).toBe(true);
    }
  });

  it('refuses internet ranges and text that is not a range', () => {
    for (const range of ['8.8.8', '172.32.0', '192.169.1', '127.0.1', '192.168.256', '192.168.1.0', 'abc', '010.0.0', '0172.016.1', '192.168.01']) {
      expect(isLocalRange(range)).toBe(false);
    }
  });
});

describe('rangeOf', () => {
  it('gives the first three numbers of a local address', () => {
    expect(rangeOf('192.168.1.50')).toBe('192.168.1');
    expect(rangeOf('localhost')).toBe('127.0.0');
  });

  it('gives null for a name or an internet address', () => {
    expect(rangeOf('chatter.myshop.com')).toBeNull();
    expect(rangeOf('8.8.8.8')).toBeNull();
  });
});

describe('addressesIn', () => {
  it('gives .1 to .254', () => {
    const addresses = addressesIn('10.0.0');
    expect(addresses).toHaveLength(254);
    expect(addresses[0]).toBe('10.0.0.1');
    expect(addresses[253]).toBe('10.0.0.254');
  });
});

describe('guessRanges', () => {
  it('puts the machine ranges first, then the server, then the page, each once', () => {
    expect(guessRanges({
      machineHosts: ['192.168.1.50', '192.168.1.51', '10.0.5.9'],
      serverAddresses: ['192.168.1.20', '172.17.0.2'],
      pageHost: 'localhost',
    })).toEqual(['192.168.1', '10.0.5', '172.17.0', '127.0.0']);
  });

  it('skips clues that give no local range', () => {
    expect(guessRanges({ machineHosts: [], serverAddresses: [], pageHost: 'chatter.myshop.com' })).toEqual([]);
  });
});

describe('hostWithoutPort', () => {
  it('removes the port', () => {
    expect(hostWithoutPort('192.168.1.20:3000')).toBe('192.168.1.20');
    expect(hostWithoutPort('localhost')).toBe('localhost');
    expect(hostWithoutPort('[::1]:3000')).toBe('::1');
    expect(hostWithoutPort(undefined)).toBeUndefined();
  });
});
