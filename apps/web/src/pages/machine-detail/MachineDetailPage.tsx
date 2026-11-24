import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useNow } from '../../hooks/useNow';
import { machineStateOf } from '../../machines/machineStatus';
import { SUPPORTED_MACHINE_TYPES, type Machine, type MachineUpdate } from '../../types';
import { splitFiring } from './alertList';
import { AlertsPanel } from './AlertsPanel';
import { chartChoicesFor, shownChartChoice, SPINDLE_SPEED, type ChartChoiceId } from './chartValues';
import { CurrentJobPanel } from './CurrentJobPanel';
import { MachineHeader } from './MachineHeader';
import { MachineNotice } from './MachineNotice';
import { MachineSections } from './MachineSections';
import { SiemensNotices } from './SiemensNotices';
import MachineHistoryChart from './MachineHistoryChart';
import { useMachineAlerts } from './useMachineAlerts';
import { firstChartHistory } from './useChartView';

interface MachineDetailPageProps {
  machines: Machine[];
  /** False until the server sent the machine list the first time */
  isLoaded: boolean;
  /** True when the page lost its live connection to Chatter, so the values are old */
  chatterIsLost?: boolean;
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
function MachineDetailPage({ machines, isLoaded, chatterIsLost = false, onRemove, onUpdate }: MachineDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const machine = machines.find(candidate => candidate.id === id && KNOWN_TYPES.includes(candidate.type));

  if (!machine) return isLoaded ? <MachineNotFound /> : <p className="m-0 text-zinc-200">Loading the machine…</p>;

  const remove = async () => {
    if (await onRemove(machine.id)) navigate('/');
  };

  // A new key for each machine, so nothing of the machine before stays: not the alerts, the files or the chart view
  return <MachineView key={machine.id} machine={machine} machines={machines} chatterIsLost={chatterIsLost} onUpdate={onUpdate} onRemove={remove} />;
}

interface MachineViewProps {
  machine: Machine;
  machines: Machine[];
  chatterIsLost: boolean;
  onUpdate: (id: string, updates: MachineUpdate) => Promise<boolean>;
  onRemove: () => Promise<void>;
}

/** The page of a machine that Chatter knows */
function MachineView({ machine, machines, chatterIsLost, onUpdate, onRemove }: MachineViewProps) {
  const now = useNow(CLOCK_TICK_MS);
  // The page keeps the chart's value, because the Current job panel leaves that value out
  const [chosenChartValue, setChosenChartValue] = useState<ChartChoiceId>(SPINDLE_SPEED.id);
  // The page also keeps the time in the chart and its history, so they stay when the user opens another tab and comes back
  const chartView = useState(firstChartHistory);
  // One load of the alerts for the badge, the Dashboard tab and the Alerts panel
  const alerts = useMachineAlerts(machine.id);
  const firingCount = splitFiring(alerts.alerts).firing.length;
  const state = machineStateOf(machine);
  const chartChoices = chartChoicesFor(machine);
  const chartChoice = shownChartChoice(chartChoices, chosenChartValue);

  return (
    <>
      <MachineHeader machine={machine} state={state} now={now} firingCount={firingCount} />
      <MachineNotice machine={machine} state={state} now={now} chatterIsLost={chatterIsLost} />
      {machine.type === 'siemens' && <SiemensNotices machine={machine} />}
      <MachineSections
        machine={machine}
        machines={machines}
        now={now}
        onUpdate={onUpdate}
        onRemove={onRemove}
        firingCount={firingCount}
        dashboard={
          <>
            <div className="flex flex-wrap items-stretch gap-5">
              <CurrentJobPanel machine={machine} state={state} now={now} chartValue={chartChoice.id} />
              <MachineHistoryChart
                machine={machine}
                choices={chartChoices}
                choice={chartChoice}
                onChoose={setChosenChartValue}
                view={chartView}
                className="flex-[2_1_28.75rem]"
              />
            </div>
            <AlertsPanel machineId={machine.id} alerts={alerts} />
          </>
        }
      />
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
