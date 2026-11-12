import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SettingsTable } from '../storage/settingsTable.js';
import { ProxySettingLockedError, ProxySettings, sqliteProxySettingStore } from './proxySettings.js';
import { ProxyAddressError, type RequestFacts } from './proxyTrust.js';

const PROXY = '172.18.0.1';
const USER = '192.168.1.20';

function fromProxy(facts: Partial<RequestFacts> = {}): RequestFacts {
  return { socketAddress: PROXY, url: 'http://chatter:3001/api', forwardedFor: USER, ...facts };
}

describe('ProxySettings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('trusts the saved list after a new start', () => {
    const store = sqliteProxySettingStore(new SettingsTable(new Database(':memory:')));
    new ProxySettings(store, undefined).save([PROXY]);

    const afterStart = new ProxySettings(store, undefined);

    expect(afterStart.addresses).toEqual([PROXY]);
    expect(afterStart.originOf(fromProxy()).address).toBe(USER);
  });

  it('trusts a new list at once', () => {
    const settings = ProxySettings.inMemory();
    expect(settings.originOf(fromProxy()).address).toBe(PROXY);

    settings.save([PROXY, PROXY]);

    expect(settings.addresses).toEqual([PROXY]);
    expect(settings.originOf(fromProxy())).toEqual({ address: USER, isHttps: false, proxyAddress: PROXY });
  });

  it('keeps the old list when an entry is bad', () => {
    const settings = ProxySettings.inMemory();
    settings.save([PROXY]);

    expect(() => settings.save(['localhost'])).toThrow(ProxyAddressError);
    expect(settings.addresses).toEqual([PROXY]);
  });

  it('uses TRUST_PROXY when it is set, and then refuses a change', () => {
    const store = sqliteProxySettingStore(new SettingsTable(new Database(':memory:')));
    store.write('10.0.0.1');

    const settings = new ProxySettings(store, ` ${PROXY} `);

    expect(settings.isLocked).toBe(true);
    expect(settings.addresses).toEqual([PROXY]);
    expect(() => settings.save(['10.0.0.2'])).toThrow(ProxySettingLockedError);
  });

  it('names TRUST_PROXY when its value is bad, so the start stops with a clear message', () => {
    expect(() => ProxySettings.inMemory('localhost')).toThrow(/TRUST_PROXY: "localhost"/);
  });

  it('names the saved list when its value is bad', () => {
    const store = sqliteProxySettingStore(new SettingsTable(new Database(':memory:')));
    store.write('localhost');

    expect(() => new ProxySettings(store, undefined)).toThrow(/saved trusted proxies.*"localhost"/);
  });

  it('lists the computers that sent proxy headers, with the trust of the current list', () => {
    const settings = ProxySettings.inMemory();
    settings.originOf(fromProxy());
    settings.originOf(fromProxy({ socketAddress: USER, forwardedFor: undefined }));
    expect(settings.headerSenders().map(({ address, isTrusted }) => ({ address, isTrusted }))).toEqual([
      { address: PROXY, isTrusted: false },
    ]);

    settings.save([PROXY]);

    expect(settings.headerSenders()[0].isTrusted).toBe(true);
  });
});
