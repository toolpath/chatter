import type { HistoryValue } from '@local-chatter/shared';
import type { Machine } from '../../types';
import { formatChartNumber } from './historyChart';

/** A machine value that the history chart can show */
export interface ChartValue {
  id: HistoryValue;
  /** The name in the dropdown and in the messages, for example "Spindle speed" */
  name: string;
  /** The unit next to the name, for example "RPM". Not set when the value has no unit. */
  unit?: string;
  /** What the line shows, before "in the last 10 minutes" */
  description: string;
  /** The value axis goes at least this high, so a small value does not fill the chart */
  smallestAxisTop: number;
  /** The newest value from the live machine events, or undefined when the machine does not send it */
  liveValueOf: (machine: Machine) => number | undefined;
  /** The value with its unit, for the hover box and the screen reader text */
  format: (value: number) => string;
}

const numberOf = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

export const SPINDLE_SPEED: ChartValue = {
  id: 'spindle-speed',
  name: 'Spindle speed',
  unit: 'RPM',
  description: 'How fast the spindle turned',
  smallestAxisTop: 100,
  liveValueOf: machine => numberOf(machine.data.spindleSpeed),
  format: value => `${formatChartNumber(value)} RPM`,
};

const SPINDLE_LOAD: ChartValue = {
  id: 'spindle-load',
  name: 'Spindle load',
  unit: '%',
  description: 'How hard the spindle worked',
  smallestAxisTop: 100,
  liveValueOf: machine => numberOf(machine.data.spindleLoad),
  format: value => `${formatChartNumber(value)}%`,
};

const PART_COUNT: ChartValue = {
  id: 'part-count',
  name: 'Part count',
  description: 'The part counter of the machine',
  smallestAxisTop: 20,
  liveValueOf: machine => numberOf(machine.data.partCount),
  format: value => `${formatChartNumber(value)} parts`,
};

/** The value the user chose, or the spindle speed when the machine does not send the chosen value now */
export function shownChartValue(values: ChartValue[], chosenId: HistoryValue): ChartValue {
  return values.find(value => value.id === chosenId) ?? SPINDLE_SPEED;
}

/**
 * The values the chart can show. Spindle speed is always first, because it is the chart's start value.
 * The others show only for a machine that sends them, so the dropdown has no empty charts.
 */
export function chartValuesFor(machine: Machine): ChartValue[] {
  const others = [SPINDLE_LOAD, PART_COUNT].filter(value => value.liveValueOf(machine) !== undefined);
  return [SPINDLE_SPEED, ...others];
}
