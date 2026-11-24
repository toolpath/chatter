import { Link, useSearchParams } from 'react-router';
import { StateBadge } from '../../components/MachineStateMark';
import { AlarmIcon } from '../../components/ui/icons';
import { machineAddress, machineTypeLabel, makerOf, type MachineState } from '../../machines/machineStatus';
import type { Machine } from '../../types';
import { formatAgo } from '../../utils/formatters';
import { FIRST_TAB, tabInAddress, tabLink } from './machineTabs';

interface MachineHeaderProps {
  machine: Machine;
  state: MachineState;
  now: number;
  /** The number of alerts that fire now */
  firingCount: number;
}

/** The maker, the machine name, its state, the firing alerts, and how to reach it */
export function MachineHeader({ machine, state, now, firingCount }: MachineHeaderProps) {
  const address = machineAddress(machine);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <MakerMark maker={makerOf(machine)} />
        <h1 className="m-0 font-display text-2xl font-extrabold">{machine.name}</h1>
        <StateBadge state={state} />
        {firingCount > 0 && <FiringBadge count={firingCount} />}
      </div>
      <p className="mt-1 mb-0 text-zinc-300">
        {machineTypeLabel(machine.type)} · {address && <><span className="font-mono">{address}</span> · </>}polled {formatAgo(machine.lastPollTime, now)}
      </p>
    </div>
  );
}

/** "2 alerts firing", in the alarm color. It opens the Dashboard tab, where the Alerts panel lists them. */
function FiringBadge({ count }: { count: number }) {
  const [searchParams] = useSearchParams();
  // When the Dashboard is open, the click adds no step to the history
  const isDashboardOpen = tabInAddress(searchParams) === FIRST_TAB;
  return (
    <Link
      to={tabLink('dashboard')}
      replace={isDashboardOpen}
      className="inline-flex h-[1.625rem] items-center gap-1.5 rounded-md bg-alarm px-2.5 text-xs font-bold tracking-[.03em] text-white no-underline hover:underline"
    >
      <AlarmIcon size={14} strokeWidth={2} />
      {count === 1 ? '1 alert firing' : `${count} alerts firing`}
    </Link>
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
