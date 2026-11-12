import { isBusy, type UpdateStatus } from '@local-chatter/shared';
import { Dialog } from '@toolpath/ui';
import { installUpdate, type UpdatesReport } from '../../api/updates';
import { Button } from '../../components/ui/Button';
import { Notice, type NoticeTone } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { formatSize } from '../../utils/formatters';

const INSTALL_WARNING = 'Chatter stops for some minutes. Machine data is not saved during that time. File transfers stop.';

/** What a change in Settings > Updates needs: run it, whether one runs now, and why the last one failed */
export interface UpdateChanges {
  /** Runs a change that gives the new report. Returns true when it worked. */
  change: (action: () => Promise<UpdatesReport>) => Promise<boolean>;
  isChanging: boolean;
  error: string | null;
}

/** The helper works now, or a request waits for it */
export function isHelperWorking(report: UpdatesReport): boolean {
  return report.isRequestPending || (report.status !== null && isBusy(report.status.state));
}

interface StatusNotice {
  tone: NoticeTone;
  title: string;
  details?: string;
}

const versionName = (version?: string) => (version ? `version ${version}` : 'the new version');
const startWithCapital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What the page says about the last check or install */
function statusNotice(status: UpdateStatus): StatusNotice {
  const version = versionName(status.version);
  const freed = status.freedBytes ? `The update gave back ${formatSize(status.freedBytes)} of space.` : undefined;
  switch (status.state) {
    case 'checking': return { tone: 'info', title: 'Checking the update file…' };
    case 'ready': return { tone: 'success', title: `${startWithCapital(version)} passed the check` };
    case 'installing': return { tone: 'info', title: `Installing ${version}…`, details: 'Chatter stops for some minutes. This page comes back by itself.' };
    case 'done': return { tone: 'success', title: `${startWithCapital(version)} is installed`, details: freed };
    case 'refused': return { tone: 'error', title: 'The update file did not pass the check', details: status.reason };
    case 'failed': return { tone: 'error', title: 'The update failed. The old version runs, and nothing changed.', details: status.reason };
    case 'rolled-back': return { tone: 'error', title: 'The new version did not start, so the old version and its data came back', details: status.reason };
  }
}

/** A file passed the check, but a new update file came in after it. The helper installs only a checked file. */
const hasNewFileAfterCheck = ({ status, hasUpdateFile }: UpdatesReport) => status?.state === 'ready' && hasUpdateFile;

/** A waiting request comes first: the status is still the one from before the request */
function currentNotice(report: UpdatesReport): StatusNotice | null {
  if (report.isRequestPending) return { tone: 'info', title: 'Waiting for the update helper…' };
  if (hasNewFileAfterCheck(report)) {
    return { tone: 'info', title: 'A new update file needs a check', details: 'Check the new file before you install it.' };
  }
  return report.status && statusNotice(report.status);
}

/** The last check or install, and Install when a file passed the check */
export function UpdateStatusPanel({ report, changes }: { report: UpdatesReport; changes: UpdateChanges }) {
  const notice = currentNotice(report);
  if (!notice) return null;
  const { status } = report;
  const canInstall = !report.isRequestPending && status?.state === 'ready' && !report.hasUpdateFile;

  return (
    <Panel title="Update status">
      <div className="flex flex-col gap-3 px-5 py-4">
        <Notice tone={notice.tone} title={notice.title}>{notice.details}</Notice>
        {canInstall && <InstallButton version={status.version} changes={changes} />}
      </div>
    </Panel>
  );
}

function InstallButton({ version, changes }: { version?: string; changes: UpdateChanges }) {
  const { confirm } = Dialog.useDialog();
  const name = versionName(version);

  const install = async () => {
    const accepted = await confirm(
      <Dialog variant="danger">
        <Dialog.Title>Install {name}?</Dialog.Title>
        <Dialog.Message>{INSTALL_WARNING}</Dialog.Message>
        <Dialog.Actions>
          <Dialog.Dismiss>Not now</Dialog.Dismiss>
          <Dialog.Confirm>Install</Dialog.Confirm>
        </Dialog.Actions>
      </Dialog>,
    );
    if (accepted) await changes.change(installUpdate);
  };

  return (
    <div className="flex justify-end">
      <Button variant="primary" onClick={install} disabled={changes.isChanging}>Install {name}</Button>
    </div>
  );
}
