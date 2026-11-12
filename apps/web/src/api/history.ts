import type { HistoryValue } from '@local-chatter/shared';
import { api } from './client';

/** One value of a machine at a time. `time` is in milliseconds since 1970. */
export interface HistoryPoint {
  time: number;
  value: number;
}

export interface ValueHistory {
  points: HistoryPoint[];
  /** The time that each average covers, such as "5s". The server picks it when the call gives none. */
  window: string;
}

/**
 * One value of a machine over time (for example the spindle speed), as one average for each window.
 * `range` is how far back, for example "-10m". `averageWindow` is the time that each average covers, for example "5s".
 */
export async function fetchValueHistory(
  machineId: string,
  value: HistoryValue,
  range: string,
  averageWindow?: string,
): Promise<ValueHistory> {
  const query = averageWindow ? { range, window: averageWindow } : { range };
  const response = await api.machine[':id'].history[':value'].$get({ param: { id: machineId, value }, query });
  if (!response.ok) throw new Error(`Could not load the ${value} history`);
  const body = await response.json();
  return {
    points: body.data.map(point => ({ time: Date.parse(point.time), value: point.value })),
    window: body.window,
  };
}
