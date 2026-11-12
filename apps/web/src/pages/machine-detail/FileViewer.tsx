import { cn } from '@toolpath/ui';
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { fetchFileBytes, fileDownloadUrl } from '../../api/machineFiles';
import { Button } from '../../components/ui/Button';
import { CloseIcon, DownloadIcon } from '../../components/ui/icons';
import { useSlideOut } from '../../components/ui/useSlideOut';
import type { FTPTreeNode } from '../../types';
import { formatSize } from '../../utils/formatters';
import { FileTooBigError } from '../../utils/readAtMost';
import { errorMessageOf } from '../../utils/errorMessage';
import { isTooBigToView, lineNumbersFor, linesOf, MAX_VIEW_BYTES, textOf } from './fileText';

type ViewState = { status: 'loading' } | { status: 'shown'; lines: string[] } | { status: 'failed'; message: string };

const TOO_BIG: ViewState = {
  status: 'failed',
  message: `This file is bigger than ${formatSize(MAX_VIEW_BYTES)}, so Chatter does not show it. Download it to read it.`,
};
const NOT_TEXT: ViewState = {
  status: 'failed',
  message: 'This is not a text file, so Chatter does not show it. Download it to open it.',
};

interface FileViewerProps {
  machineId: string;
  file: FTPTreeNode;
  onClose: () => void;
}

/**
 * A side panel with the text of one file on the machine, with line numbers. Only to read: it cannot change the file.
 * It is a modal dialog, so the browser keeps the focus in it and closes it on Esc. Give it a new key for each file.
 */
function FileViewer({ machineId, file, onClose }: FileViewerProps) {
  const state = useFileText(machineId, file);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { isClosing, close } = useSlideOut(onClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  // A click on the dark layer outside the panel lands on the dialog itself. The press must start there too:
  // a text selection that ends outside the panel must not close it.
  const pressedOutside = useRef(false);
  const isOnDarkLayer = (event: PointerEvent<HTMLDialogElement> | MouseEvent<HTMLDialogElement>) => event.target === event.currentTarget;
  const closeOnOutsideClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (pressedOutside.current && isOnDarkLayer(event)) close();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={`The text of ${file.name}`}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      onPointerDown={event => { pressedOutside.current = isOnDarkLayer(event); }}
      onClick={closeOnOutsideClick}
      className={cn(
        'fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-[min(56rem,100vw)] max-w-none flex-col border-0 border-l border-zinc-800 bg-zinc-900 p-0 text-zinc-50 backdrop:bg-black/60 open:flex',
        isClosing ? 'animate-slide-out-right backdrop:animate-fade-out' : 'animate-slide-in-right backdrop:animate-fade-in',
        'motion-reduce:animate-none motion-reduce:backdrop:animate-none',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3">
        <div className="flex min-w-0 flex-col">
          <strong className="truncate font-mono">{file.name}</strong>
          <span className="truncate text-xs text-zinc-300">
            {file.path} · {formatSize(file.size)}
            {state.status === 'shown' && ` · ${state.lines.length} lines`}
          </span>
        </div>
        <div className="flex gap-1">
          <a
            href={fileDownloadUrl(machineId, file.path)}
            download={file.name}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 font-semibold text-zinc-50 no-underline hover:bg-zinc-800"
          >
            <DownloadIcon /> Download
          </a>
          <Button size="icon" variant="quiet" aria-label="Close the file" title="Close" onClick={close}>
            <CloseIcon />
          </Button>
        </div>
      </div>
      <FileBody name={file.name} state={state} />
    </dialog>
  );
}

function FileBody({ name, state }: { name: string; state: ViewState }) {
  if (state.status === 'loading') {
    return <p role="status" className="m-0 flex-1 bg-zinc-950 p-5 text-zinc-300">Reading the file from the machine…</p>;
  }
  if (state.status === 'failed') return <p role="alert" className="m-0 flex-1 bg-zinc-950 p-5 text-alarm-soft">{state.message}</p>;

  // Lines do not wrap, so each number stays next to its line. The box takes the focus, so the keyboard can scroll it.
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={`Text of ${name}`}
      className="flex min-h-0 flex-1 items-start overflow-auto bg-zinc-950 font-mono text-[0.8125rem] leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
    >
      <pre aria-hidden="true" className="sticky left-0 m-0 shrink-0 border-r border-zinc-800 bg-zinc-950 py-3 pr-3 pl-4 text-right text-zinc-400 select-none">
        {lineNumbersFor(state.lines.length)}
      </pre>
      <pre className="m-0 flex-1 py-3 pr-4 pl-3 text-zinc-100">{state.lines.join('\n')}</pre>
    </div>
  );
}

/**
 * Reads the file, and stops the download when the viewer closes.
 * A file that is too big or not text gets a message, not its text.
 */
function useFileText(machineId: string, file: FTPTreeNode): ViewState {
  const [state, setState] = useState<ViewState>({ status: 'loading' });

  useEffect(() => {
    if (isTooBigToView(file.size)) {
      setState(TOO_BIG);
      return;
    }
    setState({ status: 'loading' });
    const download = new AbortController();
    fetchFileBytes(machineId, file.path, MAX_VIEW_BYTES, download.signal)
      .then(bytes => {
        if (download.signal.aborted) return;
        const text = textOf(bytes);
        setState(text === null ? NOT_TEXT : { status: 'shown', lines: linesOf(text) });
      })
      .catch(error => {
        if (!download.signal.aborted) setState(stateForError(error));
      });
    return () => download.abort();
  }, [machineId, file.path, file.size]);

  return state;
}

function stateForError(error: unknown): ViewState {
  // The list showed an old size: the file grew past the limit since then
  if (error instanceof FileTooBigError) return TOO_BIG;
  return { status: 'failed', message: `Could not read the file: ${errorMessageOf(error)}` };
}

export default FileViewer;
