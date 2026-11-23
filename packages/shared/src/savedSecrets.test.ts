import { describe, expect, it } from 'vitest';
import type { ChannelField, ChannelValues } from './notifications.js';
import {
  channelFieldLabels,
  movedChannelSecrets,
  movedChannelSecretsText,
  mustTypePasswordAgain,
  type PasswordAddress,
} from './savedSecrets.js';

const field = (key: string, label: string, kind: ChannelField['kind'], required = false): ChannelField => ({ key, label, kind, required });

const SERVER = field('url', 'Server address (optional)', 'url');
const BACKUP = field('backup', 'Backup address', 'url');
const TOKEN = field('token', 'Token (optional)', 'secret');
const SECRET = field('secret', 'Secret', 'secret', true);
const TOPIC = field('topic', 'Topic', 'text', true);
const FIELDS = [SERVER, BACKUP, TOKEN, SECRET, TOPIC];

const SAVED_SETTINGS: ChannelValues = { url: 'https://a.example.com', backup: 'https://b.example.com', topic: 'shop' };
const SAVED = { url: 'https://a.example.com', backup: 'https://b.example.com', topic: 'shop', token: '', secret: '' };

/** The keys of the moved secrets and of the changed addresses, or null */
function moved(values: ChannelValues, savedSecrets = ['token', 'secret']) {
  const result = movedChannelSecrets(FIELDS, values, SAVED_SETTINGS, key => savedSecrets.includes(key));
  return result && { changed: result.changed.map(entry => entry.key), kept: result.kept.map(entry => entry.key) };
}

describe('movedChannelSecrets', () => {
  it.each<[string, ChannelValues, string[], ReturnType<typeof moved>]>([
    ['no change', SAVED, ['token', 'secret'], null],
    ['the same address with spaces around it', { ...SAVED, url: '  https://a.example.com  ' }, ['token', 'secret'], null],
    ['a new text field that is not an address', { ...SAVED, topic: 'office' }, ['token', 'secret'], null],
    ['a new address, both secrets kept', { ...SAVED, url: 'https://c.example.com' }, ['token', 'secret'],
      { changed: ['url'], kept: ['token', 'secret'] }],
    ['an empty address, which is the default address', { ...SAVED, url: '' }, ['token', 'secret'],
      { changed: ['url'], kept: ['token', 'secret'] }],
    ['an address that is not there', { backup: SAVED.backup }, ['token', 'secret'], { changed: ['url'], kept: ['token', 'secret'] }],
    ['two addresses, only one changed', { ...SAVED, backup: '' }, ['token', 'secret'], { changed: ['backup'], kept: ['token', 'secret'] }],
    ['two addresses changed', { ...SAVED, url: 'https://c.example.com', backup: '' }, ['token', 'secret'],
      { changed: ['url', 'backup'], kept: ['token', 'secret'] }],
    ['one of two secrets typed again', { ...SAVED, url: 'https://c.example.com', token: 'new' }, ['token', 'secret'],
      { changed: ['url'], kept: ['secret'] }],
    ['a secret with only spaces, which keeps the saved one', { ...SAVED, url: 'https://c.example.com', token: '  ', secret: 'new' },
      ['token', 'secret'], { changed: ['url'], kept: ['token'] }],
    ['both secrets typed again', { ...SAVED, url: 'https://c.example.com', token: 'a', secret: 'b' }, ['token', 'secret'], null],
    ['no saved secret (or each one deleted)', { ...SAVED, url: 'https://c.example.com' }, [], null],
  ])('%s', (_name, values, savedSecrets, expected) => {
    expect(moved(values, savedSecrets)).toEqual(expected);
  });
});

describe('movedChannelSecretsText', () => {
  it('names each kept secret and each changed address, and tells how to use no secret', () => {
    expect(movedChannelSecretsText({ changed: [SERVER, BACKUP], kept: [TOKEN, SECRET] })).toBe(
      'Type the Token and the Secret again. You changed the Server address and the Backup address. '
      + 'Chatter does not send a saved secret to a new address. To use no secret, select Delete the saved secret.');
  });

  it('does not tell to delete a secret that is necessary', () => {
    expect(movedChannelSecretsText({ changed: [SERVER], kept: [SECRET] })).toBe(
      'Type the Secret again. You changed the Server address. Chatter does not send a saved secret to a new address.');
  });
});

describe('channelFieldLabels', () => {
  it('removes "(optional)" from each label', () => {
    expect(channelFieldLabels([SERVER, TOKEN, SECRET])).toBe('Server address and the Token and the Secret');
  });
});

describe('mustTypePasswordAgain', () => {
  const SAVED_ADDRESS: PasswordAddress = { host: '192.168.1.50', port: 21 };

  it.each<[string, { hasSavedPassword?: boolean; isPasswordSent?: boolean; change: Partial<PasswordAddress> }, boolean]>([
    ['no change', { change: {} }, false],
    ['the same IP address and port', { change: { host: '192.168.1.50', port: 21 } }, false],
    ['a new IP address', { change: { host: '192.168.1.51' } }, true],
    ['a new port', { change: { port: 2121 } }, true],
    ['a new IP address with the password sent again', { isPasswordSent: true, change: { host: '192.168.1.51' } }, false],
    ['a new IP address and no saved password', { hasSavedPassword: false, change: { host: '192.168.1.51' } }, false],
  ])('%s', (_name, { hasSavedPassword = true, isPasswordSent = false, change }, expected) => {
    expect(mustTypePasswordAgain({ hasSavedPassword, isPasswordSent, saved: SAVED_ADDRESS, change })).toBe(expected);
  });
});
