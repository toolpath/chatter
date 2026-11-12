import { cn } from '@toolpath/ui';
import { STATE_LABELS } from '../../machines/machineStatus';
import { STATE_FILTERS, type StateFilter } from './machineFilter';

const DOT_COLORS: Record<StateFilter, string> = {
  all: 'bg-zinc-50',
  running: 'bg-running',
  idle: 'bg-idle',
  alarm: 'bg-alarm',
  offline: 'bg-offline',
};

function filterLabel(filter: StateFilter): string {
  return filter === 'all' ? 'All' : STATE_LABELS[filter];
}

interface StateFiltersProps {
  counts: Record<StateFilter, number>;
  value: StateFilter;
  onChange: (value: StateFilter) => void;
}

/** One button for each state, with the number of machines in it. One button is pressed at a time. */
export function StateFilters({ counts, value, onChange }: StateFiltersProps) {
  return (
    <div role="group" aria-label="Show machines" className="flex flex-wrap gap-2">
      {STATE_FILTERS.map(filter => (
        <StateFilterButton
          key={filter}
          filter={filter}
          count={counts[filter]}
          isPressed={filter === value}
          onPress={() => onChange(filter)}
        />
      ))}
    </div>
  );
}

interface StateFilterButtonProps {
  filter: StateFilter;
  count: number;
  isPressed: boolean;
  onPress: () => void;
}

function StateFilterButton({ filter, count, isPressed, onPress }: StateFilterButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={isPressed}
      onClick={onPress}
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-lg border px-3.5 font-semibold text-zinc-50',
        isPressed ? 'border-zinc-500 bg-zinc-800' : 'border-zinc-800 bg-transparent hover:bg-zinc-900',
      )}
    >
      <span aria-hidden="true" className={cn('size-2 rounded-full', DOT_COLORS[filter])} />
      {filterLabel(filter)}
      <span className="font-mono text-base font-medium">{count}</span>
    </button>
  );
}
