import { cn } from '@toolpath/ui';
import type { ButtonHTMLAttributes } from 'react';

/**
 * The buttons of design B.
 * primary: the main action of a page, green with dark text.
 * secondary: other actions, a line around a dark face.
 * quiet: icon buttons and small actions, no face until hover.
 * danger: actions that remove something.
 */
type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
type Size = 'md' | 'sm' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-lighten active:bg-primary-darken',
  secondary: 'border border-zinc-700 bg-zinc-900 text-zinc-50 hover:bg-zinc-800',
  quiet: 'bg-transparent text-zinc-100 hover:bg-zinc-800',
  danger: 'bg-alarm text-white hover:bg-danger-darken',
};

const SIZES: Record<Size, string> = {
  md: 'min-h-10 px-3.5 rounded-lg text-sm',
  sm: 'min-h-9 px-3 rounded-md text-xs',
  icon: 'size-9 rounded-md justify-center',
};

const DISABLED = 'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-zinc-800 disabled:text-zinc-300';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'secondary', size = 'md', type = 'button', className, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-bold transition-colors',
        VARIANTS[variant],
        SIZES[size],
        DISABLED,
        className,
      )}
      {...props}
    />
  );
}
