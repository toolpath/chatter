import { describe, expect, it } from 'vitest';
import { machineRequest, PROFILES } from './profiles.js';

describe('machineRequest', () => {
  it('tells Chatter to find the machine at the given address', () => {
    const request = machineRequest(PROFILES[0], '192.168.1.83');
    expect(request).toMatchObject({ type: 'brother', name: 'Fake Brother Speedio', host: '192.168.1.83', dataPort: 10000 });
  });

  it('gives every machine the same address', () => {
    expect(PROFILES.map(profile => machineRequest(profile, '127.0.0.1').host)).toEqual(PROFILES.map(() => '127.0.0.1'));
  });
});
