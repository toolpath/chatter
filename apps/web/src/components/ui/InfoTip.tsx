import { cn } from '@toolpath/ui';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { InfoIcon } from './icons';

interface InfoTipProps {
  /** The name of the button for screen readers, such as "What SV1 means" */
  label: string;
  /** The words in the box */
  children: ReactNode;
  /** The side the box grows to. Use left for a button at the right edge of a box that cuts off what sticks out. */
  opensTo?: 'left' | 'right';
}

/**
 * An "i" button that shows a small box of words on hover, on keyboard focus, or on a tap.
 * Screen readers read the words as the description of the button. Escape hides the box, and the next Escape goes on.
 */
export function InfoTip({ label, children, opensTo = 'right' }: InfoTipProps) {
  const tipId = useId();
  const [isDismissed, setIsDismissed] = useState(false);
  const allowTipAgain = () => setIsDismissed(false);
  // The first Escape only hides the box. preventDefault stops it there, so a modal around the button stays open.
  const hideOnFirstEscape = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Escape' || isDismissed) return;
    event.preventDefault();
    setIsDismissed(true);
  };

  return (
    <span className="group relative inline-flex align-middle" onMouseLeave={allowTipAgain}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={tipId}
        className="inline-flex size-6 items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
        onClick={event => event.currentTarget.focus()}
        onKeyDown={hideOnFirstEscape}
        onBlur={allowTipAgain}
      >
        <InfoIcon size={14} />
      </button>
      {/* The top padding, not a margin, makes the space between the button and the box part of the hover area */}
      <span
        id={tipId}
        role="tooltip"
        hidden={isDismissed}
        className={cn(
          'invisible absolute top-full z-20 w-72 max-w-[calc(100vw-2rem)] pt-1 group-focus-within:visible group-hover:visible',
          opensTo === 'left' ? 'right-0' : 'left-0',
        )}
      >
        <span className="block rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-normal text-zinc-100 shadow-lg">
          {children}
        </span>
      </span>
    </span>
  );
}
