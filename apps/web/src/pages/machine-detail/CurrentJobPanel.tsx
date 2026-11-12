import type { HistoryValue } from '@local-chatter/shared';
import { ProgressBar } from '../../components/MachineStateMark';
import type { MachineState } from '../../machines/machineStatus';
import type { Machine } from '../../types';
import { formatAgo } from '../../utils/formatters';
import { jobValuesOf } from './jobValues';

interface CurrentJobPanelProps {
  machine: Machine;
  state: MachineState;
  now: number;
  /** The value that the chart shows. Its row is left out, so it is not on the page twice. */
  chartValue: HistoryValue;
}

/** The live values of the machine, one row each. The rows share the height of the card. */
export function CurrentJobPanel({ machine, state, now, chartValue }: CurrentJobPanelProps) {
  return (
    <section
      aria-labelledby="current-job-title"
      className="flex flex-[1_1_17.5rem] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
    >
      <div className="flex flex-col gap-0.5 px-5 pt-4 pb-3">
        <h2 id="current-job-title" className="m-0 text-base font-bold">Current job</h2>
        <span className="text-xs text-zinc-300">Read from the machine {formatAgo(machine.lastPollTime, now)}.</span>
      </div>
      <dl className="m-0 flex flex-1 flex-col">
        {jobValuesOf(machine, chartValue).map(jobValue => (
          <div key={jobValue.label} className="flex flex-1 flex-col justify-center gap-1.5 border-t border-zinc-800/70 px-5 py-[0.4375rem]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-zinc-300">{jobValue.label}</dt>
              <dd className="m-0 font-mono text-sm font-medium tabular-nums">{jobValue.value}</dd>
            </div>
            {jobValue.fraction != null && <ProgressBar fraction={jobValue.fraction} state={state} />}
          </div>
        ))}
      </dl>
    </section>
  );
}
