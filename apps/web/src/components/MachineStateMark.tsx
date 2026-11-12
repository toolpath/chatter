import { cn } from '@toolpath/ui';
import { STATE_LABELS, type MachineState } from '../machines/machineStatus';
import { AlarmIcon, ConnectingIcon, OfflineIcon } from './ui/icons';
import { rem } from './ui/units';

/** The fill color of each state, for the dot and the progress bar */
const STATE_FILL_COLORS: Record<MachineState, string> = {
  running: 'bg-running',
  idle: 'bg-idle',
  alarm: 'bg-alarm',
  connecting: 'bg-offline',
  offline: 'bg-offline',
};

/** It turns, but stands still for a user who asks the system for less motion */
const CONNECTING_ICON_CLASS = 'motion-safe:animate-spin';

/**
 * The small mark for a machine state: a warning sign for an alarm, a turning ring while connecting,
 * a no-signal sign when offline, and a colored dot for running and idle. Give `label` when no text next to it says the state.
 */
export function StateIcon({ state, label = false, size = 14 }: { state: MachineState; label?: boolean; size?: number }) {
  const accessibilityProps = label ? { role: 'img', 'aria-label': STATE_LABELS[state] } : { 'aria-hidden': true };

  return (
    <span className="inline-flex shrink-0 items-center justify-center" style={{ width: rem(size), height: rem(size) }} {...accessibilityProps}>
      {state === 'alarm' && <AlarmIcon size={size} className="text-alarm-icon" />}
      {state === 'connecting' && <ConnectingIcon size={size} className={cn('text-zinc-300', CONNECTING_ICON_CLASS)} />}
      {state === 'offline' && <OfflineIcon size={size} className="text-offline-icon" />}
      {(state === 'running' || state === 'idle') && <span className={cn('size-2 rounded-full', STATE_FILL_COLORS[state])} />}
    </span>
  );
}

/** The state as a mark and a word, for table cells */
export function StateLabel({ state }: { state: MachineState }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold whitespace-nowrap">
      <StateIcon state={state} />
      {STATE_LABELS[state]}
    </span>
  );
}

const BADGE_COLORS: Record<MachineState, string> = {
  running: 'bg-running text-on-primary',
  idle: 'bg-idle text-on-primary',
  alarm: 'bg-alarm text-white',
  connecting: 'bg-zinc-700 text-zinc-50',
  offline: 'bg-zinc-700 text-zinc-50',
};

/** The big state tag next to the machine name */
export function StateBadge({ state }: { state: MachineState }) {
  return (
    <span
      className={cn(
        'inline-flex h-[1.625rem] items-center gap-1.5 rounded-md px-2.5 text-xs font-bold tracking-[.03em] uppercase',
        BADGE_COLORS[state],
      )}
    >
      {state === 'alarm' && <AlarmIcon size={14} strokeWidth={2} />}
      {state === 'connecting' && <ConnectingIcon size={14} className={CONNECTING_ICON_CLASS} />}
      {STATE_LABELS[state]}
    </span>
  );
}

/** A thin bar that shows how far a value is, from 0 to 1 */
export function ProgressBar({ fraction, state }: { fraction: number; state?: MachineState }) {
  return (
    <div aria-hidden="true" className="h-1 overflow-hidden rounded-sm bg-zinc-700">
      <div
        className={cn('h-full rounded-sm', state ? STATE_FILL_COLORS[state] : 'bg-primary')}
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </div>
  );
}
