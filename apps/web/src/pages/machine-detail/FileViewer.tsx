import { useEffect, useState } from 'react';
import { fetchFileBytes, fileDownloadUrl } from '../../api/machineFiles';
import { Button } from '../../components/ui/Button';
import { CloseIcon, DownloadIcon } from '../../components/ui/icons';
import { SidePanel } from '../../components/ui/SidePanel';
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
  const { isClosing, close } = useSlideOut(onClose);

  return (
    <SidePanel label={`The text of ${file.name}`} isClosing={isClosing} onClose={close} widthClassName="w-[min(56rem,100vw)]">
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
    </SidePanel>
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
