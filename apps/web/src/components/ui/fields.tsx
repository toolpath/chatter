import { cn } from '@toolpath/ui';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/** The look of every text box and select box */
const CONTROL_CLASSES =
  'h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-50 ' +
  'placeholder:text-zinc-400 disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-300';

interface FieldProps {
  id: string;
  label: ReactNode;
  /** A help line under the box */
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A label above a form box, and an optional help line under it */
export function Field({ id, label, hint, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-zinc-300">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="m-0 text-xs text-zinc-300">{hint}</p>}
    </div>
  );
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { mono?: boolean };

export function TextInput({ mono = false, className, ...props }: TextInputProps) {
  return <input className={cn(CONTROL_CLASSES, mono && 'font-mono', className)} {...props} />;
}

export function SelectInput({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL_CLASSES, className)} {...props} />;
}
