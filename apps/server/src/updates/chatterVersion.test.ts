import { describe, expect, it } from 'vitest';
import { chatterVersion } from './chatterVersion.js';

describe('chatterVersion', () => {
  it('gives the version that the image build set', () => {
    expect(chatterVersion({ CHATTER_VERSION: '1.2.0' })).toBe('1.2.0');
    expect(chatterVersion({ CHATTER_VERSION: 'edge-1a2b3c4' })).toBe('edge-1a2b3c4');
  });

  it('gives "development" when nothing set it', () => {
    expect(chatterVersion({})).toBe('development');
    expect(chatterVersion({ CHATTER_VERSION: ' ' })).toBe('development');
  });
});
