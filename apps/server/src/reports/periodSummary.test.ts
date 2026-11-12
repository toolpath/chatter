import { describe, expect, it } from 'vitest';
import type { StatePeriod } from '../recording/StatePeriodStore.js';
import { summarizePeriods } from './periodSummary.js';

const FROM = Date.UTC(2026, 10, 9, 0, 0);
const ONE_HOUR_MS = 3_600_000;
const TO = FROM + ONE_HOUR_MS;

function alarm(value: string, start: number, end?: number): StatePeriod {
  return { kind: 'alarm', value, start, end };
}

describe('summarizePeriods', () => {
  it('counts the periods and adds their times, for each value, the longest first', () => {
    const summary = summarizePeriods([
      alarm('1001 DOOR OPEN', FROM + 1000, FROM + 61_000),
      alarm('2002 LOW AIR', FROM + 100_000, FROM + 400_000),
      alarm('1001 DOOR OPEN', FROM + 500_000, FROM + 530_000),
    ], FROM, TO);

    expect(summary).toEqual({
      count: 3,
      totalMs: 390_000,
      values: [
        { value: '2002 LOW AIR', count: 1, totalMs: 300_000 },
        { value: '1001 DOOR OPEN', count: 2, totalMs: 90_000 },
      ],
    });
  });

  it('counts only the part of a period that is in the range', () => {
    const summary = summarizePeriods([
      alarm('A', FROM - 60_000, FROM + 60_000),
      alarm('B', TO - 30_000, TO + 60_000),
    ], FROM, TO);

    expect(summary.totalMs).toBe(90_000);
  });

  it('counts a period that still runs up to the end of the range', () => {
    expect(summarizePeriods([alarm('A', TO - 10_000)], FROM, TO).totalMs).toBe(10_000);
  });

  it('keeps only the values with the most time', () => {
    const periods = Array.from({ length: 15 }, (_, index) => alarm(`A${index}`, FROM, FROM + (index + 1) * 1000));

    const summary = summarizePeriods(periods, FROM, TO, 3);

    expect(summary.values.map(valueSummary => valueSummary.value)).toEqual(['A14', 'A13', 'A12']);
    expect(summary.count).toBe(15);
  });

  it('gives zero for no periods', () => {
    expect(summarizePeriods([], FROM, TO)).toEqual({ count: 0, totalMs: 0, values: [] });
  });
});
