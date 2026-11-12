import type { HistorySource } from './MetricsReader.js';

/** A machine history with no data, for tests that do not read the history */
export function noHistory(): HistorySource {
  return { windowAverages: async () => [], stateTime: async () => null, rangeIncrease: async () => null };
}
