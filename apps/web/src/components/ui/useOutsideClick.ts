import { useRef, type MouseEvent, type PointerEvent } from 'react';

/**
 * Closes a modal dialog on a click on its dark layer. Such a click lands on the dialog itself.
 * The press must start there too: a text selection that ends outside the box must not close it.
 * Spread the result on the <dialog>.
 */
export function useOutsideClick(onClose: () => void) {
  const pressedOutside = useRef(false);
  const isOnDarkLayer = (event: PointerEvent<HTMLDialogElement> | MouseEvent<HTMLDialogElement>) => event.target === event.currentTarget;
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      pressedOutside.current = isOnDarkLayer(event);
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      if (pressedOutside.current && isOnDarkLayer(event)) onClose();
    },
  };
}
