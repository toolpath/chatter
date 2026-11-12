import { fetchFocasStatus, removeFocasLibrary, uploadFocasLibrary, type FocasLibraryStatus } from '../../api/focasLibrary';
import { Button } from '../../components/ui/Button';
import { FileButton } from '../../components/ui/FileButton';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { ReportPending } from './ReportPending';
import { useServerReport } from './useServerReport';

const UPLOAD_WARNING =
  'Chatter runs the code in this file. Upload only the FOCAS2 library that you got from FANUC or your FANUC dealer. ' +
  'A wrong or harmful file can stop Chatter or harm this computer. You are responsible for the file that you upload.';

/** The Settings tab for the FANUC library */
export function FocasLibraryTab() {
  return (
    <Panel title="FANUC library" description="Chatter reads FANUC machines with FOCAS2, a library from FANUC.">
      <div className="px-5 py-4">
        <FocasLibrary />
      </div>
    </Panel>
  );
}

/**
 * The FANUC FOCAS2 library: whether Chatter has it, and a way to upload, replace, or remove it.
 * FANUC owns the library, so Chatter cannot include it.
 */
export function FocasLibrary() {
  const { report, loadError, changeError, isChanging, change } = useServerReport(fetchFocasStatus);
  if (loadError || !report) return <ReportPending loadError={loadError} />;
  if (report.problem) {
    return <Notice tone="info" title="This computer cannot read FANUC machines">{report.problem}</Notice>;
  }

  return (
    <div className="flex flex-col gap-4">
      {report.source ? <LibraryInUse status={report} /> : <LibraryNeeded fileName={report.fileName} />}
      {report.restartNeeded && <RestartNotice />}
      <Notice tone="info" title="Warning">{UPLOAD_WARNING}</Notice>
      {changeError && <Notice tone="error" title={changeError} />}
      <div className="flex flex-wrap justify-end gap-2">
        {report.source === 'uploaded' && (
          <Button onClick={() => change(removeFocasLibrary)} disabled={isChanging}>Remove the file</Button>
        )}
        <FileButton
          variant="primary"
          inputLabel="FANUC library file"
          disabled={isChanging}
          onFile={file => change(() => uploadFocasLibrary(file))}
        >
          {uploadButtonLabel({ isChanging, hasLibrary: Boolean(report.source) })}
        </FileButton>
      </div>
    </div>
  );
}

function uploadButtonLabel({ isChanging, hasLibrary }: { isChanging: boolean; hasLibrary: boolean }): string {
  if (isChanging) return 'Saving…';
  return hasLibrary ? 'Replace the file' : 'Upload the file';
}

function RestartNotice() {
  return (
    <Notice tone="info" title="Restart Chatter to use this change">
      With Docker, run <code>docker compose restart</code>. Otherwise, stop and start the server.
    </Notice>
  );
}

function LibraryNeeded({ fileName }: { fileName: string | null }) {
  return (
    <p className="m-0 text-zinc-200">
      Chatter needs the file <code className="font-mono">{fileName}</code> to read FANUC machines on this computer.
      Get it from FANUC or your FANUC dealer. It comes with the FOCAS2 developer kit.
    </p>
  );
}

function LibraryInUse({ status }: { status: FocasLibraryStatus }) {
  const origin = status.source === 'uploaded' ? 'You uploaded it.' : 'It came with this server.';
  return (
    <Notice tone="success" title={`Chatter has the FANUC library ${status.fileName}`}>
      <p className="m-0">{origin}</p>
      <p className="m-0 break-all">
        SHA-256 fingerprint: <code className="font-mono">{status.sha256}</code>
      </p>
    </Notice>
  );
}
