import type { NetworkInterfaceInfo } from 'os';
import { describe, expect, it } from 'vitest';
import { hostsFor, ipv4Of, localNetworkAddress } from './network.js';

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` };
}

function ipv6(address: string): NetworkInterfaceInfo {
  return { address, family: 'IPv6', internal: false, netmask: 'ffff:ffff:ffff:ffff::', mac: '00:00:00:00:00:00', cidr: `${address}/64`, scopeid: 0 };
}

const MAC_ON_WIFI = {
  lo0: [ipv4('127.0.0.1', true)],
  en0: [ipv6('fe80::1'), ipv4('192.168.1.83')],
};

describe('localNetworkAddress', () => {
  it('gives the IPv4 address of this computer on the local network', () => {
    expect(localNetworkAddress(MAC_ON_WIFI)).toBe('192.168.1.83');
  });

  it('skips addresses that other devices cannot use: loopback, link-local and internet addresses', () => {
    const interfaces = {
      lo0: [ipv4('127.0.0.1', true)],
      en5: [ipv4('169.254.10.20')],
      utun0: [ipv4('8.8.8.8')],
      en0: [ipv4('10.0.0.15')],
    };
    expect(localNetworkAddress(interfaces)).toBe('10.0.0.15');
  });

  it('gives null when this computer is not on a local network', () => {
    expect(localNetworkAddress({ lo0: [ipv4('127.0.0.1', true)] })).toBeNull();
  });
});

describe('ipv4Of', () => {
  it('turns an IPv4 address in IPv6 form into the plain IPv4 address', () => {
    expect(ipv4Of('::ffff:192.168.1.83')).toBe('192.168.1.83');
  });

  it('keeps a plain IPv4 address', () => {
    expect(ipv4Of('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('hostsFor', () => {
  it('uses only this computer without --lan', () => {
    expect(hostsFor(false, MAC_ON_WIFI)).toEqual({ listen: '127.0.0.1', machine: '127.0.0.1' });
  });

  it('listens on all addresses with --lan, and gives the local network address to Chatter', () => {
    expect(hostsFor(true, MAC_ON_WIFI)).toEqual({ listen: '0.0.0.0', machine: '192.168.1.83' });
  });

  it('stops with --lan when this computer is not on a local network', () => {
    expect(() => hostsFor(true, { lo0: [ipv4('127.0.0.1', true)] })).toThrow(/local network/);
  });
});
