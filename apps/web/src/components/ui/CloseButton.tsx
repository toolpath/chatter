import { Button } from './Button';
import { CloseIcon } from './icons';

/** An X button that closes a panel. Its name for screen readers and its hover text are both "Close". */
export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="icon" variant="quiet" aria-label="Close" title="Close" onClick={onClick}>
      <CloseIcon />
    </Button>
  );
}
