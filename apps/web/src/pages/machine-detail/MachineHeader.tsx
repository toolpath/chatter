import { StateBadge } from '../../components/MachineStateMark';
import { machineAddress, machineTypeLabel, makerOf, type MachineState } from '../../machines/machineStatus';
import type { Machine } from '../../types';
import { formatAgo } from '../../utils/formatters';

interface MachineHeaderProps {
  machine: Machine;
  state: MachineState;
  now: number;
}

/** The maker, the machine name, its state, and how to reach it */
export function MachineHeader({ machine, state, now }: MachineHeaderProps) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <MakerMark maker={makerOf(machine)} />
        <h1 className="m-0 font-display text-2xl font-extrabold">{machine.name}</h1>
        <StateBadge state={state} />
      </div>
      <p className="mt-1 mb-0 text-zinc-300">
        {machineTypeLabel(machine.type)} · <span className="font-mono">{machineAddress(machine)}</span> · polled {formatAgo(machine.lastPollTime, now)}
      </p>
    </div>
  );
}

/** The maker's name in a box */
function MakerMark({ maker }: { maker: string }) {
  return (
    <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-md border border-zinc-800 px-2 font-display text-sm font-extrabold tracking-[.04em] text-zinc-200 uppercase">
      {maker}
    </span>
  );
}
