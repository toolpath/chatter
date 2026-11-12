import type { Machine } from '../types';
import { makerOf } from './machineStatus';

export interface MakerGroup {
  maker: string;
  machines: Machine[];
}

/** The machines in groups by maker, in the order of the first machine of each maker */
export function groupByMaker(machines: Machine[]): MakerGroup[] {
  const machinesByMaker = new Map<string, Machine[]>();
  for (const machine of machines) {
    const maker = makerOf(machine);
    const group = machinesByMaker.get(maker);
    if (group) group.push(machine);
    else machinesByMaker.set(maker, [machine]);
  }
  return [...machinesByMaker].map(([maker, makerMachines]) => ({ maker, machines: makerMachines }));
}
