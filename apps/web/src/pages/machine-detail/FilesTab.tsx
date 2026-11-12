import { cn, Dialog } from '@toolpath/ui';
import { useEffect, useRef, useState } from 'react';
import { deleteMachineFile, fileDownloadUrl } from '../../api/machineFiles';
import { useCan } from '../../components/CurrentUser';
import { Button } from '../../components/ui/Button';
import { DownloadIcon, FolderIcon, FolderUpIcon, RefreshIcon, TrashIcon, UploadIcon } from '../../components/ui/icons';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import type { FTPTreeNode } from '../../types';
import { formatSize } from '../../utils/formatters';
import { errorMessageOf } from '../../utils/errorMessage';
import { filesOf, foldersOf, formatChanged, parentPath, pathCrumbs } from './fileListing';
import FileUploadPanel from './FileUploadPanel';
import FileViewer from './FileViewer';
import type { MachineFiles } from './useMachineFiles';
import type { UploadMessages } from './useUploadMessages';

/** A file row lights up in Chatter green under the mouse or the keyboard, so the user sees which file a button acts on */
const FILE_ROW = cn(ROW, 'transition-colors hover:bg-primary/20 focus-within:bg-primary/20');

const FOLDER_BUTTON_CLASS =
  'flex min-h-9 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left font-mono text-[0.8125rem] text-zinc-50 hover:bg-zinc-800';

interface FilesTabProps {
  machineId: string;
  files: MachineFiles;
  messages: UploadMessages;
  onUploaded: () => Promise<void>;
  now: number;
}

/** The files on the machine, by folder. Send new files, or read, download and delete the files there. */
export function FilesTab({ machineId, files, messages, onUploaded, now }: FilesTabProps) {
  const canSendFiles = useCan('send-files');
  const [isSending, setIsSending] = useState(false);
  const { openFile, showFile, closeFile } = useFileViewer(files.currentPath);
  const { confirm } = Dialog.useDialog();

  const deleteFile = async (filePath: string, fileName: string) => {
    const accepted = await confirm(deleteFileDialog(fileName));
    if (!accepted) return;
    try {
      const error = await deleteMachineFile(machineId, filePath);
      if (error) messages.setError(error);
      else files.refresh();
    } catch (err) {
      messages.setError(`Could not delete the file: ${errorMessageOf(err)}`);
    }
  };

  const sendFinished = async () => {
    setIsSending(false);
    await onUploaded();
  };

  return (
    <div className="flex flex-wrap">
      <FolderList files={files} />
      <div className="flex min-w-0 flex-[999_1_26.25rem] flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <PathCrumbs files={files} />
          <div className="flex gap-2">
            <Button size="icon" variant="quiet" aria-label="Load the files again" title="Load the files again" onClick={() => files.refresh()} disabled={files.loading}>
              <RefreshIcon />
            </Button>
            {canSendFiles && (
              <Button variant="primary" onClick={() => setIsSending(true)} disabled={isSending}>
                <UploadIcon /> Send files
              </Button>
            )}
          </div>
        </div>
        {isSending && (
          <FileUploadPanel
            machineId={machineId}
            uploadPath={files.uploadPath}
            messages={messages}
            onUploaded={sendFinished}
            onCancel={() => setIsSending(false)}
          />
        )}
        {openFile && <FileViewer key={openFile.path} machineId={machineId} file={openFile} onClose={closeFile} />}
        <FileTable
          files={files}
          machineId={machineId}
          openPath={openFile?.path}
          onOpen={showFile}
          onDelete={canSendFiles ? deleteFile : undefined}
          now={now}
        />
      </div>
    </div>
  );
}

/**
 * The file in the viewer. When the viewer closes, the focus goes back to the file name button that opened it.
 * The open file belongs to one folder, so the viewer closes when `currentPath` changes.
 */
function useFileViewer(currentPath: string) {
  const [openFile, setOpenFile] = useState<FTPTreeNode | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const showFile = (file: FTPTreeNode, button: HTMLElement) => {
    opener.current = button;
    setOpenFile(file);
  };
  const closeFile = () => setOpenFile(null);

  // After the panel is gone. Before that, the closing dialog would move the focus again.
  useEffect(() => {
    if (!openFile) opener.current?.focus();
  }, [openFile]);

  useEffect(() => {
    setOpenFile(null);
  }, [currentPath]);

  return { openFile, showFile, closeFile };
}

function deleteFileDialog(fileName: string) {
  return (
    <Dialog variant="danger">
      <Dialog.Title>Delete {fileName}?</Dialog.Title>
      <Dialog.Message>This deletes the file on the machine. The upload history keeps the versions sent from Chatter.</Dialog.Message>
      <Dialog.Actions>
        <Dialog.Dismiss>Keep the file</Dialog.Dismiss>
        <Dialog.Confirm>Delete the file</Dialog.Confirm>
      </Dialog.Actions>
    </Dialog>
  );
}

function FolderList({ files }: { files: MachineFiles }) {
  const folderAbove = parentPath(files.currentPath);
  const folders = foldersOf(files.files);

  return (
    <nav aria-label="Folders" className="flex max-w-[16.25rem] flex-[1_1_12.5rem] flex-col gap-0.5 border-r border-zinc-800 p-3">
      {folderAbove !== null && (
        <button type="button" className={cn(FOLDER_BUTTON_CLASS, 'font-body text-zinc-200')} onClick={() => files.openFolder(folderAbove)} disabled={files.loading}>
          <FolderUpIcon className="text-zinc-300" /> Up one folder
        </button>
      )}
      {folders.map(folder => (
        <button
          key={folder.path}
          type="button"
          className={cn(FOLDER_BUTTON_CLASS, folder.depth === 1 && 'pl-7')}
          onClick={() => files.openFolder(folder.path)}
          disabled={files.loading}
        >
          <FolderIcon className="shrink-0 text-zinc-300" />
          <span className="truncate">{folder.name}</span>
        </button>
      ))}
      {folders.length === 0 && <p className="m-0 px-2 py-2 text-xs text-zinc-300">No folders here</p>}
    </nav>
  );
}

function PathCrumbs({ files }: { files: MachineFiles }) {
  const crumbs = pathCrumbs(files.currentPath);
  return (
    <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 font-mono text-zinc-200">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={crumb.path} className="inline-flex items-center gap-1">
            {index > 0 && <span aria-hidden="true" className="text-zinc-400">/</span>}
            {isLast ? (
              <span aria-current="location" className="text-zinc-50">{crumb.name}</span>
            ) : (
              <button
                type="button"
                className="border-0 bg-transparent p-0 font-mono text-zinc-200 underline-offset-2 hover:text-primary-text hover:underline"
                onClick={() => files.openFolder(crumb.path)}
                disabled={files.loading}
              >
                {crumb.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

interface FileTableProps {
  files: MachineFiles;
  machineId: string;
  /** The path of the file in the viewer */
  openPath?: string;
  onOpen: (file: FTPTreeNode, button: HTMLElement) => void;
  /** Not set when the role of the user cannot delete files */
  onDelete?: (path: string, name: string) => void;
  now: number;
}

function FileTable({ files, machineId, openPath, onOpen, onDelete, now }: FileTableProps) {
  const fileRows = filesOf(files.files);

  if (files.error) return <p className="m-0 px-4 pb-4 text-alarm-soft">Could not load the files: {files.error}</p>;
  if (files.loading && fileRows.length === 0) return <p className="m-0 px-4 pb-4 text-zinc-300">Loading the files…</p>;
  if (fileRows.length === 0) return <p className="m-0 px-4 pb-4 text-zinc-300">No files in this folder.</p>;

  return (
    <div className="overflow-x-auto">
      <table className={cn(TABLE, 'min-w-[27.5rem]')}>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={HEAD_CELL}>Name</th>
            <th scope="col" className={cn(HEAD_CELL, 'text-right')}>Size</th>
            <th scope="col" className={HEAD_CELL}>Changed</th>
            <th scope="col" className={cn(HEAD_CELL, 'text-right')}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {fileRows.map(file => (
            <tr key={file.path} className={FILE_ROW}>
              <td className={cn(CELL, 'py-1 font-mono')}>
                <button
                  type="button"
                  title="Show the text of the file"
                  aria-current={file.path === openPath ? 'true' : undefined}
                  onClick={event => onOpen(file, event.currentTarget)}
                  className="border-0 bg-transparent p-0 text-left font-mono text-zinc-50 underline-offset-2 hover:text-primary-text hover:underline"
                >
                  {file.name}
                </button>
              </td>
              <td className={cn(CELL, 'py-1 text-right font-mono text-zinc-200')}>{formatSize(file.size)}</td>
              <td className={cn(CELL, 'py-1 text-zinc-200')}>{formatChanged(file.modifiedAt, now)}</td>
              <td className={cn(CELL, 'py-1 text-right whitespace-nowrap')}>
                <FileActions machineId={machineId} file={file} onDelete={onDelete} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Download the file, and delete it when the role of the user may */
function FileActions({ machineId, file, onDelete }: { machineId: string; file: FTPTreeNode; onDelete: FileTableProps['onDelete'] }) {
  return (
    <>
      <a
        href={fileDownloadUrl(machineId, file.path)}
        download={file.name}
        aria-label={`Download ${file.name}`}
        title="Download"
        className="inline-flex size-9 items-center justify-center rounded-md text-zinc-50 hover:bg-zinc-800"
      >
        <DownloadIcon />
      </a>
      {onDelete && (
        <Button size="icon" variant="quiet" aria-label={`Delete ${file.name}`} title="Delete" onClick={() => onDelete(file.path, file.name)}>
          <TrashIcon />
        </Button>
      )}
    </>
  );
}
