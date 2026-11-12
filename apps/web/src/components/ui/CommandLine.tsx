import { useEffect, useState } from 'react';
import { Button } from './Button';

/** How long the button shows Copied or Copy failed */
export const COPY_MESSAGE_MS = 2000;

type CopyResult = 'none' | 'copied' | 'failed';

const BUTTON_TEXT: Record<CopyResult, string> = { none: 'Copy', copied: 'Copied', failed: 'Copy failed' };
const SCREEN_READER_TEXT: Record<CopyResult, string> = {
  none: '',
  copied: 'Copied to the clipboard',
  failed: 'Could not copy. Select the command and copy it.',
};

/** One command to type in a terminal, with a button that copies it. */
export function CommandLine({ command }: { command: string }) {
  const [result, setResult] = useState<CopyResult>('none');

  useEffect(() => {
    if (result === 'none') return;
    const timer = setTimeout(() => setResult('none'), COPY_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [result]);

  async function copyCommand() {
    setResult((await copyText(command)) ? 'copied' : 'failed');
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 py-1 pr-1 pl-3">
      <code className="flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap text-zinc-50">{command}</code>
      <Button variant="quiet" size="sm" aria-label={`Copy ${command}`} onClick={copyCommand}>
        {BUTTON_TEXT[result]}
      </Button>
      <span role="status" className="sr-only">
        {SCREEN_READER_TEXT[result]}
      </span>
    </div>
  );
}

/** Copies the text, and tells whether it worked */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // The browser refused the clipboard. Try the old copy command.
    }
  }
  return copyWithOldCommand(text);
}

/**
 * The clipboard API works only on https or localhost. Chatter often runs on plain http
 * (for example http://chatter.local:3001), so there the old copy command is the fallback.
 * It copies the text of a selected text field, so the focus goes back to where it was after.
 */
function copyWithOldCommand(text: string): boolean {
  const focused = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus();
  }
}
