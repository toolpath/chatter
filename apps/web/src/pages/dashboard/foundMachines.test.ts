import { describe, expect, it } from 'vitest';
import { testMachine } from '../../test/testMachine';
import type { FoundMachine } from '../../types';
import { foundKeyOf, isAlreadyAdded, mergeFound, rangeWords } from './foundMachines';

/** An MTConnect machine that a scan found at this address and port */
const foundAt = (host: string, mtConnectPort: number): FoundMachine => ({
  machine: { type: 'mtconnect', name: 'Okuma', host, mtConnectPort },
  isConfirmed: true,
  detail: '',
});

describe('foundKeyOf', () => {
  it('uses the address and the data port', () => {
    expect(foundKeyOf(foundAt('10.0.0.5', 5001))).toBe('10.0.0.5:5001');
  });
});

describe('isAlreadyAdded', () => {
  it('matches a machine with the same address and port only', () => {
    const okuma = testMachine({ type: 'mtconnect', host: '10.0.0.5', mtConnectPort: 5000 } as never);
    expect(isAlreadyAdded(foundAt('10.0.0.5', 5000), [okuma])).toBe(true);
    expect(isAlreadyAdded(foundAt('10.0.0.5', 5001), [okuma])).toBe(false);
  });
});

describe('mergeFound', () => {
  it('keeps the order, and adds each machine once', () => {
    const firstScanMachine = foundAt('10.0.0.5', 5000);
    const newMachine = foundAt('10.0.0.6', 5000);
    const sameAsFirst = foundAt('10.0.0.5', 5000);
    expect(mergeFound([firstScanMachine], [sameAsFirst, newMachine])).toEqual([firstScanMachine, newMachine]);
  });
});

describe('rangeWords', () => {
  it('names the first and the last address', () => {
    expect(rangeWords('192.168.1')).toBe('192.168.1.1 to 192.168.1.254');
  });
});
