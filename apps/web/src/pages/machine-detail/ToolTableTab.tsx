import { cn } from '@toolpath/ui';
import { useEffect, useState } from 'react';
import { SYNC_FAILURE_TEXT, ToolSyncError, syncTools, type SyncProblem } from '../../api/toolSync';
import { useCan } from '../../components/CurrentUser';
import { Button } from '../../components/ui/Button';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import type { ToolInfo, ToolSyncState, ToolTable } from '../../types';
import { errorMessageOf } from '../../utils/errorMessage';

interface ToolTableTabProps {
  machineId: string;
  /** True while Chatter is connected to the machine */
  connected: boolean;
  /** The end of the last good poll */
  lastPollTime: string | null;
  /** The reads of the tool table. Only a machine that reads its tool table apart from the state polls (Brother) has it. */
  toolSync?: ToolSyncState;
  toolTable: ToolTable;
  /** True when the machine reports which pocket holds each tool */
  hasPocketInfo: boolean;
  /** The tool in the spindle now, when the machine sends it */
  spindleTool: number | undefined;
}

/** A length or a diameter with 4 decimal places, or a dash when the machine does not send it */
const formatMeasure = (value: number | undefined) => value?.toFixed(4) ?? '—';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** The newer of two states, by the end of their last read */
function newerState(fromStatus: ToolSyncState, fromSync: ToolSyncState | null): ToolSyncState {
  if (!fromSync) return fromStatus;
  return (fromStatus.lastAttemptAt ?? '') > (fromSync.lastAttemptAt ?? '') || fromStatus.running ? fromStatus : fromSync;
}

/** The connection to the machine, from the status of the server */
interface MachineLink {
  connected: boolean;
  /** The end of the last good poll */
  lastPollTime: string | null;
}

/** The error of a Sync that the server refused before it read the tools */
interface RefusalError {
  text: string;
  refusal: Exclude<SyncProblem, { outcome: 'failed' }>;
  /** The last read of the server when the Sync started */
  serverAttemptAt: string | null;
  /** The last good poll when the Sync started */
  pollTimeAt: string | null;
  /** True after the screen showed the cause of the refusal: the machine offline, or a read that runs */
  causeSeen: boolean;
}

/** True while the cause of a refusal shows on the screen */
function causeShows(refusal: RefusalError['refusal'], link: MachineLink, toolSync: ToolSyncState): boolean {
  if (refusal.outcome === 'not-connected') return !link.connected;
  if (refusal.outcome === 'busy') return toolSync.running;
  return false;
}

/**
 * True when the server read the tools after the Sync started. A status with no read is not newer: the server forgets
 * its last read when the address changes, and it sends that status before its reply "address changed".
 */
function newerReadCame(toolSync: ToolSyncState, serverAttemptAt: string | null): boolean {
  return toolSync.lastAttemptAt !== null && (serverAttemptAt === null || toolSync.lastAttemptAt > serverAttemptAt);
}

/**
 * True when a good poll ended after the Sync started, and the machine is connected. A control can close the
 * connection between two polls, and the next poll connects again. Then the screen never shows the machine offline.
 */
function newerGoodPollCame(link: MachineLink, pollTimeAt: string | null): boolean {
  return link.connected && link.lastPollTime !== null && (pollTimeAt === null || link.lastPollTime > pollTimeAt);
}

/**
 * True while the error of a refused Sync still applies. A newer read of the server removes each such error.
 * "Not connected" goes when the machine is connected again, or after a newer good poll. "Program running" goes after
 * a newer good poll, because the program can have ended and the user can press Sync again. "Busy" goes when the read
 * that ran ends. "Too soon" goes after its seconds (see the timer in useRefusalError). Another error, for example
 * "address changed", stays until the newer read or the next Sync.
 */
function stillApplies(error: RefusalError, link: MachineLink, toolSync: ToolSyncState): boolean {
  if (newerReadCame(toolSync, error.serverAttemptAt)) return false;
  const goesAfterGoodPoll = error.refusal.outcome === 'not-connected' || error.refusal.outcome === 'program-running';
  if (goesAfterGoodPoll && newerGoodPollCame(link, error.pollTimeAt)) return false;
  if (error.refusal.outcome === 'not-connected' || error.refusal.outcome === 'busy') {
    return !error.causeSeen || causeShows(error.refusal, link, toolSync);
  }
  return true;
}

/** The error of the last refused Sync, and its text while it still applies */
function useRefusalError(link: MachineLink, toolSync: ToolSyncState) {
  const [error, setError] = useState<RefusalError | null>(null);

  // The cause of a refusal can show on the screen after the reply of the server
  if (error && !error.causeSeen && causeShows(error.refusal, link, toolSync)) setError({ ...error, causeSeen: true });

  // The server accepts a Sync again after the seconds that it gave
  const retryAfterSeconds = error?.refusal.outcome === 'too-soon' ? error.refusal.retryAfterSeconds : null;
  useEffect(() => {
    if (retryAfterSeconds === null) return;
    const timer = setTimeout(() => setError(null), retryAfterSeconds * 1000);
    return () => clearTimeout(timer);
  }, [error, retryAfterSeconds]);

  const text = error && stillApplies(error, link, toolSync) ? error.text : null;
  return { text, setError };
}

/** When Chatter read the tool table, and the Sync button that reads it now */
function ToolSyncBar({ machineId, link, toolSync }: { machineId: string; link: MachineLink; toolSync: ToolSyncState }) {
  const [syncing, setSyncing] = useState(false);
  const { text: refusalText, setError } = useRefusalError(link, toolSync);
  /** The state in the reply of the last Sync. A failed read has its error in it. */
  const [fromSync, setFromSync] = useState<ToolSyncState | null>(null);
  const state = newerState(toolSync, fromSync);
  const running = syncing || state.running;

  const sync = async () => {
    setSyncing(true);
    setError(null);
    try {
      setFromSync(await syncTools(machineId));
    } catch (err) {
      // A read that failed has its error in its state, as in the status, so the screen shows one text for it
      if (err instanceof ToolSyncError && err.problem.outcome === 'failed') setFromSync(err.problem.toolSync);
      else setError(refusalErrorOf(err, toolSync, link));
    } finally {
      setSyncing(false);
    }
  };

  const shownError = refusalText ?? state.error;
  // A Viewer only looks: the server refuses its Sync. It still sees when Chatter read the tools.
  const canSync = useCan('sync-tools');
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3 text-zinc-200">
      <span>{running ? 'Syncing…' : state.lastSyncAt ? `Synced ${timeOf(state.lastSyncAt)}` : 'Not synced yet'}</span>
      {canSync && <Button size="sm" onClick={() => void sync()} disabled={running}>Sync</Button>}
      <span className="text-xs">
        Chatter reads the tool table only when you press Sync, and only when the control reports that no program runs.
        Press Sync only when no program runs. Do not press it while the door is open during a program: some Brother
        controls report that no program runs while the door holds a program.
      </span>
      {shownError && !running && <span role="alert" className="w-full text-alarm-soft">{shownError}</span>}
    </div>
  );
}

/** The error of a refused Sync. The time of the last read and `link` are the ones when the Sync started. */
function refusalErrorOf(err: unknown, toolSync: ToolSyncState, link: MachineLink): RefusalError {
  const refusal = err instanceof ToolSyncError && err.problem.outcome !== 'failed' ? err.problem : { outcome: 'other' as const };
  return {
    text: errorMessageOf(err, SYNC_FAILURE_TEXT),
    refusal,
    serverAttemptAt: toolSync.lastAttemptAt,
    pollTimeAt: link.lastPollTime,
    causeSeen: causeShows(refusal, link, toolSync),
  };
}

/** One row for each tool, with its lengths and wear. The tool in the spindle is marked. */
export function ToolTableTab({ machineId, connected, lastPollTime, toolSync, toolTable, hasPocketInfo, spindleTool }: ToolTableTabProps) {
  const toolsByPocket = Object.entries(toolTable) as [string, ToolInfo][];

  return (
    <>
      {toolSync && <ToolSyncBar machineId={machineId} link={{ connected, lastPollTime }} toolSync={toolSync} />}
      <div className="flex flex-wrap justify-between gap-3 px-4 py-3 text-zinc-200">
        <span>The lengths and diameters are in the machine's units. The tool in the spindle is marked.</span>
        {!hasPocketInfo && <span>This machine does not send the pocket of each tool.</span>}
      </div>
      <div className="overflow-x-auto">
        <table className={cn(TABLE, 'min-w-[35rem] font-mono')}>
          <thead>
            <tr className={cn(HEAD_ROW, 'text-right font-body')}>
              {hasPocketInfo && <th scope="col" className={cn(HEAD_CELL, 'text-left')}>Pocket</th>}
              <th scope="col" className={cn(HEAD_CELL, 'text-left')}>Tool</th>
              <th scope="col" className={HEAD_CELL}>Length</th>
              <th scope="col" className={HEAD_CELL}>Length wear</th>
              <th scope="col" className={HEAD_CELL}>Diameter</th>
              <th scope="col" className={HEAD_CELL}>Diameter wear</th>
            </tr>
          </thead>
          <tbody>
            {toolsByPocket.map(([pocket, tool]) => {
              const isInSpindle = tool.toolNum === spindleTool;
              return (
                <tr key={pocket} className={cn(ROW, 'text-right', isInSpindle && 'bg-primary/14')}>
                  {hasPocketInfo && <td className={cn(CELL, 'text-left')}>P{pocket}</td>}
                  <th scope="row" className={cn(CELL, 'text-left font-medium')}>
                    T{tool.toolNum}
                    {tool.name && <span className="ml-2 font-body text-xs text-zinc-200">{tool.name}</span>}
                    {isInSpindle && <span className="ml-2 font-body text-[0.6875rem] font-bold text-primary-text">IN SPINDLE</span>}
                  </th>
                  <td className={CELL}>{formatMeasure(tool.length)}</td>
                  <td className={CELL}>{formatMeasure(tool.lengthWear)}</td>
                  <td className={CELL}>{formatMeasure(tool.diameter)}</td>
                  <td className={CELL}>{formatMeasure(tool.diameterWear)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
