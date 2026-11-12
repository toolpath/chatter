import type { SettingsTable } from '../storage/settingsTable.js';
import { ProxyHeaderSenders, type HeaderSender } from './proxyHeaderSenders.js';
import { ProxyAddressError, ProxyTrust, type RequestFacts, type RequestOrigin } from './proxyTrust.js';

/** Where the list of trusted proxies is saved, as text like "127.0.0.1, 172.16.0.0/12" */
export interface ProxySettingStore {
  read(): string | undefined;
  write(setting: string): void;
}

const SETTING_KEY = 'trusted_proxies';

export function sqliteProxySettingStore(settings: SettingsTable): ProxySettingStore {
  return {
    read: () => settings.get(SETTING_KEY),
    write: setting => settings.set({ [SETTING_KEY]: setting }),
  };
}

/** The TRUST_PROXY environment variable is set, so the list cannot change in Settings */
export class ProxySettingLockedError extends Error {}

/** A computer that sent proxy headers, and whether Chatter believes it now */
export interface HeaderSenderStatus extends HeaderSender {
  isTrusted: boolean;
}

/**
 * The trusted reverse proxies, and the computers that sent proxy headers.
 * The TRUST_PROXY environment variable always wins.
 * Without it, the user can change the list in Settings, and Chatter saves it.
 */
export class ProxySettings {
  readonly isLocked: boolean;
  private trust: ProxyTrust;
  private readonly senders = new ProxyHeaderSenders();

  /** A bad value throws, so a typing error stops the start. The message names the setting with the bad value. */
  constructor(private readonly store: ProxySettingStore, environment: string | undefined) {
    this.isLocked = (environment ?? '').trim() !== '';
    this.trust = this.isLocked
      ? trustFrom(environment, 'TRUST_PROXY')
      : trustFrom(store.read(), 'The saved trusted proxies (Settings > HTTPS and proxy)');
  }

  /** For tests: the list is kept in memory only, so a change is lost when Chatter stops */
  static inMemory(environment?: string): ProxySettings {
    let saved: string | undefined;
    return new ProxySettings({ read: () => saved, write: setting => (saved = setting) }, environment);
  }

  /** The trusted addresses and ranges */
  get addresses(): string[] {
    return this.trust.setting;
  }

  /** Where the request really came from. A request with proxy headers also goes on the list of senders. */
  originOf(request: RequestFacts): RequestOrigin {
    const origin = this.trust.originOf(request);
    if (request.forwardedFor !== undefined) {
      const sender = origin.proxyAddress ?? origin.address;
      this.senders.record(sender, origin.proxyAddress !== undefined);
    }
    return origin;
  }

  /**
   * Trust these addresses and ranges from now on, and save them.
   * Throws ProxySettingLockedError when TRUST_PROXY is set, and ProxyAddressError for a bad entry.
   */
  save(addresses: string[]): void {
    if (this.isLocked) throw new ProxySettingLockedError('TRUST_PROXY sets the trusted proxies, so they cannot change here');
    const trust = ProxyTrust.fromSetting([...new Set(addresses)].join(','));
    this.store.write(trust.setting.join(', '));
    this.trust = trust;
  }

  /** The last computers that sent proxy headers, the newest first */
  headerSenders(): HeaderSenderStatus[] {
    return this.senders.list().map(sender => ({ ...sender, isTrusted: this.trust.trusts(sender.address) }));
  }
}

function trustFrom(setting: string | undefined, settingName: string): ProxyTrust {
  try {
    return ProxyTrust.fromSetting(setting);
  } catch (error) {
    if (error instanceof ProxyAddressError) throw new Error(`${settingName}: ${error.message}`);
    throw error;
  }
}
