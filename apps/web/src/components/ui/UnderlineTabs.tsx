import { cn } from '@toolpath/ui';
import type { ReactNode } from 'react';
import { tabId, tabPanelId } from './tabPanel';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** A number after the label, such as the number of files */
  count?: number;
}

interface UnderlineTabsProps<T extends string> {
  /** Read by screen readers */
  label: string;
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The id start of each tab and its panel. Use `tabPanelProps` for the panel. */
  idPrefix: string;
  className?: string;
}

/** Tabs with a green line under the open one. The page shows the open tab's content itself. */
export function UnderlineTabs<T extends string>({ label, tabs, value, onChange, idPrefix, className }: UnderlineTabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex gap-1 overflow-x-auto border-b border-zinc-800', className)}>
      {tabs.map(tab => {
        const isOpen = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={isOpen}
            aria-controls={tabPanelId(idPrefix)}
            onClick={() => onChange(tab.id)}
            className={cn(
              'min-h-12 border-0 border-b-2 bg-transparent px-3 font-bold whitespace-nowrap',
              isOpen ? 'border-primary text-zinc-50' : 'border-transparent text-zinc-200 hover:text-zinc-50',
            )}
          >
            {tab.label}
            {tab.count !== undefined && <span className="ml-1.5 font-mono font-medium text-zinc-300">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
