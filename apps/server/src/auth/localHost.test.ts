import { describe, expect, it } from 'vitest';
import { hostOfRequest, isLocalHost } from './localHost.js';

describe('isLocalHost', () => {
  it('accepts an IPv4 address, with or without a port', () => {
    expect(isLocalHost('192.168.1.20')).toBe(true);
    expect(isLocalHost('192.168.1.20:3001')).toBe(true);
    expect(isLocalHost('127.0.0.1:80')).toBe(true);
  });

  it('accepts an IPv6 address in brackets, with or without a port', () => {
    expect(isLocalHost('[::1]')).toBe(true);
    expect(isLocalHost('[::1]:3001')).toBe(true);
    expect(isLocalHost('[fe80::1ff:fe23:4567:890a]:3001')).toBe(true);
    expect(isLocalHost('[FD00::1]')).toBe(true);
  });

  it('accepts localhost, a .local name and a name with no dot', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('localhost:5173')).toBe(true);
    expect(isLocalHost('chatter.local')).toBe(true);
    expect(isLocalHost('shop-pi.local:3001')).toBe(true);
    expect(isLocalHost('chatter')).toBe(true);
    expect(isLocalHost('chatter:3001')).toBe(true);
  });

  it('ignores upper case and one dot at the end', () => {
    expect(isLocalHost('LOCALHOST')).toBe(true);
    expect(isLocalHost('Chatter.Local')).toBe(true);
    expect(isLocalHost('chatter.local.')).toBe(true);
    expect(isLocalHost('localhost.:3001')).toBe(true);
    expect(isLocalHost('chatter.')).toBe(true);
  });

  it('refuses a name in DNS, because DNS rebinding can point it at Chatter', () => {
    expect(isLocalHost('evil.example')).toBe(false);
    expect(isLocalHost('evil.example:3001')).toBe(false);
    expect(isLocalHost('chatter.shop.example.com')).toBe(false);
    expect(isLocalHost('EVIL.EXAMPLE.')).toBe(false);
    expect(isLocalHost('local.evil.example')).toBe(false);
    expect(isLocalHost('localhost.evil.example')).toBe(false);
    expect(isLocalHost('192.168.1.20.evil.example')).toBe(false);
    expect(isLocalHost('evil.local.example')).toBe(false);
  });

  it('refuses a missing, empty or broken host', () => {
    expect(isLocalHost(undefined)).toBe(false);
    expect(isLocalHost('')).toBe(false);
    expect(isLocalHost(':3001')).toBe(false);
    expect(isLocalHost('.')).toBe(false);
    expect(isLocalHost('.local')).toBe(false);
    expect(isLocalHost('chatter..')).toBe(false);
    expect(isLocalHost('[::1')).toBe(false);
    expect(isLocalHost('[evil.example]')).toBe(false);
    expect(isLocalHost('::1')).toBe(false);
    expect(isLocalHost('evil.example@127.0.0.1')).toBe(false);
    expect(isLocalHost('127.0.0.1:abc')).toBe(false);
    expect(isLocalHost('127.0.0.1 evil.example')).toBe(false);
  });
});

describe('hostOfRequest', () => {
  it('reads the Host header', () => {
    expect(hostOfRequest('evil.example:3001', 'http://localhost/api/auth/setup')).toBe('evil.example:3001');
  });

  it('uses the host of the URL when the request has no Host header', () => {
    expect(hostOfRequest(undefined, 'http://localhost/api/auth/setup')).toBe('localhost');
    expect(hostOfRequest(undefined, 'http://[::1]:3001/api/auth/setup')).toBe('[::1]:3001');
  });
});
