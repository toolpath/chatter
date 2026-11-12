import { cn } from '@toolpath/ui';
import { useId, type ReactNode } from 'react';

interface PanelProps {
  title?: ReactNode;
  /** One line under the title */
  description?: ReactNode;
  /** Buttons at the right of the title */
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** A card with an optional title row. The title also names the section for screen readers. */
export function Panel({ title, description, actions, className, children }: PanelProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn('rounded-xl border border-zinc-800 bg-zinc-900', className)}
    >
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="m-0 text-base font-bold">{title}</h2>
            {description && <p className="m-0 text-zinc-200">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
