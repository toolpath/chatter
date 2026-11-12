import { describe, expect, it } from 'vitest';
import { ProxyAddressError, ProxyTrust, type RequestFacts } from './proxyTrust.js';

const PROXY = '127.0.0.1';
const USER = '192.168.1.20';

function request(facts: Partial<RequestFacts>): RequestFacts {
  return { socketAddress: PROXY, url: 'http://chatterbox:3001/api/auth/login', ...facts };
}

describe('ProxyTrust', () => {
  describe('with no TRUST_PROXY setting', () => {
    const trust = ProxyTrust.fromSetting(undefined);

    it('uses the address of the connection, and ignores the proxy headers', () => {
      const origin = trust.originOf(request({ socketAddress: USER, forwardedFor: '10.0.0.9', forwardedProto: 'https' }));

      expect(origin).toEqual({ address: USER, isHttps: false });
    });

    it('sees HTTPS from the URL', () => {
      expect(trust.originOf(request({ url: 'https://chatterbox/api' })).isHttps).toBe(true);
    });
  });

  describe('with a trusted proxy', () => {
    const trust = ProxyTrust.fromSetting(PROXY);

    it('uses the user address and the HTTPS mark that the proxy sends', () => {
      const origin = trust.originOf(request({ forwardedFor: USER, forwardedProto: 'https' }));

      expect(origin).toEqual({ address: USER, isHttps: true, proxyAddress: PROXY });
    });

    it('ignores the proxy headers from a computer that is not the proxy', () => {
      const origin = trust.originOf(request({ socketAddress: USER, forwardedFor: '10.0.0.9', forwardedProto: 'https' }));

      expect(origin).toEqual({ address: USER, isHttps: false });
    });

    it('uses the address that the proxy added, so a user cannot send a false address', () => {
      // The user sent "10.0.0.9" in the header, and the proxy added the real address
      const origin = trust.originOf(request({ forwardedFor: `10.0.0.9, ${USER}` }));

      expect(origin.address).toBe(USER);
    });

    it('uses the proxy address when the header is not an address', () => {
      expect(trust.originOf(request({ forwardedFor: 'nonsense' })).address).toBe(PROXY);
    });

    it('accepts the proxy address in its IPv6 form', () => {
      expect(trust.originOf(request({ socketAddress: `::ffff:${PROXY}`, forwardedFor: USER })).address).toBe(USER);
    });
  });

  it('trusts each proxy in a range', () => {
    const trust = ProxyTrust.fromSetting('127.0.0.1, 172.16.0.0/12');

    expect(trust.originOf(request({ socketAddress: '172.18.0.5', forwardedFor: USER })).address).toBe(USER);
  });

  it('reads only the last address, also when the user is in the trusted range', () => {
    // The user 172.18.0.9 sent "8.8.8.8" to get a new address for each try. The proxy added the real one.
    const trust = ProxyTrust.fromSetting('172.16.0.0/12');

    const origin = trust.originOf(request({ socketAddress: '172.18.0.1', forwardedFor: '8.8.8.8, 172.18.0.9' }));

    expect(origin.address).toBe('172.18.0.9');
  });

  it.each([
    ['192.168.1.20:5555', USER],
    ['[2001:db8::7]:5555', '2001:db8::7'],
    ['[2001:db8::7]', '2001:db8::7'],
  ])('removes the port that some proxies add: %s', (forwardedFor, address) => {
    expect(ProxyTrust.fromSetting(PROXY).originOf(request({ forwardedFor })).address).toBe(address);
  });

  it.each(['localhost', '10.0.0.0/33', '10.0.0.0/x'])('refuses "%s"', setting => {
    expect(() => ProxyTrust.fromSetting(setting)).toThrow(ProxyAddressError);
  });

  it('trusts an address in each of its forms', () => {
    const trust = ProxyTrust.fromSetting('172.16.0.0/12');

    expect(trust.trusts('172.18.0.1')).toBe(true);
    expect(trust.trusts('::ffff:172.18.0.1')).toBe(true);
    expect(trust.trusts('192.168.1.20')).toBe(false);
    expect(trust.trusts('not an address')).toBe(false);
  });
});
