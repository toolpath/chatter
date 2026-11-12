import { cn, Dialog } from '@toolpath/ui';
import { useEffect, useState } from 'react';
import { fetchUploadEvent, sendUploadAgain, type UploadEventDetail } from '../../api/machineFiles';
import { Button } from '../../components/ui/Button';
import { RefreshIcon } from '../../components/ui/icons';
import { SearchBox } from '../../components/ui/SearchBox';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import type { UploadEvent, UploadFile } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import { errorMessageOf } from '../../utils/errorMessage';
import type { UploadHistory } from './useUploadHistory';
import type { UploadMessages } from './useUploadMessages';

interface UploadHistoryTabProps {
  machineId: string;
  machineName: string;
  history: UploadHistory;
  messages: UploadMessages;
  /** Called after a file was sent again */
  onUploaded: () => Promise<void>;
}

/** Every file sent to the machine from ChatterBox. Pick one to see its versions and send one again. */
export function UploadHistoryTab({ machineId, machineName, history, messages, onUploaded }: UploadHistoryTabProps) {
  const [searchText, setSearchText] = useState('');
  const { confirm } = Dialog.useDialog();
  const matchingFiles = filesMatching(history.historyFiles, searchText);

  const sendAgain = async (eventId: number) => {
    try {
      const event = await fetchUploadEvent(machineId, eventId);
      const name = event.target_name || event.file_name;
      const accepted = await confirm(sendAgainDialog({ name, remotePath: event.remote_path, machineName }));
      if (!accepted) return;
      const error = await sendUploadAgain(machineId, event);
      if (error) {
        messages.setError(error);
        return;
      }
      messages.setSuccess(`Sent ${name} again`);
      await onUploaded();
    } catch (err) {
      messages.setError(`Could not send the file again: ${errorMessageOf(err)}`);
    }
  };

  const sendNewest = async (fileId: number) => {
    try {
      const [newest] = await history.loadEvents(fileId);
      if (newest) await sendAgain(newest.id);
    } catch (err) {
      messages.setError(`Could not load the versions: ${errorMessageOf(err)}`);
    }
  };

  const selectedFile = history.historyFiles.find(file => file.id === history.selectedFileId);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span className="text-zinc-200">Every file sent to {machineName}. Chatter keeps each version.</span>
        <div className="flex gap-2">
          <SearchBox label="Find a file" placeholder="File name" value={searchText} onChange={setSearchText} className="bg-zinc-950" />
          <Button size="icon" variant="quiet" aria-label="Load the history again" title="Load the history again" onClick={history.refreshAll} disabled={history.loading}>
            <RefreshIcon />
          </Button>
        </div>
      </div>

      {history.failed && <p className="m-0 px-4 pb-3 text-alarm-soft">Could not load the upload history. Click the reload button to try again.</p>}
      {history.historyFiles.length === 0 && !history.loading && !history.failed && (
        <p className="m-0 px-4 pb-4 text-zinc-300">No files were sent to this machine from Chatter yet.</p>
      )}
      {matchingFiles.length > 0 && (
        <UploadTable
          files={matchingFiles}
          selectedFileId={history.selectedFileId}
          onSelect={fileId => history.select(fileId === history.selectedFileId ? null : fileId)}
          onSendNewest={sendNewest}
        />
      )}
      {selectedFile && (
        <VersionsBox key={selectedFile.id} machineId={machineId} file={selectedFile} events={history.selectedEvents} onSendAgain={sendAgain} />
      )}
    </>
  );
}

/** The files whose name holds the search text, in any case */
function filesMatching(files: UploadFile[], searchText: string): UploadFile[] {
  const query = searchText.trim().toLowerCase();
  return files.filter(file => file.file_name.toLowerCase().includes(query));
}

function sendAgainDialog({ name, remotePath, machineName }: { name: string; remotePath: string; machineName: string }) {
  return (
    <Dialog variant="success">
      <Dialog.Title>Send {name} again?</Dialog.Title>
      <Dialog.Message>
        Chatter sends this version to {remotePath} on {machineName}. It replaces the file with the same name there.
      </Dialog.Message>
      <Dialog.Actions>
        <Dialog.Dismiss>Do not send</Dialog.Dismiss>
        {/* Dark text on green: white text on it is hard to read */}
        <Dialog.Confirm className="text-on-primary">Send it</Dialog.Confirm>
      </Dialog.Actions>
    </Dialog>
  );
}

interface UploadTableProps {
  files: UploadFile[];
  selectedFileId: number | null;
  onSelect: (fileId: number) => void;
  onSendNewest: (fileId: number) => void;
}

function UploadTable({ files, selectedFileId, onSelect, onSendNewest }: UploadTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={cn(TABLE, 'min-w-[40rem]')}>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={HEAD_CELL}>File</th>
            <th scope="col" className={HEAD_CELL}>Sent to</th>
            <th scope="col" className={HEAD_CELL}>Last sent</th>
            <th scope="col" className={cn(HEAD_CELL, 'text-right')}>Versions</th>
            <th scope="col" className={cn(HEAD_CELL, 'text-right')}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {files.map(file => {
            const isSelected = file.id === selectedFileId;
            return (
              <tr key={file.id} className={cn(ROW, isSelected && 'bg-zinc-800')}>
                <td className={cn(CELL, 'font-mono font-medium')}>{file.file_name}</td>
                <td className={cn(CELL, 'font-mono text-zinc-200')}>{file.last_path}</td>
                <td className={cn(CELL, 'text-zinc-200')}>{formatDateTime(file.updated_at)}</td>
                <td className={cn(CELL, 'text-right font-mono')}>{file.event_count}</td>
                <td className={cn(CELL, 'text-right whitespace-nowrap')}>
                  <Button size="sm" aria-pressed={isSelected} onClick={() => onSelect(file.id)}>
                    {isSelected ? 'Hide versions' : 'Versions'}
                  </Button>{' '}
                  <Button size="sm" onClick={() => onSendNewest(file.id)}>Send again</Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface VersionsBoxProps {
  machineId: string;
  file: UploadFile;
  events: UploadEvent[] | undefined;
  onSendAgain: (eventId: number) => void;
}

/** The versions of one file, newest first, and the text of the picked version. Give it a new key for each file. */
function VersionsBox({ machineId, file, events, onSendAgain }: VersionsBoxProps) {
  const [pickedId, setPickedId] = useState<number | null>(null);
  // Until the user picks a version, the newest one is shown
  const shownId = pickedId ?? events?.[0]?.id ?? null;
  const shownVersion = useUploadEventDetail(machineId, shownId);

  if (!events) return <p className="m-0 px-4 pb-4 text-zinc-300">Loading the versions…</p>;

  return (
    <div className="mx-4 mb-4 flex flex-wrap overflow-hidden rounded-[0.625rem] border border-zinc-800">
      <ol aria-label={`Versions of ${file.file_name}`} className="m-0 flex flex-[1_1_16.25rem] list-none flex-col gap-0.5 border-r border-zinc-800 p-2">
        {events.map((event, index) => {
          const isShown = event.id === shownId;
          return (
            <li key={event.id}>
              <button
                type="button"
                aria-pressed={isShown}
                onClick={() => setPickedId(event.id)}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-md border-0 px-3 py-2.5 text-left text-zinc-50',
                  isShown ? 'bg-zinc-800' : 'bg-transparent hover:bg-zinc-800/60',
                )}
              >
                <span className="font-semibold">{formatDateTime(event.uploaded_at)}</span>
                <span className="text-xs text-zinc-300">
                  {event.target_name && event.target_name !== file.file_name ? `As ${event.target_name} · ` : ''}
                  {event.remote_path}
                  {index === 0 ? ' · newest' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex min-w-0 flex-[2_1_20rem] flex-col bg-zinc-950">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2">
          <span className="text-xs text-zinc-300">The text of this version</span>
          {shownId !== null && <Button size="sm" onClick={() => onSendAgain(shownId)}>Send this version again</Button>}
        </div>
        <pre
          aria-label="The text of the picked version"
          className="m-0 max-h-80 overflow-auto p-4 font-mono text-[0.8125rem] leading-relaxed text-zinc-100"
        >
          {versionText(shownVersion)}
        </pre>
      </div>
    </div>
  );
}

type VersionLoad = { status: 'loading' } | { status: 'shown'; detail: UploadEventDetail } | { status: 'failed' };

/** Loads one version with its text. An answer for a version that is no longer shown is dropped. */
function useUploadEventDetail(machineId: string, eventId: number | null): VersionLoad {
  const [versionLoad, setVersionLoad] = useState<VersionLoad>({ status: 'loading' });

  useEffect(() => {
    if (eventId === null) return;
    let stopped = false;
    setVersionLoad({ status: 'loading' });
    fetchUploadEvent(machineId, eventId)
      .then(detail => { if (!stopped) setVersionLoad({ status: 'shown', detail }); })
      .catch(() => { if (!stopped) setVersionLoad({ status: 'failed' }); });
    return () => { stopped = true; };
  }, [machineId, eventId]);

  return versionLoad;
}

function versionText(versionLoad: VersionLoad): string | undefined {
  if (versionLoad.status === 'failed') return 'Could not load this version.';
  if (versionLoad.status === 'loading') return 'Loading…';
  return versionLoad.detail.file_content;
}
