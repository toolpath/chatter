import type { HistoryValue } from '@local-chatter/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useNow } from '../../hooks/useNow';
import { machineStateOf } from '../../machines/machineStatus';
import { SUPPORTED_MACHINE_TYPES, type Machine, type MachineUpdate } from '../../types';
import { AlertsPanel } from './AlertsPanel';
import { chartValuesFor, shownChartValue, SPINDLE_SPEED } from './chartValues';
import { CurrentJobPanel } from './CurrentJobPanel';
import { MachineHeader } from './MachineHeader';
import { MachineNotice } from './MachineNotice';
import { MachineSections } from './MachineSections';
import { ReportPanel } from './ReportPanel';
import MachineHistoryChart from './MachineHistoryChart';

interface MachineDetailPageProps {
  machines: Machine[];
  /** False until the server sent the machine list the first time */
  isLoaded: boolean;
  /** True when the server removed the machine */
  onRemove: (id: string) => Promise<boolean>;
  /** True when the server saved the update */
  onUpdate: (id: string, updates: MachineUpdate) => Promise<boolean>;
}

/** The "seconds ago" texts on the page change this often */
const CLOCK_TICK_MS = 1000;

/** The page can show only the machine types it knows */
const KNOWN_TYPES: readonly string[] = SUPPORTED_MACHINE_TYPES;

/** One machine: its state, the current job, the spindle chart, and its files and settings */
function MachineDetailPage({ machines, isLoaded, onRemove, onUpdate }: MachineDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const now = useNow(CLOCK_TICK_MS);
  // The page keeps the chart's value, because the Current job panel leaves that value out
  const [chosenChartValue, setChosenChartValue] = useState<HistoryValue>(SPINDLE_SPEED.id);
  const machine = machines.find(candidate => candidate.id === id && KNOWN_TYPES.includes(candidate.type));

  if (!machine) return isLoaded ? <MachineNotFound /> : <p className="m-0 text-zinc-200">Loading the machine…</p>;

  const state = machineStateOf(machine);
  const chartValues = chartValuesFor(machine);
  const chartValue = shownChartValue(chartValues, chosenChartValue);
  const remove = async () => {
    if (await onRemove(machine.id)) navigate('/');
  };

  return (
    <>
      <MachineHeader machine={machine} state={state} now={now} />
      <MachineNotice machine={machine} state={state} now={now} />
      <div className="flex flex-wrap items-stretch gap-5">
        <CurrentJobPanel machine={machine} state={state} now={now} chartValue={chartValue.id} />
        <MachineHistoryChart
          machine={machine}
          values={chartValues}
          value={chartValue}
          onChoose={setChosenChartValue}
          className="flex-[2_1_28.75rem]"
        />
      </div>
      <ReportPanel machineId={machine.id} machineType={machine.type} />
      <AlertsPanel machineId={machine.id} />
      {/* A new key for each machine, so the files and the open tab start again */}
      <MachineSections key={machine.id} machine={machine} machines={machines} now={now} onUpdate={onUpdate} onRemove={remove} />
    </>
  );
}

function MachineNotFound() {
  return (
    <div className="flex flex-col items-start gap-2">
      <h1 className="m-0 font-display text-2xl font-extrabold">Machine not found</h1>
      <p className="m-0 text-zinc-200">Chatter has no machine at this address. Someone may have removed it.</p>
      <Link to="/" className="font-semibold text-primary-text">Go to all machines</Link>
    </div>
  );
}

export default MachineDetailPage;
