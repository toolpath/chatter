import { useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';

/**
 * The browser puts the focus on the first button, which is often the X. The first box to type in is more useful.
 * React autoFocus does not help: it runs before the dialog opens, when nothing in it can take the focus.
 */
const FIRST_BOX_TO_TYPE_IN = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

interface ModalProps {
  /** The name of the box for screen readers, such as "Add a machine" */
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A box in the middle of the screen, over a dark layer. The page behind it does not react.
 * It is a modal dialog, so the browser keeps the focus in it. Esc and a click on the dark layer close it.
 * When it opens, the focus goes to the first box to type in.
 * The dialog fills the screen and scrolls, and the box sits in it. So only the screen edge cuts off
 * what sticks out of the box, such as a hover box.
 */
export function Modal({ label, onClose, children }: ModalProps) {
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
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-y-auto border-0 bg-transparent p-4 text-zinc-50 outline-none open:flex backdrop:bg-black/60 animate-fade-in backdrop:animate-fade-in motion-reduce:animate-none motion-reduce:backdrop:animate-none"
    >
      <div className="m-auto w-full max-w-3xl">{children}</div>
    </dialog>
  );
}

/**
 * A click on the dark layer lands on the dialog itself. The press must start there too:
 * a text selection that ends outside the box must not close it.
 */
function useOutsideClick(onClose: () => void) {
  const pressedOutside = useRef(false);
  const isOnDarkLayer = (event: PointerEvent<HTMLDialogElement> | MouseEvent<HTMLDialogElement>) =>
    event.target === event.currentTarget;
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      pressedOutside.current = isOnDarkLayer(event);
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (pressedOutside.current && isOnDarkLayer(event)) onClose();
    },
  };
}
