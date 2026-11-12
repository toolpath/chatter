import { useState } from 'react';
import type { MachineReport } from '../../api/reports';
import { Panel } from '../../components/ui/Panel';
import { RangeButtons } from '../../components/ui/RangeButtons';
import { InfoTip } from '../../components/ui/InfoTip';
import { CELL, HEAD_CELL, HEAD_ROW, ROW, TABLE } from '../../components/ui/table';
import { alarmHelp } from '../../machines/alarmHelp';
import type { Machine } from '../../types';
import { formatDuration, formatShare } from './reportView';
import { useMachineReport } from './useMachineReport';

interface ReportRange {
  id: string;
  /** The words after "in the last" */
  words: string;
  /** The range the server wants, such as "-1d" */
  query: string;
}

const REPORT_RANGES: ReportRange[] = [
  { id: '8h', words: '8 hours', query: '-8h' },
  { id: '24h', words: '24 hours', query: '-24h' },
  { id: '7d', words: '7 days', query: '-7d' },
  { id: '30d', words: '30 days', query: '-30d' },
];

/** How long the machine ran and was online, the parts it made, and its alarms, in the last 8 hours to 30 days */
export function ReportPanel({ machineId, machineType }: { machineId: string; machineType: Machine['type'] }) {
  const [range, setRange] = useState(REPORT_RANGES[1]);
  const { report, failed } = useMachineReport(machineId, range.query);

  return (
    <Panel
      title="Report"
      description={`Last ${range.words}, while Chatter watched`}
      actions={<RangeButtons options={REPORT_RANGES} value={range} onChange={setRange} />}
    >
      <div role="status">
        {failed && (
          <p className="m-0 px-5 py-4 text-alarm-soft">
            Could not load the report{report ? ', so these are the last numbers' : ''}. Chatter tries again in 1 minute.
          </p>
        )}
        {!failed && !report && <p className="m-0 px-5 py-4 text-zinc-300">Loading the report…</p>}
      </div>
      {report && <ReportBody report={report} words={range.words} machineType={machineType} />}
    </Panel>
  );
}

function ReportBody({ report, words, machineType }: { report: MachineReport; words: string; machineType: Machine['type'] }) {
  if (report.watchedMs === null) {
    return <p className="m-0 px-5 py-4 text-zinc-300">Chatter has no data for this machine in the last {words}.</p>;
  }
  const watched = report.watchedMs;
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-px border-b border-zinc-800 bg-zinc-800">
        <ReportTile
          label="Running"
          value={report.runningMs === null ? '—' : formatDuration(report.runningMs)}
          detail={report.runningMs === null ? 'This machine does not tell when a program runs' : `${formatShare(report.runningMs, watched)} of the watched time`}
        />
        <ReportTile
          label="Online"
          value={formatDuration(report.onlineMs ?? 0)}
          detail={`${formatShare(report.onlineMs ?? 0, watched)} of ${formatDuration(watched)} watched`}
        />
        <ReportTile
          label="Parts made"
          value={report.partsMade === null ? '—' : String(Math.round(report.partsMade))}
          detail={report.partsMade === null ? 'No part count in this range' : 'From the part counter'}
        />
        <ReportTile label="Alarms" value={String(report.alarms.count)} detail={`${formatDuration(report.alarms.totalMs)} in alarm`} />
      </div>
      {report.alarms.values.length > 0 && <AlarmTable values={report.alarms.values} machineType={machineType} />}
    </>
  );
}

function ReportTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 bg-zinc-900 px-5 py-4">
      <span className="text-xs font-semibold text-zinc-300">{label}</span>
      <span className="font-display text-2xl font-extrabold tabular-nums">{value}</span>
      <span className="text-xs text-zinc-300">{detail}</span>
    </div>
  );
}

function AlarmTable({ values, machineType }: { values: MachineReport['alarms']['values']; machineType: Machine['type'] }) {
  // No scroll box around the table: it would cut off the info box of the last rows. The 3 columns fit a phone.
  return (
    <table className={TABLE}>
      <caption className="sr-only">The alarms with the most time</caption>
      <thead>
        <tr className={HEAD_ROW}>
          <th scope="col" className={HEAD_CELL}>Alarm</th>
          <th scope="col" className={HEAD_CELL}>Times</th>
          <th scope="col" className={HEAD_CELL}>Time in alarm</th>
        </tr>
      </thead>
      <tbody>
        {values.map(alarm => (
          <tr key={alarm.value} className={ROW}>
            <td className={CELL}>
              <span className="inline-flex items-center gap-1">
                {alarm.value}
                <InfoTip label={`What ${alarm.value} means`}>{alarmHelp(machineType, alarm.value)}</InfoTip>
              </span>
            </td>
            <td className={`${CELL} tabular-nums`}>{alarm.count}</td>
            <td className={`${CELL} tabular-nums`}>{formatDuration(alarm.totalMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
