import { describe, expect, it } from 'vitest';
import { OPCUA_NO_ENCRYPTION_WARNING, opcuaSecurityWarning } from './machines.js';

// F-11, D6: Security None with a login is allowed, but Chatter warns
describe('opcuaSecurityWarning', () => {
  it('warns when a user logs in with Security None', () => {
    expect(opcuaSecurityWarning({ opcuaSecurity: 'none', opcuaUser: 'OpcUaClient' })).toBe(OPCUA_NO_ENCRYPTION_WARNING);
  });

  it('does not warn with Sign and encrypt', () => {
    expect(opcuaSecurityWarning({ opcuaSecurity: 'signAndEncrypt', opcuaUser: 'OpcUaClient' })).toBeNull();
  });

  it('does not warn for an anonymous login, because it sends no login', () => {
    expect(opcuaSecurityWarning({ opcuaSecurity: 'none', opcuaUser: '' })).toBeNull();
    expect(opcuaSecurityWarning({ opcuaSecurity: 'none', opcuaUser: '   ' })).toBeNull();
    expect(opcuaSecurityWarning({ opcuaSecurity: 'none' })).toBeNull();
  });

  it('tells the user to set Security to Sign and encrypt', () => {
    expect(OPCUA_NO_ENCRYPTION_WARNING).toContain('Security is None.');
    expect(OPCUA_NO_ENCRYPTION_WARNING).toContain('Set Security to Sign and encrypt.');
  });
});
