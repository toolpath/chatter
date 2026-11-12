import { cn } from '@toolpath/ui';
import { rem } from '../ui/units';

/** The "Ch" mark in a green square, with a slanted cut through the h */
export function ChMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={rem(size)} height={rem(size)} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect width="28" height="28" rx="7" fill="var(--color-primary)" />
      <path d="M14.04 9.79A5.5 5.5 0 1 0 14.04 18.21" fill="none" stroke="var(--color-on-primary)" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M18 7.5v12.5M18 14a3 3 0 0 1 6 0v6"
        fill="none"
        stroke="var(--color-on-primary)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M15.6 12.4L20.6 9.6" stroke="var(--color-primary)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

interface WordmarkProps {
  /** The font size in pixels */
  size: number;
  /** The color behind the word. The cut through "tt" uses it, so it looks like a gap. */
  cutClassName: string;
  /** Show "by Toolpath" under the word */
  byline?: boolean;
}

/** "Chatter" with a slanted cut through "tt" */
export function Wordmark({ size, cutClassName, byline = false }: WordmarkProps) {
  return (
    <span className="inline-flex flex-col items-end leading-none">
      <span className="font-display font-extrabold text-zinc-50" style={{ fontSize: rem(size) }}>
        Cha
        <span className="relative inline-block">
          tt
          <span
            aria-hidden="true"
            className={cn('absolute top-[40%] right-[4%] left-[4%] h-[0.07em] -rotate-[28deg]', cutClassName)}
          />
        </span>
        er
      </span>
      {byline && (
        <span className="mt-0.5 -mr-3.5 font-display text-[0.8125rem] font-bold tracking-[.02em] text-primary-text">by Toolpath</span>
      )}
    </span>
  );
}
