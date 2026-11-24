import { isIP } from 'node:net';

/**
 * The first-run setup answers only at a local address (finding F-05 of the security review).
 *
 * Until an Admin exists, the setup makes an Admin for the first person who asks. A web page from the internet, open in a
 * browser in the shop network, can point its own DNS name at the address of Chatter (DNS rebinding). The browser then
 * sends the setup with the Host header of that DNS name. A local address cannot come from the DNS of a different
 * person, so the setup accepts only these hosts:
 * - an IP address (IPv6 in brackets)
 * - localhost
 * - a name that ends with .local (mDNS on the shop network, for example chatter.local)
 * - a name with no dot (the name of a computer on the shop network, for example chatter)
 * The host can have a port and one dot at the end. Upper case and lower case are the same.
 * Behind a reverse proxy with a DNS name, do the setup at the IP address of Chatter. After the setup, all names work.
 * The proxy must send the Host header of the browser on. A proxy that sends its own upstream name (for example 127.0.0.1)
 * turns this check off. Chatter does not read X-Forwarded-Host here, because any computer can send it.
 */

/** The reply to a setup at a host that is not local */
export const LOCAL_SETUP_ONLY =
  'Do the first-run setup at a local address: an IP address, localhost, a name that ends with .local, or a name with no dot.';

/** An IPv6 address in brackets, and a port if there is one */
const BRACKETED_IPV6 = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/;
/** A name or an IPv4 address, a port if there is one */
const NAME_AND_PORT = /^([^:[\]]+)(?::\d{1,5})?$/;
/** One part of a name between two dots */
const LABEL = /^[a-z0-9_-]+$/;

/** True when the Host header is an address that DNS rebinding cannot give */
export function isLocalHost(host: string | undefined): boolean {
  const lower = (host ?? '').toLowerCase();
  const ipv6 = BRACKETED_IPV6.exec(lower);
  if (ipv6) return isIP(ipv6[1]) === 6;

  const nameWithDot = NAME_AND_PORT.exec(lower)?.[1];
  if (!nameWithDot) return false;
  const name = nameWithDot.endsWith('.') ? nameWithDot.slice(0, -1) : nameWithDot;
  if (isIP(name) === 4) return true;

  const labels = name.split('.');
  if (!labels.every(label => LABEL.test(label))) return false;
  return labels.length === 1 || labels.at(-1) === 'local';
}

/** The host that the browser asked for: the Host header, or the host of the URL when a request has no Host header */
export function hostOfRequest(hostHeader: string | undefined, url: string): string {
  return hostHeader ?? new URL(url).host;
}
