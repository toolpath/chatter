import { cn } from '@toolpath/ui';
import {
  fetchLoginsReport,
  unlockComputer,
  type LockedComputer,
  type LoginResult,
  type LoginsReport,
  type LoginTry,
} from '../../api/settings';
import { Button } from '../../components/ui/Button';
import { RefreshIcon } from '../../components/ui/icons';
import { Notice } from '../../components/ui/Notice';
import { Panel } from '../../components/ui/Panel';
import { StatusDot, type StatusTone } from '../../components/ui/StatusDot';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import { formatAgo } from '../../utils/formatters';
import { ReportPending } from './ReportPending';
import { useServerReport } from './useServerReport';

const MINUTE_MS = 60_000;

/** When the server locks a computer */
type Limits = LoginsReport['limits'];

const RESULT_TONES: Record<LoginResult, StatusTone> = {
  'logged-in': 'good',
  'password-changed': 'good',
  'wrong-password': 'check',
  'no-such-user': 'check',
  locked: 'bad',
};

function resultLabel(result: LoginResult, { maxWrongPasswords }: Limits): string {
  const labels: Record<LoginResult, string> = {
    'logged-in': 'Logged in',
    'password-changed': 'Changed the password',
    'wrong-password': 'Wrong password',
    'no-such-user': 'No such user',
    locked: `Locked: ${maxWrongPasswords} wrong passwords`,
  };
  return labels[result];
}

/** The computers that must wait after too many wrong passwords, and the last password tries */
export function LoginsTab() {
  const { report, loadError, changeError, isChanging, change } = useServerReport(fetchLoginsReport);
  if (loadError || !report) return <ReportPending loadError={loadError} />;

  const unlock = (address: string) => change(() => unlockComputer(address));
  const refresh = () => change(fetchLoginsReport);
  return (
    <>
      {changeError && <Notice tone="error" title={changeError} />}
      <LockedComputersPanel locked={report.locked} limits={report.limits} onUnlock={isChanging ? undefined : unlock} />
      <RecentTriesPanel tries={report.tries} limits={report.limits} onRefresh={refresh} isRefreshing={isChanging} />
    </>
  );
}

interface LockedComputersPanelProps {
  locked: LockedComputer[];
  limits: Limits;
  /** Not set while a change runs */
  onUnlock?: (address: string) => void;
}

function LockedComputersPanel({ locked, limits, onUnlock }: LockedComputersPanelProps) {
  const now = Date.now();
  const description =
    `After ${limits.maxWrongPasswords} wrong passwords, a computer must wait ${limits.lockMinutes} min. You can unlock it now.`;
  return (
    <Panel title="Locked computers" description={description}>
      {locked.length === 0 ? (
        <p className="m-0 px-5 py-4 text-zinc-200">No computer is locked.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {locked.map(computer => (
            <LockedComputerRow key={computer.address} computer={computer} now={now} onUnlock={onUnlock} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

interface LockedComputerRowProps {
  computer: LockedComputer;
  now: number;
  /** Not set while a change runs */
  onUnlock?: (address: string) => void;
}

function LockedComputerRow({ computer, now, onUnlock }: LockedComputerRowProps) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-800 px-5 py-3 first:border-t-0">
      <span className="font-mono font-semibold">{computer.address}</span>
      <span className="flex-1 text-zinc-200">
        Tried user "{computer.username}" · locked for {minutesLeft(computer.until, now)} min more
      </span>
      <Button size="sm" disabled={!onUnlock} onClick={() => onUnlock?.(computer.address)} aria-label={`Unlock ${computer.address}`}>
        Unlock
      </Button>
    </li>
  );
}

/** Rounded up, so the last seconds show as "1 min" and not "0 min" */
function minutesLeft(until: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(until) - now) / MINUTE_MS));
}

interface RecentTriesPanelProps {
  tries: LoginTry[];
  limits: Limits;
  onRefresh: () => void;
  isRefreshing: boolean;
}

function RecentTriesPanel({ tries, limits, onRefresh, isRefreshing }: RecentTriesPanelProps) {
  const now = Date.now();
  const refreshButton = (
    <Button size="sm" variant="quiet" onClick={onRefresh} disabled={isRefreshing}>
      <RefreshIcon /> Refresh
    </Button>
  );
  return (
    <Panel
      title="Recent logins"
      description="The last 50 tries. The address comes from the proxy only when the proxy is trusted."
      actions={refreshButton}
    >
      {tries.length === 0 ? (
        <p className="m-0 px-5 py-4 text-zinc-200">No one has tried to log in yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={cn(TABLE, 'min-w-[36rem]')}>
            <thead>
              <tr className={HEAD_ROW}>
                <th scope="col" className={HEAD_CELL}>When</th>
                <th scope="col" className={HEAD_CELL}>User</th>
                <th scope="col" className={HEAD_CELL}>Address</th>
                <th scope="col" className={HEAD_CELL}>Result</th>
              </tr>
            </thead>
            <tbody>
              {tries.map((loginTry, index) => (
                // Two tries can have the same time, user and address, so the place in the list is the key
                <LoginTryRow key={index} loginTry={loginTry} limits={limits} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function LoginTryRow({ loginTry, limits, now }: { loginTry: LoginTry; limits: Limits; now: number }) {
  return (
    <tr className={ROW}>
      <td className={cn(CELL, 'text-zinc-200')}>{formatAgo(loginTry.at, now)}</td>
      <td className={CELL}>{loginTry.username}</td>
      <td className={cn(CELL, 'font-mono')}>{loginTry.address}</td>
      <td className={CELL}>
        <StatusDot tone={RESULT_TONES[loginTry.result]}>{resultLabel(loginTry.result, limits)}</StatusDot>
      </td>
    </tr>
  );
}
