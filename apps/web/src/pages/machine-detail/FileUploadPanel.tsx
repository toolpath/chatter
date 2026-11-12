import { cn } from '@toolpath/ui';
import { useRef, useState, type DragEvent } from 'react';
import { uploadMachineFiles, type BatchUploadResult } from '../../api/machineFiles';
import { Button } from '../../components/ui/Button';
import { CloseIcon, UploadIcon } from '../../components/ui/icons';
import { errorMessageOf } from '../../utils/errorMessage';
import type { UploadMessages } from './useUploadMessages';

interface FileUploadPanelProps {
  machineId: string;
  /** The folder the files go to */
  uploadPath: string;
  messages: UploadMessages;
  /** Called after each upload, good or bad, so the lists can load again */
  onUploaded: () => Promise<void>;
  onCancel: () => void;
}

/** "1 file" or "3 files" */
const fileCountText = (count: number) => (count === 1 ? '1 file' : `${count} files`);

/** The name each file gets on the machine: the name the user typed, or else its own name */
function namesOnMachineFor(files: File[], typedNames: Record<string, string>): Record<string, string> {
  const namesOnMachine: Record<string, string> = {};
  for (const file of files) namesOnMachine[file.name] = typedNames[file.name] || file.name;
  return namesOnMachine;
}

/** "Not sent: O1000 (File exists), O2000 (No space)" */
function notSentText(failed: NonNullable<BatchUploadResult['failed']>): string {
  return `Not sent: ${failed.map(failure => `${failure.filename} (${failure.error})`).join(', ')}`;
}

/** Pick or drop files, give each one a name on the machine, and send them */
function FileUploadPanel({ machineId, uploadPath, messages, onUploaded, onCancel }: FileUploadPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [targetNames, setTargetNames] = useState<Record<string, string>>({});
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const addFiles = (pickedFiles: FileList | null) => {
    setUploadFiles(prev => [...prev, ...Array.from(pickedFiles || [])]);
  };

  const removeFile = (index: number, fileName: string) => {
    setUploadFiles(prev => prev.filter((_, i) => i !== index));
    setTargetNames(prev => {
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
  };

  const addDroppedFiles = (event: DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
  };

  const sendFiles = async () => {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    messages.clear();

    try {
      const namesOnMachine = namesOnMachineFor(uploadFiles, targetNames);
      const { ok, result } = await uploadMachineFiles(machineId, uploadFiles, uploadPath, allowOverwrite, namesOnMachine);
      if (!ok) {
        messages.setError(result.error || 'The upload did not work');
      } else {
        if (result.success?.length) messages.setSuccess(`Sent ${fileCountText(result.success.length)} to ${uploadPath}`);
        if (result.failed?.length) messages.setError(notSentText(result.failed));
      }
    } catch (err) {
      messages.setError(`The upload did not work: ${errorMessageOf(err)}`);
    }

    setUploading(false);
    await onUploaded();
  };

  return (
    <div className="mx-4 mb-4 flex flex-col gap-3 rounded-[0.625rem] border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-bold">
          Send files to <span className="font-mono font-medium">{uploadPath}</span>
        </span>
        <Button size="icon" variant="quiet" aria-label="Close without sending" onClick={onCancel} disabled={uploading}>
          <CloseIcon size={14} />
        </Button>
      </div>
      <input ref={fileInput} type="file" multiple hidden onChange={event => addFiles(event.target.files)} disabled={uploading} />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        onDragOver={event => { event.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={addDroppedFiles}
        disabled={uploading}
        className={cn(
          'flex min-h-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-zinc-200',
          isDragOver ? 'border-primary bg-primary/10' : 'border-zinc-700 bg-transparent hover:border-zinc-500',
        )}
      >
        <UploadIcon className="text-zinc-300" />
        {uploadFiles.length > 0 ? 'Click or drop to add more files' : 'Drop files here, or click to pick them'}
      </button>

      {uploadFiles.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {uploadFiles.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-zinc-200">{file.name}</span>
              <span aria-hidden="true" className="text-zinc-400">→</span>
              <label className="sr-only" htmlFor={`target-name-${index}`}>Name on the machine for {file.name}</label>
              <input
                id={`target-name-${index}`}
                type="text"
                value={targetNames[file.name] ?? file.name}
                onChange={event => setTargetNames(prev => ({ ...prev, [file.name]: event.target.value }))}
                disabled={uploading}
                className="h-9 min-w-40 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 font-mono text-[0.8125rem] text-zinc-50"
              />
              <Button size="icon" variant="quiet" aria-label={`Do not send ${file.name}`} onClick={() => removeFile(index, file.name)} disabled={uploading}>
                <CloseIcon size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-zinc-100">
          <input
            type="checkbox"
            checked={allowOverwrite}
            onChange={event => setAllowOverwrite(event.target.checked)}
            disabled={uploading}
            className="size-4 accent-primary"
          />
          Replace files with the same name
        </label>
        <Button variant="primary" onClick={sendFiles} disabled={uploading || uploadFiles.length === 0}>
          {uploading ? 'Sending…' : `Send ${fileCountText(uploadFiles.length)}`}
        </Button>
      </div>
    </div>
  );
}

export default FileUploadPanel;
