import { isValidIPv4 } from '@local-chatter/shared';

/**
 * An address range is the first three numbers of an IPv4 address, such as "192.168.1".
 * Most shop networks give every device an address in one range, so the scan tries .1 to .254.
 */
export type AddressRange = string;

/** Three numbers with no leading zeros. "010" is refused: some systems read it as 8 (octal), an internet address. */
const PART = '(0|[1-9]\\d{0,2})';
const RANGE_PATTERN = new RegExp(`^${PART}\\.${PART}\\.${PART}$`);
const MAX_ADDRESS_PART = 255;
const FIRST_HOST = 1;
const LAST_HOST = 254;
const LOCALHOST_NAME = 'localhost';
const LOCALHOST_ADDRESS = '127.0.0.1';

/**
 * True for ranges inside a local network: 10.x.x, 172.16-31.x, 192.168.x, and this computer (127.0.0).
 * The scan never tries an address on the internet.
 */
export function isLocalRange(range: string): boolean {
  const match = RANGE_PATTERN.exec(range);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some(part => part > MAX_ADDRESS_PART)) return false;
  return isPrivateOrLoopback(parts);
}

/** The private blocks of RFC 1918, and 127.0.0 for this computer */
function isPrivateOrLoopback([first, second, third]: number[]): boolean {
  const isPrivate10 = first === 10;
  const isPrivate172 = first === 172 && second >= 16 && second <= 31;
  const isPrivate192 = first === 192 && second === 168;
  const isLoopback = first === 127 && second === 0 && third === 0;
  return isPrivate10 || isPrivate172 || isPrivate192 || isLoopback;
}

/** "192.168.1.50" gives "192.168.1". Null for a name, or an address outside a local network. */
export function rangeOf(address: string): AddressRange | null {
  const ip = address === LOCALHOST_NAME ? LOCALHOST_ADDRESS : address;
  if (!isValidIPv4(ip)) return null;
  const range = ip.split('.').slice(0, 3).join('.');
  return isLocalRange(range) ? range : null;
}

/** The 254 addresses of a range: .1 to .254 (.0 and .255 are not devices) */
export function addressesIn(range: AddressRange): string[] {
  const count = LAST_HOST - FIRST_HOST + 1;
  return Array.from({ length: count }, (_, index) => `${range}.${FIRST_HOST + index}`);
}

export interface RangeClues {
  /** The IP addresses of the machines that are added already. The best clue. */
  machineHosts: string[];
  /** The IPv4 addresses of this server. Leave empty in Docker: there they are Docker's own addresses. */
  serverAddresses: string[];
  /** The host name in the browser's address bar, such as "192.168.1.20" or "localhost" */
  pageHost: string | undefined;
}

/** The ranges where the machines probably are, best guess first, each one once */
export function guessRanges({ machineHosts, serverAddresses, pageHost }: RangeClues): AddressRange[] {
  const clues = [...machineHosts, ...serverAddresses, ...(pageHost ? [pageHost] : [])];
  const ranges = clues.map(rangeOf).filter((range): range is AddressRange => range !== null);
  return [...new Set(ranges)];
}

/** "192.168.1.20:3000" or "[::1]:3000" gives the host part only */
export function hostWithoutPort(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  if (hostHeader.startsWith('[')) return hostHeader.slice(1, hostHeader.indexOf(']'));
  return hostHeader.split(':')[0];
}
