import { Switch } from '@toolpath/ui';
import { useEffect, useId, useState } from 'react';
import {
  checkUpdateFile,
  downloadUpdate,
  fetchUpdatesReport,
  saveUpdateSettings,
  uploadUpdateFile,
  type UpdatesReport,
} from '../../api/updates';
import { Button } from '../../components/ui/Button';
import { CommandLine } from '../../components/ui/CommandLine';
import { DocsLink } from '../../components/ui/DocsLink';
import { FileButton } from '../../components/ui/FileButton';
import { InfoCard } from '../../components/ui/InfoCard';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { formatSize } from '../../utils/formatters';
import { ReportPending } from './ReportPending';
import { isHelperWorking, UpdateStatusPanel, type UpdateChanges } from './UpdateStatusPanel';
import { useServerReport } from './useServerReport';

/** How often the page asks for the status while the helper works, or while an update file comes in */
export const POLL_MS = 3000;

/**
 * Update Chatter to a new version. On the Pi card, an update helper (outside Docker) checks and installs the update file.
 * On a normal computer, the Admin updates with docker compose.
 */
export function UpdatesTab() {
  const { report, loadError, changeError, isChanging, change, refresh } = useServerReport(fetchUpdatesReport);
  // Chatter itself restarts during an install, so failed requests in that time are normal
  usePolling(report !== null && isWaitingForServer(report), refresh);
  if (loadError || !report) return <ReportPending loadError={loadError} />;

  const changes = { change, isChanging, error: changeError };
  return (
    <>
      <VersionCards report={report} />
      {!report.helper && <ManualUpdatePanel />}
      {report.helper && !report.canUpdate && <Notice tone="info" title="Development build: it cannot update from here" />}
      {report.helper && report.canUpdate && (
        <>
          <UpdateStatusPanel report={report} changes={changes} />
          <UpdateFilePanel report={report} changes={changes} />
        </>
      )}
      <GitHubCheckPanel report={report} changes={changes} />
    </>
  );
}

/** The helper works, or an update file comes in, so the report changes without a click */
function isWaitingForServer(report: UpdatesReport): boolean {
  return isHelperWorking(report) || report.isReceiving;
}

function usePolling(isOn: boolean, refresh: () => Promise<void>) {
  useEffect(() => {
    if (!isOn) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [isOn, refresh]);
}

function VersionCards({ report }: { report: UpdatesReport }) {
  return (
    <section aria-labelledby="this-chatter" className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-3">
      <h2 id="this-chatter" className="sr-only">This Chatter</h2>
      <InfoCard label="Installed version">
        <span className="font-mono">{report.version}</span>
      </InfoCard>
      <InfoCard label="Newest version on GitHub">{newestText(report.newest)}</InfoCard>
      {report.freeBytes !== null && <InfoCard label="Free space on the card">{formatSize(report.freeBytes)}</InfoCard>}
    </section>
  );
}

function newestText(newest: UpdatesReport['newest']): string {
  if (!newest.checkGitHub) return 'The check is off';
  if (newest.error) return newest.error;
  if (!newest.version) return 'Not checked yet';
  return newest.isNewer ? `${newest.version} is available` : 'You have the newest version';
}

/** A normal computer has no update helper. There, the Admin updates Chatter by hand, with Docker. */
function ManualUpdatePanel() {
  return (
    <Panel title="Update with Docker" description="Your machines, users and history are kept.">
      <ol className="m-0 flex list-decimal flex-col gap-2 py-4 pr-5 pl-10">
        <li>
          Back up your data first. See <DocsLink page="guide/update#back-up">Back up</DocsLink> in the Chatter docs.
        </li>
        <li>
          Did you change <Command text="docker-compose.yml" /> or <Command text="vmalert/rules.yml" />? Keep a copy of
          them.
        </li>
        <li>
          Download the Docker package of the new version from the GitHub release.
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            <li>
              Unzip it in the same place, so that the new <Command text="chatter" /> folder replaces the old one.
            </li>
            <li>
              Keep the folder name <Command text="chatter" />: Chatter finds your data by this name.
            </li>
          </ul>
        </li>
        <li>
          Did you keep a copy in step 2? Then make the same changes in the new <Command text="docker-compose.yml" /> and{' '}
          <Command text="vmalert/rules.yml" />.
        </li>
        <li>
          In the <Command text="chatter" /> folder, run these 2 commands, one after the other:
          <CommandLine command="docker load -i images.tar" />
          <CommandLine command="docker compose up -d" />
        </li>
      </ol>
      <div className="border-t border-zinc-800 py-4 px-5 text-sm text-zinc-400">
        Did you install Chatter with only the <Command text="docker-compose.yml" /> file, with no zip? Then back up
        first, and run these 2 commands in that folder, one after the other:
        <CommandLine command="docker compose pull" />
        <CommandLine command="docker compose up -d" />
      </div>
    </Panel>
  );
}

function Command({ text }: { text: string }) {
  return <code className="font-mono text-zinc-50">{text}</code>;
}

/**
 * Get an update file onto the card: download the newest release, or upload a file from this computer.
 * Then ask the helper to check it.
 */
function UpdateFilePanel({ report, changes }: { report: UpdatesReport; changes: UpdateChanges }) {
  const { change, isChanging, error } = changes;
  // How much of the upload is sent (0 to 1), or null when no upload runs in this browser
  const [sent, setSent] = useState<number | null>(null);
  const isBlocked = isChanging || report.isReceiving || isHelperWorking(report);
  const { newest } = report;

  const upload = async (file: File) => {
    setSent(0);
    await change(() => uploadUpdateFile(file, setSent));
    setSent(null);
  };

  return (
    <Panel
      title="Update file"
      description={`Download the newest version, or upload the update file for this card (for ${report.helper?.arch} processors) from your computer.`}
    >
      <div className="flex flex-col gap-3 px-5 py-4">
        {report.hasUpdateFile && <p className="m-0 text-zinc-200">An update file is here. Check it before you install it.</p>}
        {sent !== null && <UploadProgress sent={sent} />}
        {sent === null && report.isReceiving && <Notice tone="info" title="An update file is coming in…" />}
        {report.downloadError && <Notice tone="error" title={report.downloadError} />}
        {error && <Notice tone="error" title={error} />}
        <div className="flex flex-wrap justify-end gap-2">
          {newest.isNewer && (
            <Button onClick={() => change(downloadUpdate)} disabled={isBlocked}>Download version {newest.version}</Button>
          )}
          <FileButton inputLabel="Update file to upload" accept=".tar" disabled={isBlocked} onFile={upload}>
            Upload update file
          </FileButton>
          {report.hasUpdateFile && (
            <Button variant="primary" onClick={() => change(checkUpdateFile)} disabled={isBlocked}>Check the update file</Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function UploadProgress({ sent }: { sent: number }) {
  return (
    <div className="flex items-center gap-3">
      <progress aria-label="Upload" value={sent} max={1} className="h-2 flex-1 accent-primary" />
      <span className="text-zinc-200">Uploading… {Math.round(sent * 100)}%</span>
    </div>
  );
}

/** The switch for the daily check on GitHub. Chatter only tells about a new version. It never installs by itself. */
function GitHubCheckPanel({ report, changes }: { report: UpdatesReport; changes: UpdateChanges }) {
  const labelId = useId();
  const save = (checkGitHub: boolean) => changes.change(() => saveUpdateSettings({ checkGitHub }));
  return (
    <Panel>
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex flex-col gap-1">
          <span id={labelId} className="font-bold">Check for updates on GitHub</span>
          <span className="text-zinc-200">Chatter asks GitHub once a day for the newest version. It never installs an update by itself.</span>
        </div>
        <Switch
          aria-labelledby={labelId}
          checked={report.newest.checkGitHub}
          onCheckedChange={save}
          disabled={changes.isChanging}
        />
      </div>
    </Panel>
  );
}
