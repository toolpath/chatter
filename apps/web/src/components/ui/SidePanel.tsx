import { cn } from '@toolpath/ui';
import { useEffect, useRef, type ReactNode } from 'react';
import { useOutsideClick } from './useOutsideClick';

/** The browser puts the focus on the first button, which is often the X. The first box to type in is more useful. */
const FIRST_BOX_TO_TYPE_IN = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

interface SidePanelProps {
  /** The name of the panel for screen readers */
  label: string;
  /** From useSlideOut: true while the panel slides out */
  isClosing: boolean;
  /** Esc and a click on the dark layer call this. Give the `close` of useSlideOut, so the panel slides out. */
  onClose: () => void;
  /** The width, for example 'w-[min(56rem,100vw)]' */
  widthClassName: string;
  children: ReactNode;
}

/**
 * A panel that slides in from the right, over a dark layer. It is a modal dialog, so the browser keeps the focus in it.
 * When it opens, the focus goes to the first box to type in, if it has one.
 */
export function SidePanel({ label, isClosing, onClose, widthClassName, children }: SidePanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeOnOutsideClick = useOutsideClick(onClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>(FIRST_BOX_TO_TYPE_IN)?.focus();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      {...closeOnOutsideClick}
      className={cn(
        'fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none max-w-none flex-col border-0 border-l border-zinc-800 bg-zinc-900 p-0 text-zinc-50 backdrop:bg-black/60 open:flex',
        widthClassName,
        isClosing ? 'animate-slide-out-right backdrop:animate-fade-out' : 'animate-slide-in-right backdrop:animate-fade-in',
        'motion-reduce:animate-none motion-reduce:backdrop:animate-none',
      )}
    >
      {children}
    </dialog>
  );
}
