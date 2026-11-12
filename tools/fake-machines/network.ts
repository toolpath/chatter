import type { NetworkInterfaceInfo } from 'os';

/**
 * Where the fake machines listen, and the address that Chatter uses for them.
 * Without --lan, only this computer can reach them. With --lan, other devices on the
 * local network can reach them too, so Chatter on a Raspberry Pi can find them with "Find machines".
 */

const THIS_COMPUTER_ONLY = '127.0.0.1';
const ALL_ADDRESSES = '0.0.0.0';

export interface Hosts {
  /** The address the ports listen on */
  listen: string;
  /** The address that --add gives to Chatter */
  machine: string;
}

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

/** The local network ranges that Chatter's "Find machines" scans: 10.x.x.x, 172.16-31.x.x and 192.168.x.x */
function isLocalNetworkAddress(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The IPv4 address of this computer on the local network, or null */
export function localNetworkAddress(interfaces: Interfaces): string | null {
  const addresses = Object.values(interfaces).flatMap(list => list ?? []);
  const found = addresses.find(info => info.family === 'IPv4' && !info.internal && isLocalNetworkAddress(info.address));
  return found?.address ?? null;
}

/** "::ffff:192.168.1.83" gives "192.168.1.83". A server that listens on all addresses sees IPv4 clients in this form. */
export function ipv4Of(address: string): string {
  return address.replace(/^::ffff:/, '');
}

export function hostsFor(lan: boolean, interfaces: Interfaces): Hosts {
  if (!lan) return { listen: THIS_COMPUTER_ONLY, machine: THIS_COMPUTER_ONLY };
  const address = localNetworkAddress(interfaces);
  if (!address) throw new Error('--lan needs this computer on a local network (10.x, 172.16-31.x or 192.168.x).');
  return { listen: ALL_ADDRESSES, machine: address };
}
