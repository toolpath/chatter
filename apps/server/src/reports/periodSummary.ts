import type { StatePeriod } from '../recording/StatePeriodStore.js';

export interface ValueSummary {
  value: string;
  count: number;
  totalMs: number;
}

export interface PeriodSummary {
  count: number;
  totalMs: number;
  /** The values with the most time, the longest first */
  values: ValueSummary[];
}

const DEFAULT_TOP_VALUES = 10;

/**
 * How often each value came, and for how long, from `from` to `to`.
 * Only the part of a period inside the range counts. A period that still runs counts up to `to`.
 */
export function summarizePeriods(periods: StatePeriod[], from: number, to: number, topValues = DEFAULT_TOP_VALUES): PeriodSummary {
  const longestFirst = summarizeEachValue(periods, from, to).sort((a, b) => b.totalMs - a.totalMs);
  return {
    count: periods.length,
    totalMs: longestFirst.reduce((total, summary) => total + summary.totalMs, 0),
    values: longestFirst.slice(0, topValues),
  };
}

function summarizeEachValue(periods: StatePeriod[], from: number, to: number): ValueSummary[] {
  const summaryByValue = new Map<string, ValueSummary>();
  for (const period of periods) {
    const summary = summaryByValue.get(period.value) ?? { value: period.value, count: 0, totalMs: 0 };
    summary.count += 1;
    summary.totalMs += timeInRange(period, from, to);
    summaryByValue.set(period.value, summary);
  }
  return [...summaryByValue.values()];
}

function timeInRange(period: StatePeriod, from: number, to: number): number {
  const end = Math.min(period.end ?? to, to);
  const start = Math.max(period.start, from);
  return Math.max(0, end - start);
}
