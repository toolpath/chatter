import { cn } from '@toolpath/ui';

interface SwitchProps {
  checked: boolean;
  /** The name for screen readers, such as "Shop phones on" */
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** An on and off switch. It is a real button, so the keyboard and screen readers can use it. */
export function Switch({ checked, label, onChange, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-primary' : 'bg-zinc-700',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute size-4.5 rounded-full bg-zinc-100 transition-[left]', checked ? 'left-[1.125rem]' : 'left-[0.1875rem]')}
      />
    </button>
  );
}
