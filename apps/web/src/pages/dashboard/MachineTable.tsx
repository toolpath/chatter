import { cn } from '@toolpath/ui';
import { Link } from 'react-router-dom';
import { ProgressBar, StateLabel } from '../../components/MachineStateMark';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import { alarmLine, alarmOf, offlineReasonOf } from '../../machines/alarm';
import { isReachable, machineStateOf, machineTypeLabel, NO_VALUE, partCountOf, toolText, type MachineState } from '../../machines/machineStatus';
import { formatAgo } from '../../utils/formatters';
import type { Machine } from '../../types';

/** What the alarm column says: the alarm, or why the machine is offline. A try that failed while connecting is not a problem yet. */
function problemText(machine: Machine, state: MachineState): string {
  if (state === 'offline') return offlineReasonOf(machine);
  if (state === 'connecting') return NO_VALUE;
  const alarm = alarmOf(machine);
  return alarm ? alarmLine(alarm) : NO_VALUE;
}

/** The spindle speed in whole rpm, with thousands separators, or NO_VALUE when it is not known */
function spindleSpeedText(speed: number | undefined): string {
  return typeof speed === 'number' ? Math.round(speed).toLocaleString('en-US') : NO_VALUE;
}

/** One row for each machine. The machine name opens its page. */
export function MachineTable({ machines, now }: { machines: Machine[]; now: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
      <table className={cn(TABLE, 'min-w-[53.75rem]')}>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={HEAD_CELL}>Machine</th>
            <th scope="col" className={HEAD_CELL}>State</th>
            <th scope="col" className={HEAD_CELL}>Program</th>
            <th scope="col" className={cn(HEAD_CELL, 'w-40')}>Parts</th>
            <th scope="col" className={cn(HEAD_CELL, 'text-right')}>Spindle (rpm)</th>
            <th scope="col" className={cn(HEAD_CELL, 'text-right')}>Tool</th>
            <th scope="col" className={HEAD_CELL}>Alarm</th>
            <th scope="col" className={cn(HEAD_CELL, 'text-right')}>Last poll</th>
          </tr>
        </thead>
        <tbody>
          {machines.map(machine => <MachineRow key={machine.id} machine={machine} now={now} />)}
        </tbody>
      </table>
    </div>
  );
}

function MachineRow({ machine, now }: { machine: Machine; now: number }) {
  const state = machineStateOf(machine);
  const isOnline = isReachable(state);
  const partCount = isOnline ? partCountOf(machine.data) : null;

  return (
    <tr className={cn(ROW, state === 'alarm' && 'bg-alarm/14')}>
      <td className={CELL}>
        <Link to={`/machine/${machine.id}`} className="font-bold text-zinc-50 no-underline hover:text-primary-text hover:underline">
          {machine.name}
        </Link>
        <div className="text-xs text-zinc-300">
          {machineTypeLabel(machine.type)} · <span className="font-mono">{machine.host}</span>
        </div>
      </td>
      <td className={cn(CELL, 'py-3.5')}><StateLabel state={state} /></td>
      <td className={cn(CELL, 'font-mono')}>{(isOnline && machine.data.program) || NO_VALUE}</td>
      <td className={CELL}>
        <div className="flex flex-col gap-1">
          <span className="font-mono">{partCount?.text ?? NO_VALUE}</span>
          {partCount?.fraction != null && <ProgressBar fraction={partCount.fraction} />}
        </div>
      </td>
      <td className={cn(CELL, 'text-right font-mono')}>{isOnline ? spindleSpeedText(machine.data.spindleSpeed) : NO_VALUE}</td>
      <td className={cn(CELL, 'text-right font-mono')}>{(isOnline && toolText(machine.data)) || NO_VALUE}</td>
      <td className={CELL}>{problemText(machine, state)}</td>
      <td className={cn(CELL, 'text-right whitespace-nowrap text-zinc-200')}>{formatAgo(machine.lastPollTime, now)}</td>
    </tr>
  );
}
