import { describe, expect, it } from 'vitest';
import { testMachine } from '../test/testMachine';
import { groupByMaker } from './machineGroups';

describe('groupByMaker', () => {
  it('puts the machines of each maker together, in the order they come', () => {
    const brother = testMachine({ id: 'a' });
    const haas = testMachine({ id: 'b', type: 'haas' } as never);
    const brother2 = testMachine({ id: 'c' });
    expect(groupByMaker([brother, haas, brother2])).toEqual([
      { maker: 'Brother', machines: [brother, brother2] },
      { maker: 'Haas', machines: [haas] },
    ]);
  });
});
