import { cn } from '@toolpath/ui';
import { useState, type ReactNode } from 'react';
import { Link, matchPath, useLocation } from 'react-router-dom';
import { groupByMaker } from '../../machines/machineGroups';
import { machineStateOf } from '../../machines/machineStatus';
import type { Machine } from '../../types';
import { ROLE_LABELS } from '../../utils/roleLabels';
import { useCurrentUser } from '../CurrentUser';
import { StateIcon } from '../MachineStateMark';
import { ChevronDownIcon, MachinesIcon, SettingsIcon } from '../ui/icons';
import { ChMark, Wordmark } from './Logo';

const MACHINE_LIST_ID = 'sidebar-machine-list';

/** The same width as Tailwind's `md:`. From this width up, the menu is a column at the left. */
const WIDE_SCREEN_QUERY = '(min-width: 48rem)';

/** On a narrow screen the menu is above the page, so an open list pushes the page down */
function isNarrowScreen(): boolean {
  return !window.matchMedia(WIDE_SCREEN_QUERY).matches;
}

/** The classes of a menu item: lit for the page in use, dim with a hover face for the others */
function menuItemColors(isLit: boolean): string {
  return isLit ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-200 hover:bg-zinc-800/60 hover:text-zinc-50';
}

/** Whether the machine list is open. It starts open on a wide screen and closed on a narrow one. */
function useMachineListOpen() {
  const [isListOpen, setIsListOpen] = useState(() => !isNarrowScreen());
  return {
    isListOpen,
    toggleList: () => setIsListOpen(open => !open),
    // Going to the machines shows the list on a wide screen. On a narrow screen it closes, so the table shows.
    showListOnlyOnWideScreen: () => setIsListOpen(!isNarrowScreen()),
    // On a narrow screen, close the list after a choice, so the user sees the new page at once
    closeListOnNarrowScreen: () => {
      if (isNarrowScreen()) setIsListOpen(false);
    },
  };
}

/** The menu at the left of every page */
export function Sidebar({ machines }: { machines: Machine[] }) {
  const { pathname } = useLocation();
  const openMachineId = matchPath('/machine/:id', pathname)?.params.id;
  // The Machines item stays lit on a machine page, but only the open machine is the current page
  const isInMachines = pathname === '/' || openMachineId !== undefined;
  const { isListOpen, toggleList, showListOnlyOnWideScreen, closeListOnNarrowScreen } = useMachineListOpen();
  const hasMachines = machines.length > 0;

  return (
    <aside className="flex w-full flex-col gap-6 border-b border-zinc-800 bg-zinc-900 px-3 py-5 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
      <Link to="/" className="flex items-center gap-2.5 px-2 text-zinc-50 no-underline">
        <ChMark />
        <Wordmark size={18} cutClassName="bg-zinc-900" />
        <span className="sr-only">: all machines</span>
      </Link>

      <nav aria-label="Main" className="flex flex-col gap-0.5">
        <NavItem
          to="/"
          isCurrent={pathname === '/'}
          isLit={isInMachines}
          icon={<MachinesIcon />}
          count={machines.length}
          onClick={showListOnlyOnWideScreen}
          action={hasMachines && <ListToggle isOpen={isListOpen} onToggle={toggleList} />}
        >
          Machines
        </NavItem>
        {hasMachines && isListOpen && (
          <MachineList machines={machines} openMachineId={openMachineId} onPick={closeListOnNarrowScreen} />
        )}
      </nav>

      <UserBox isInSettings={pathname === '/settings'} />
    </aside>
  );
}

interface NavItemProps {
  to: string;
  isCurrent: boolean;
  /** Lit, but not the current page. It is the same as `isCurrent` when not given. */
  isLit?: boolean;
  icon: ReactNode;
  count?: number;
  onClick?: () => void;
  /** A button at the right end of the item, outside the link */
  action?: ReactNode;
  children: ReactNode;
}

function NavItem({ to, isCurrent, isLit = isCurrent, icon, count, onClick, action, children }: NavItemProps) {
  return (
    <div className={cn('flex min-h-10 items-center rounded-md', menuItemColors(isLit))}>
      <Link
        to={to}
        aria-current={isCurrent ? 'page' : undefined}
        onClick={onClick}
        className="flex flex-1 items-center gap-2.5 self-stretch px-2.5 font-semibold text-inherit no-underline"
      >
        {icon}
        {children}
        {count !== undefined && <span className="ml-auto font-mono text-xs text-zinc-200">{count}</span>}
      </Link>
      {action}
    </div>
  );
}

/** The button that shows or hides the machine list */
function ListToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label="Machine list"
      aria-expanded={isOpen}
      aria-controls={MACHINE_LIST_ID}
      onClick={onToggle}
      className="mr-1 inline-flex size-8 items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-700 hover:text-zinc-50"
    >
      <ChevronDownIcon className={cn('transition-transform', !isOpen && '-rotate-90')} />
    </button>
  );
}

/**
 * All machines, in groups by maker, so the user can go to any machine from any page.
 * `onPick` runs when the user picks a machine.
 */
function MachineList({ machines, openMachineId, onPick }: { machines: Machine[]; openMachineId?: string; onPick: () => void }) {
  return (
    <div id={MACHINE_LIST_ID} className="flex flex-col gap-2.5 py-1.5 pl-3">
      {groupByMaker(machines).map(group => (
        <div key={group.maker} role="group" aria-label={group.maker} className="flex flex-col gap-0.5">
          <span className="flex justify-between px-2.5 text-[0.6875rem] font-bold tracking-[.05em] text-zinc-300 uppercase">
            {group.maker}
            <span className="font-mono font-medium">{group.machines.length}</span>
          </span>
          {group.machines.map(machine => (
            <MachineLink key={machine.id} machine={machine} isOpen={machine.id === openMachineId} onPick={onPick} />
          ))}
        </div>
      ))}
    </div>
  );
}

function MachineLink({ machine, isOpen, onPick }: { machine: Machine; isOpen: boolean; onPick: () => void }) {
  return (
    <Link
      to={`/machine/${machine.id}`}
      aria-current={isOpen ? 'page' : undefined}
      onClick={onPick}
      className={cn('flex min-h-9 items-center gap-2 rounded-md px-2.5 text-[0.8125rem] no-underline', menuItemColors(isOpen))}
    >
      <StateIcon state={machineStateOf(machine)} label />
      <span className="truncate">{machine.name}</span>
    </Link>
  );
}

/** The user who is logged in, with a gear that opens the settings. Log out is in the settings. */
function UserBox({ isInSettings }: { isInSettings: boolean }) {
  const user = useCurrentUser();
  const username = user?.username;
  return (
    <div className="mt-auto flex items-center gap-2.5 border-t border-zinc-800 px-2.5 pt-3">
      <span aria-hidden="true" className="inline-flex size-7 items-center justify-center rounded-full bg-zinc-700 text-xs font-bold uppercase">
        {username?.charAt(0) ?? '?'}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{username}</span>
        {user && <span className="text-xs text-zinc-300">{ROLE_LABELS[user.role]}</span>}
      </span>
      <Link
        to="/settings"
        aria-label="Settings"
        title="Settings"
        aria-current={isInSettings ? 'page' : undefined}
        className={cn('inline-flex size-9 items-center justify-center rounded-md', menuItemColors(isInSettings))}
      >
        <SettingsIcon size={18} />
      </Link>
    </div>
  );
}
