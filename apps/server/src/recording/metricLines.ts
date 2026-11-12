import type { HistoryValue } from '@local-chatter/shared';
import type { MachineDataSnapshot } from '../types/index.js';

type ReadValue = (snapshot: MachineDataSnapshot) => number | boolean | undefined;

/** The FANUC run state, and the execution value (MTConnect, Haas and Brother), when a program runs */
const RUNNING_FANUC = 'START';
const RUNNING_MTCONNECT = 'ACTIVE';

/**
 * The machine values that go to VictoriaMetrics, and where each one is in a snapshot.
 * A state is saved as 1 or 0, so its average over a time is the part of that time it was on.
 */
const METRICS: Record<Exclude<HistoryValue, 'connected'>, ReadValue> = {
  'spindle-speed': snapshot => snapshot.spindleSpeed,
  'spindle-load': snapshot => snapshot.spindleLoad,
  feedrate: snapshot => snapshot.feedrate,
  'part-count': snapshot => snapshot.partCount,
  'part-goal': snapshot => snapshot.partGoal,
  'tool-number': snapshot => snapshot.toolNumber,
  alarm: snapshot => snapshot.alarm,
  emergency: snapshot => snapshot.emergency,
  running: isRunning,
};

/**
 * The values of one machine poll, as lines in the Prometheus text format,
 * for example `chatter_spindle_speed{machine="m1",type="brother"} 1200 1762678800000`.
 * A machine that does not answer gets only `chatter_connected 0`, because its other values are old.
 */
export function metricLines(snapshot: MachineDataSnapshot, timeMs: number): string[] {
  const labels = labelsOf(snapshot);
  const lineOf = (value: HistoryValue, metricValue: number) => `${historyMetricName(value)}{${labels}} ${metricValue} ${timeMs}`;

  const connectedLine = lineOf('connected', snapshot.connected ? 1 : 0);
  if (!snapshot.connected) return [connectedLine];

  const valueLines = (Object.entries(METRICS) as [HistoryValue, ReadValue][]).flatMap(([value, readValue]) => {
    const metricValue = toMetricNumber(readValue(snapshot));
    return metricValue === undefined ? [] : [lineOf(value, metricValue)];
  });
  return [connectedLine, ...valueLines];
}

/** The metric of a history value, for example spindle-speed → chatter_spindle_speed */
export function historyMetricName(value: HistoryValue): string {
  return `chatter_${value.replace(/-/g, '_')}`;
}

/** The selector of every series of one machine, for a MetricsQL query or a delete */
export function machineSelector(machineId: string): string {
  return `{machine="${escapeLabelValue(machineId)}"}`;
}

/** Undefined when the machine does not tell whether a program runs (for example a Haas with no query port) */
function isRunning(snapshot: MachineDataSnapshot): boolean | undefined {
  if (snapshot.runState !== undefined) return snapshot.runState === RUNNING_FANUC;
  if (snapshot.execution !== undefined) return snapshot.execution === RUNNING_MTCONNECT;
  return undefined;
}

function toMetricNumber(value: number | boolean | undefined): number | undefined {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The machine id, not the name, because a new name must not start a new series */
function labelsOf(snapshot: MachineDataSnapshot): string {
  return `machine="${escapeLabelValue(snapshot.machineId)}",type="${escapeLabelValue(snapshot.machineType)}"`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
