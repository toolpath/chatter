import { createLogger } from '../logging/logger.js';

const log = createLogger('proxy');

/** The list never gets longer than this. When it is full, the oldest entry goes. */
export const MAX_SENDERS = 20;
/** Each computer that is not trusted is logged one time, up to this many, so the log does not fill up */
export const MAX_WARNED_ADDRESSES = 20;

/** A computer that sent proxy headers (X-Forwarded-For) */
export interface HeaderSender {
  address: string;
  lastSeen: Date;
}

/**
 * The last computers that sent proxy headers. This helps the user find the address of their proxy.
 * A computer that is not trusted is also written to the log, one time, for users who read the log.
 */
export class ProxyHeaderSenders {
  /** A Map keeps the order of insertion, so the first key is the oldest */
  private readonly lastSeen = new Map<string, Date>();
  private readonly warnedAddresses = new Set<string>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  record(address: string, isTrusted: boolean): void {
    // Delete first, so the address moves to the end of the Map
    this.lastSeen.delete(address);
    this.lastSeen.set(address, this.now());
    this.dropOldest();
    if (!isTrusted) this.warnOneTime(address);
  }

  /** The newest first */
  list(): HeaderSender[] {
    return [...this.lastSeen].map(([address, lastSeen]) => ({ address, lastSeen })).reverse();
  }

  private dropOldest(): void {
    const oldest = this.lastSeen.keys().next();
    if (this.lastSeen.size > MAX_SENDERS && !oldest.done) this.lastSeen.delete(oldest.value);
  }

  private warnOneTime(address: string): void {
    if (this.warnedAddresses.has(address) || this.warnedAddresses.size >= MAX_WARNED_ADDRESSES) return;
    this.warnedAddresses.add(address);
    warnAboutHeadersFrom(address);
  }
}

function warnAboutHeadersFrom(address: string): void {
  log.warn(
    'A computer that is not a trusted proxy sent X-Forwarded-For, so Chatter ignores it. ' +
    'If this is your reverse proxy, trust it in Settings > HTTPS and proxy, or add it to TRUST_PROXY.',
    { address },
  );
}
