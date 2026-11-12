import { cn } from '@toolpath/ui';
import type { ReactNode } from 'react';
import { AlarmIcon, CloseIcon, OfflineIcon } from './icons';

/**
 * alarm: the machine has an alarm (red).
 * offline: the server cannot reach the machine (grey).
 * error: an action failed (red, smaller).
 * success: an action worked (green, smaller).
 * info: a fact the user must know (grey).
 */
export type NoticeTone = 'alarm' | 'offline' | 'error' | 'success' | 'info';

interface ToneStyle {
  /** The classes of the whole box */
  box: string;
  /** The classes of the icon tile and the tag */
  tile: string;
  icon: ReactNode;
}

const TONE_STYLES: Record<NoticeTone, ToneStyle> = {
  alarm: {
    box: 'border-alarm border-l-alarm bg-alarm/22',
    tile: 'bg-alarm/40 text-alarm-soft',
    icon: <AlarmIcon size={18} />,
  },
  offline: {
    box: 'border-zinc-800 border-l-offline-icon bg-zinc-900',
    tile: 'bg-offline-icon/16 text-zinc-200',
    icon: <OfflineIcon size={18} />,
  },
  error: { box: 'border-alarm/60 border-l-alarm bg-alarm/14', tile: 'text-alarm-soft', icon: <AlarmIcon /> },
  success: { box: 'border-running/50 border-l-running bg-running/12', tile: 'text-primary-text', icon: null },
  info: { box: 'border-zinc-700 border-l-zinc-400 bg-zinc-800', tile: 'text-zinc-200', icon: null },
};

interface NoticeProps {
  tone: NoticeTone;
  title: ReactNode;
  /** A short tag after the title, such as an alarm code */
  tag?: ReactNode;
  children?: ReactNode;
  /** Shows a close button */
  onClose?: () => void;
  className?: string;
}

/** A message box. Alarm and offline notices have a big icon tile; the others are compact. */
export function Notice({ tone, title, tag, children, onClose, className }: NoticeProps) {
  const toneStyle = TONE_STYLES[tone];
  const isLarge = tone === 'alarm' || tone === 'offline';
  const isUrgent = tone === 'alarm' || tone === 'error';

  return (
    <div
      role={isUrgent ? 'alert' : 'status'}
      className={cn(
        'relative flex items-start gap-3 rounded-[0.625rem] border border-l-[3px]',
        isLarge ? 'px-3.5 py-3' : 'px-3 py-2.5',
        onClose && 'pr-12',
        toneStyle.box,
        className,
      )}
    >
      {toneStyle.icon && (
        <span
          aria-hidden="true"
          className={cn('inline-flex shrink-0 items-center justify-center', isLarge ? 'size-8 rounded-lg' : 'mt-0.5', toneStyle.tile)}
        >
          {toneStyle.icon}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('font-bold', isLarge && 'text-[0.9375rem]')}>{title}</span>
          {tag && (
            <span className={cn('rounded px-1.5 py-px font-mono text-[0.6875rem] font-medium', toneStyle.tile, 'text-zinc-50')}>
              {tag}
            </span>
          )}
        </div>
        {children && <div className="text-[0.8125rem] text-zinc-100">{children}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          aria-label="Close this notice"
          onClick={onClose}
          className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md text-zinc-100 hover:bg-zinc-50/10"
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
}
