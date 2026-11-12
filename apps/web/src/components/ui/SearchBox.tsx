import { cn } from '@toolpath/ui';
import { SearchIcon } from './icons';

interface SearchBoxProps {
  /** Read by screen readers. The box shows only the placeholder. */
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** A search box with a magnifier */
export function SearchBox({ label, placeholder, value, onChange, className }: SearchBoxProps) {
  return (
    <label
      className={cn(
        'flex h-10 min-w-56 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-zinc-300',
        'focus-within:border-zinc-500',
        className,
      )}
    >
      <SearchIcon />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 flex-1 border-0 bg-transparent text-zinc-50 outline-none placeholder:text-zinc-400"
      />
    </label>
  );
}
