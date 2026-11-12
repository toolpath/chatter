import { cn } from '@toolpath/ui';
import { useEffect, useState } from 'react';
import { useCan } from '../../components/CurrentUser';
import { Button } from '../../components/ui/Button';
import { PlusIcon, ScanIcon } from '../../components/ui/icons';
import { Modal } from '../../components/ui/Modal';
import { SearchBox } from '../../components/ui/SearchBox';
import { useNow } from '../../hooks/useNow';
import type { AddMachineRequest, Machine } from '../../types';
import { AddMachinePanel } from './AddMachinePanel';
import { FindMachinesPanel } from './FindMachinesPanel';
import { byUrgency, countByState, filterMachines, type StateFilter } from './machineFilter';
import { MachineTable } from './MachineTable';
import { StateFilters } from './StateFilters';

/** How often the "Last poll" times count up */
const CLOCK_TICK_MS = 1000;

interface DashboardPageProps {
  machines: Machine[];
  /** True while the live connection to the server is open */
  isLive: boolean;
  /** False until the server sent the machine list the first time */
  isLoaded: boolean;
  addMachine: (machine: AddMachineRequest) => Promise<void>;
}

type OpenPanel = 'add' | 'find' | null;

/** The app looks for machines by itself only one time each page load */
let hasAutoScanned = false;

interface OpenPanelOptions {
  canManageMachines: boolean;
  isLoaded: boolean;
  machineCount: number;
}

/**
 * Which panel is open, in a modal over the page. With no machines yet, the Find machines panel
 * opens by itself and scans at once (the first start).
 */
function useOpenPanel({ canManageMachines, isLoaded, machineCount }: OpenPanelOptions) {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [isFirstStart, setIsFirstStart] = useState(false);

  useEffect(() => {
    if (canManageMachines && isLoaded && machineCount === 0 && !hasAutoScanned) {
      hasAutoScanned = true;
      setIsFirstStart(true);
      setOpenPanel('find');
    }
    // Only when the machine list arrives
  }, [isLoaded]);

  // A click on Find machines never scans by itself. Only the first start does.
  const openFindPanel = () => {
    setIsFirstStart(false);
    setOpenPanel('find');
  };
  const openAddPanel = () => setOpenPanel('add');
  const closePanel = () => setOpenPanel(null);

  return { openPanel, isFirstStart, openFindPanel, openAddPanel, closePanel };
}

/** All machines in one table, with a search and a filter by state */
export function DashboardPage({ machines, isLive, isLoaded, addMachine }: DashboardPageProps) {
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const now = useNow(CLOCK_TICK_MS);
  const canManageMachines = useCan('manage-machines');
  const { openPanel, isFirstStart, openFindPanel, openAddPanel, closePanel } =
    useOpenPanel({ canManageMachines, isLoaded, machineCount: machines.length });

  const shownMachines = filterMachines(machines, search, stateFilter).sort(byUrgency);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="m-0 font-display text-2xl font-extrabold">Machines</h1>
          <LiveMark isLive={isLive} />
        </div>
        <div className="flex flex-wrap gap-2">
          <SearchBox label="Find a machine" placeholder="Name, program or IP" value={search} onChange={setSearch} />
          {canManageMachines && (
            <>
              <Button onClick={openFindPanel}>
                <ScanIcon /> Find machines
              </Button>
              <Button variant="primary" onClick={openAddPanel}>
                <PlusIcon /> Add machine
              </Button>
            </>
          )}
        </div>
      </div>

      {openPanel === 'add' && (
        <Modal label="Add a machine" onClose={closePanel}>
          <AddMachinePanel onAdd={addMachine} onClose={closePanel} />
        </Modal>
      )}
      {openPanel === 'find' && (
        <Modal label="Find machines on the network" onClose={closePanel}>
          <FindMachinesPanel machines={machines} onAdd={addMachine} autoStart={isFirstStart} onClose={closePanel} />
        </Modal>
      )}

      {machines.length === 0 ? (
        <EmptyState canAdd={canManageMachines} />
      ) : (
        <>
          <StateFilters counts={countByState(machines)} value={stateFilter} onChange={setStateFilter} />
          {shownMachines.length > 0 ? <MachineTable machines={shownMachines} now={now} /> : <NoMatchingMachine />}
          <p className="m-0 text-xs text-zinc-300">Click a machine name to open it. Machines with an alarm come first.</p>
        </>
      )}
    </>
  );
}

function LiveMark({ isLive }: { isLive: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-200" role="status">
      <span aria-hidden="true" className={cn('size-2 rounded-full', isLive ? 'bg-running' : 'bg-offline')} />
      {isLive ? 'Live' : 'Not live: reconnecting'}
    </span>
  );
}

function EmptyState({ canAdd }: { canAdd: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-700 px-5 py-12 text-center">
      <p className="m-0 text-base font-bold">No machines yet</p>
      <p className="m-0 text-zinc-200">
        {canAdd
          ? 'Click Find machines to look for them on the network, or Add machine to type an IP address.'
          : 'An admin adds the machines.'}
      </p>
    </div>
  );
}

function NoMatchingMachine() {
  return (
    <p className="m-0 rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-8 text-center text-zinc-200">
      No machine matches. Clear the search or pick All.
    </p>
  );
}
