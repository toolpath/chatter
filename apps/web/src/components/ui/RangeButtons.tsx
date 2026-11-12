import { cn } from '@toolpath/ui';

/** A time range that a button can show. The id is the button text, such as "24h". */
export interface RangeOption {
  id: string;
}

interface RangeButtonsProps<Option extends RangeOption> {
  options: readonly Option[];
  value: Option;
  onChange: (option: Option) => void;
}

/** A row of buttons for a time range. The pressed button shows the range in use. */
export function RangeButtons<Option extends RangeOption>({ options, value, onChange }: RangeButtonsProps<Option>) {
  return (
    <div role="group" aria-label="Time range" className="inline-flex gap-0.5 rounded-lg bg-zinc-950 p-[0.1875rem]">
      {options.map(option => {
        const isPressed = option.id === value.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={isPressed}
            onClick={() => onChange(option)}
            className={cn(
              'min-h-8 rounded-md border-0 px-2.5',
              isPressed ? 'bg-zinc-700 font-bold text-zinc-50' : 'bg-transparent font-semibold text-zinc-200 hover:text-zinc-50',
            )}
          >
            {option.id}
          </button>
        );
      })}
    </div>
  );
}
