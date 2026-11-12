import { useRef, type ChangeEvent } from 'react';
import { Button, type ButtonProps } from './Button';

interface FileButtonProps extends Omit<ButtonProps, 'onClick'> {
  /** The name of the hidden file input, for screen readers and tests */
  inputLabel: string;
  /** The file types that the file chooser shows first, such as ".csv" */
  accept?: string;
  onFile: (file: File) => void;
}

/** A button that opens the file chooser, and gives the file that the user picks */
export function FileButton({ inputLabel, accept, onFile, disabled, ...buttonProps }: FileButtonProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  const handlePickedFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file can be picked again after an error
    event.target.value = '';
    if (file) onFile(file);
  };

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept={accept}
        aria-label={inputLabel}
        disabled={disabled}
        onChange={handlePickedFile}
      />
      <Button {...buttonProps} disabled={disabled} onClick={() => fileInput.current?.click()} />
    </>
  );
}
