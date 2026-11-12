import { BlockList, isIP } from 'node:net';

/** Where a request really came from */
export interface RequestOrigin {
  /** The network address of the user's computer */
  address: string;
  /** True when the user's browser used HTTPS */
  isHttps: boolean;
  /** The trusted reverse proxy that the request came through. Not set when the user connected directly. */
  proxyAddress?: string;
}

/** A proxy entry that is not an IP address or a range */
export class ProxyAddressError extends Error {}

/** The parts of a request that tell where it came from */
export interface RequestFacts {
  /** The computer that connected to ChatterBox: the user, or a reverse proxy */
  socketAddress: string | undefined;
  url: string;
  /** X-Forwarded-For: the addresses that the request came through, the oldest first */
  forwardedFor?: string;
  /** X-Forwarded-Proto: "https" when the browser used HTTPS to the proxy */
  forwardedProto?: string;
}

const UNKNOWN_ADDRESS = 'unknown';
/** The longest range prefix of each IP version, like the "/32" in "10.0.0.1/32" */
const MAX_IPV4_PREFIX = 32;
const MAX_IPV6_PREFIX = 128;

const IPV4_IN_IPV6 = /^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i;
const IPV4_WITH_PORT = /^(\d+\.\d+\.\d+\.\d+):\d+$/;
const IPV6_IN_BRACKETS = /^\[([^\]]+)\](?::\d+)?$/;

/** "::ffff:127.0.0.1", "127.0.0.1:5555" and "127.0.0.1" are the same address. Some proxies add the port. */
const plainAddress = (address: string) => address.trim()
  .replace(IPV4_WITH_PORT, '$1')
  .replace(IPV6_IN_BRACKETS, '$1')
  .replace(IPV4_IN_IPV6, '');

const lastValueOf = (header: string) => header.split(',').pop()!.trim();

const urlIsHttps = (url: string) => new URL(url).protocol === 'https:';

/** The address family that BlockList needs, from the version that isIP() gives (4 or 6) */
const familyOf = (ipVersion: number) => (ipVersion === 4 ? 'ipv4' : 'ipv6');

/**
 * Which reverse proxy ChatterBox believes.
 * A reverse proxy sends the user's real address in X-Forwarded-For, and "https" in X-Forwarded-Proto.
 * Any computer can send these headers, so they count only from a proxy in the trusted list.
 * Only one proxy in front of ChatterBox is supported: a chain of proxies is not followed.
 */
export class ProxyTrust {
  private constructor(private readonly proxies: BlockList, readonly setting: string[]) {}

  /**
   * "127.0.0.1, 172.16.0.0/12" gives a ProxyTrust for that address and that range.
   * No setting trusts no proxy. A bad entry throws a ProxyAddressError.
   */
  static fromSetting(setting: string | undefined): ProxyTrust {
    const entries = (setting ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
    const proxies = new BlockList();
    for (const entry of entries) addEntry(proxies, entry);
    return new ProxyTrust(proxies, entries);
  }

  originOf(request: RequestFacts): RequestOrigin {
    const socketAddress = plainAddress(request.socketAddress ?? UNKNOWN_ADDRESS);
    if (!this.trusts(socketAddress)) return { address: socketAddress, isHttps: urlIsHttps(request.url) };
    return {
      address: userAddressFrom(request.forwardedFor) ?? socketAddress,
      proxyAddress: socketAddress,
      isHttps: request.forwardedProto !== undefined
        ? lastValueOf(request.forwardedProto).toLowerCase() === 'https'
        : urlIsHttps(request.url),
    };
  }

  /** True when the proxy headers from this address count */
  trusts(address: string): boolean {
    const plain = plainAddress(address);
    const version = isIP(plain);
    return version !== 0 && this.proxies.check(plain, familyOf(version));
  }
}

/**
 * The address that the proxy added at the end of X-Forwarded-For: the computer that connected to the proxy.
 * The user can put false addresses before it, so only the last one counts.
 */
function userAddressFrom(forwardedFor: string | undefined): string | undefined {
  if (forwardedFor === undefined) return undefined;
  const address = plainAddress(lastValueOf(forwardedFor));
  return isIP(address) === 0 ? undefined : address;
}

/** Add one address, or one range like "172.16.0.0/12" */
function addEntry(proxies: BlockList, entry: string): void {
  const [address, prefixText, ...rest] = entry.split('/');
  const version = isIP(address);
  const maxPrefix = version === 4 ? MAX_IPV4_PREFIX : MAX_IPV6_PREFIX;
  const prefix = Number(prefixText);
  const isBadPrefix = prefixText !== undefined && (!/^\d+$/.test(prefixText) || prefix > maxPrefix);

  if (version === 0 || isBadPrefix || rest.length > 0) {
    throw new ProxyAddressError(`"${entry}" is not an IP address or a range like 172.16.0.0/12`);
  }
  const family = familyOf(version);
  if (prefixText === undefined) proxies.addAddress(address, family);
  else proxies.addSubnet(address, prefix, family);
}
