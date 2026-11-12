import { cn } from '@toolpath/ui';
import type { ReactNode } from 'react';

/** good: green. check: yellow, a state the user should look at. bad: red. */
export type StatusTone = 'good' | 'check' | 'bad';

const DOT_COLORS: Record<StatusTone, string> = { good: 'bg-running', check: 'bg-idle', bad: 'bg-alarm' };

/** A colored dot before a text. The text gives the meaning, so the color is never the only sign. */
export function StatusDot({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold">
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT_COLORS[tone])} />
      {children}
    </span>
  );
}
