import { cn, Dialog } from '@toolpath/ui';
import { useEffect, useState } from 'react';
import { fetchUploadEvent, sendUploadAgain, type UploadEventDetail } from '../../api/machineFiles';
import { useCan } from '../../components/CurrentUser';
import { Button } from '../../components/ui/Button';
import { RefreshIcon } from '../../components/ui/icons';
import { SearchBox } from '../../components/ui/SearchBox';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import type { UploadEvent, UploadFile } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import { errorMessageOf } from '../../utils/errorMessage';
import { CANNOT_READ_FILES_TEXT } from './fileText';
import type { UploadHistory } from './useUploadHistory';
import type { UploadMessages } from './useUploadMessages';

interface UploadHistoryListProps {
  machineId: string;
  machineName: string;
  history: UploadHistory;
  messages: UploadMessages;
  /** Called after a file was sent again */
  onUploaded: () => Promise<void>;
}

/** Every file sent to the machine from ChatterBox. Pick one to see its versions and send one again. */
export function UploadHistoryList({ machineId, machineName, history, messages, onUploaded }: UploadHistoryListProps) {
  const [searchText, setSearchText] = useState('');
  const { confirm } = Dialog.useDialog();
  // The server lets only a role that can send files send one again
  const canSendFiles = useCan('send-files');
  // A viewer sees the names and dates of the versions, but not their text
  const canReadFiles = useCan('read-files');
  // Decision D4: a role that can read programs sees who sent each version. Only an Admin sees the address of the computer.
  const canSeeAddress = useCan('manage-chatter');
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
          onSendNewest={canSendFiles ? sendNewest : undefined}
        />
      )}
      {selectedFile && (
        <VersionsBox
          key={selectedFile.id}
          machineId={machineId}
          file={selectedFile}
          events={history.selectedEvents}
          showText={canReadFiles}
          showSender={canReadFiles}
          showAddress={canSeeAddress}
          onSendAgain={canSendFiles ? sendAgain : undefined}
        />
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
  /** Not there when the user may not send files */
  onSendNewest?: (fileId: number) => void;
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
                  </Button>
                  {onSendNewest && (
                    <>
                      {' '}
                      <Button size="sm" onClick={() => onSendNewest(file.id)}>Send again</Button>
                    </>
                  )}
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
  /** False when the user may not read the text of a file. Then the box shows only the dates and paths. */
  showText: boolean;
  /** True when the role of the user can see who sent each version */
  showSender: boolean;
  /** True when the role of the user can see the address of the computer that sent each version */
  showAddress: boolean;
  /** Not there when the user may not send files */
  onSendAgain?: (eventId: number) => void;
}

/** The versions of one file, newest first, and the text of the picked version. Give it a new key for each file. */
function VersionsBox({ machineId, file, events, showText, showSender, showAddress, onSendAgain }: VersionsBoxProps) {
  const [pickedId, setPickedId] = useState<number | null>(null);
  // Until the user picks a version, the newest one is shown
  const shownId = pickedId ?? events?.[0]?.id ?? null;
  const shownVersion = useUploadEventDetail(machineId, showText ? shownId : null);

  if (!events) return <p className="m-0 px-4 pb-4 text-zinc-300">Loading the versions…</p>;

  return (
    <div className="mx-4 mb-4 flex flex-wrap overflow-hidden rounded-[0.625rem] border border-zinc-800">
      <ol aria-label={`Versions of ${file.file_name}`} className="m-0 flex flex-[1_1_16.25rem] list-none flex-col gap-0.5 border-r border-zinc-800 p-2">
        {events.map((event, index) => {
          const label = (
            <VersionLabel file={file} event={event} isNewest={index === 0} showSender={showSender} showAddress={showAddress} />
          );
          // Without the text, there is nothing to pick: the versions are plain items
          if (!showText) return <li key={event.id} className="flex flex-col gap-0.5 px-3 py-2.5 text-zinc-50">{label}</li>;
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
                {label}
              </button>
            </li>
          );
        })}
      </ol>
      {!showText && <p className="m-0 flex-[2_1_20rem] p-4 text-zinc-300">{CANNOT_READ_FILES_TEXT}</p>}
      {showText && (
        <div className="flex min-w-0 flex-[2_1_20rem] flex-col bg-zinc-950">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2">
            <span className="text-xs text-zinc-300">The text of this version</span>
            {shownId !== null && onSendAgain && <Button size="sm" onClick={() => onSendAgain(shownId)}>Send this version again</Button>}
          </div>
          <pre
            aria-label="The text of the picked version"
            className="m-0 max-h-80 overflow-auto p-4 font-mono text-[0.8125rem] leading-relaxed text-zinc-100"
          >
            {versionText(shownVersion)}
          </pre>
        </div>
      )}
    </div>
  );
}

interface VersionLabelProps {
  file: UploadFile;
  event: UploadEvent;
  isNewest: boolean;
  showSender: boolean;
  showAddress: boolean;
}

/** The date and the path of one version, and who sent it when the role can see that */
function VersionLabel({ file, event, isNewest, showSender, showAddress }: VersionLabelProps) {
  return (
    <>
      <span className="font-semibold">{formatDateTime(event.uploaded_at)}</span>
      <span className="text-xs text-zinc-300">
        {event.target_name && event.target_name !== file.file_name ? `As ${event.target_name} · ` : ''}
        {event.remote_path}
        {isNewest ? ' · newest' : ''}
      </span>
      {showSender && (
        // A long name with no space breaks anywhere, so it stays in the box
        <span className="text-xs text-zinc-300 [overflow-wrap:anywhere]">{senderText(event, showAddress)}</span>
      )}
    </>
  );
}

/**
 * Who sent the version. The role decides if the user is shown, not the field: a send from an older version of Chatter
 * has no user, so it is "unknown".
 */
function senderText(event: UploadEvent, showAddress: boolean): string {
  if (!event.uploaded_by) return 'Sent by an unknown user';
  const from = showAddress && event.address ? ` from ${event.address}` : '';
  return `Sent by ${event.uploaded_by}${from}`;
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
