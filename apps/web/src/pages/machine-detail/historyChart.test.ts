import { describe, expect, it } from 'vitest';
import {
  axisTicks,
  CHART_RANGE_MS,
  durationMs,
  formatChartNumber,
  GAP_MS,
  gapFor,
  lineParts,
  mergeHistory,
  nearestPoint,
  recentPoints,
  timeLabels,
  withLivePoint,
} from './historyChart';

const point = (time: number, value: number) => ({ time, value });

describe('withLivePoint', () => {
  it('adds a newer live value', () => {
    expect(withLivePoint([point(1000, 5)], point(3000, 6))).toEqual([point(1000, 5), point(3000, 6)]);
  });

  it('does not add a value that is not newer', () => {
    const points = [point(3000, 5)];

    expect(withLivePoint(points, point(3000, 6))).toBe(points);
  });
});

describe('mergeHistory', () => {
  it('keeps the live values that came after the history', () => {
    const history = [point(0, 1), point(5000, 2)];
    const live = [point(4000, 9), point(7000, 3)];

    expect(mergeHistory(history, live)).toEqual([point(0, 1), point(5000, 2), point(7000, 3)]);
  });
});

describe('recentPoints', () => {
  it('keeps only the points of the last 10 minutes', () => {
    const now = CHART_RANGE_MS + 5000;

    expect(recentPoints([point(0, 1), point(5000, 2), point(now, 3)], now)).toEqual([point(5000, 2), point(now, 3)]);
  });
});

describe('lineParts', () => {
  it('starts a new part after a gap with no data', () => {
    const points = [point(0, 1), point(5000, 2), point(5000 + GAP_MS + 1, 3)];

    expect(lineParts(points, 0, false)).toEqual([[point(0, 1), point(5000, 2)], [point(5000 + GAP_MS + 1, 3)]]);
  });

  it('holds the last value until now while the machine is connected', () => {
    expect(lineParts([point(0, 8000)], 4000, true)).toEqual([[point(0, 8000), point(4000, 8000)]]);
  });

  it('does not hold the last value when the machine is not connected or the value is old', () => {
    expect(lineParts([point(0, 8000)], 4000, false)).toEqual([[point(0, 8000)]]);
    expect(lineParts([point(0, 8000)], GAP_MS + 1, true)).toEqual([[point(0, 8000)]]);
  });
});

describe('axisTicks', () => {
  it('gives round steps from 0 to just above the biggest value', () => {
    expect(axisTicks(8000)).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(axisTicks(8100)).toEqual([0, 2500, 5000, 7500, 10_000]);
  });

  it('still gives a scale when every value is 0', () => {
    expect(axisTicks(0)).toEqual([0, 25, 50, 75, 100]);
  });

  it('goes at least to the smallest top, in whole steps', () => {
    expect(axisTicks(3, 20)).toEqual([0, 5, 10, 15, 20]);
  });
});

describe('nearestPoint', () => {
  it('finds the point nearest to a time', () => {
    expect(nearestPoint([point(0, 1), point(10_000, 2)], 6000)).toEqual(point(10_000, 2));
  });

  it('finds nothing in no points', () => {
    expect(nearestPoint([], 6000)).toBeUndefined();
  });
});

describe('formatChartNumber', () => {
  it('rounds and adds commas', () => {
    expect(formatChartNumber(8000.4)).toBe('8,000');
  });

  it('makes big axis labels short', () => {
    expect(formatChartNumber(12_500, true)).toBe('12.5K');
    expect(formatChartNumber(10_000, true)).toBe('10K');
    expect(formatChartNumber(7500, true)).toBe('7,500');
  });
});

describe('durationMs', () => {
  it('reads "5s", "-1h" and "7d"', () => {
    expect(durationMs('5s')).toBe(5_000);
    expect(durationMs('-1h')).toBe(3_600_000);
    expect(durationMs('7d')).toBe(7 * 86_400_000);
  });

  it('stops on text that is not a duration', () => {
    expect(() => durationMs('1 hour')).toThrow('Not a duration');
  });
});

describe('gapFor', () => {
  it('is three averages long, but never less than 15 seconds', () => {
    expect(gapFor(1_000)).toBe(15_000);
    expect(gapFor(60_000)).toBe(180_000);
  });
});

describe('timeLabels', () => {
  it('gives five labels from the start of the range to "Now"', () => {
    const now = Date.parse('2026-11-06T12:00:00.000Z');
    const labels = timeLabels(3_600_000, now);
    expect(labels.map(label => label.time)).toEqual([0, 1, 2, 3, 4].map(step => now - 3_600_000 + step * 900_000));
    expect(labels[4].text).toBe('Now');
  });

  it('shows the day, not the clock, for a range longer than one day', () => {
    const now = Date.parse('2026-11-06T12:00:00.000Z');
    const [first] = timeLabels(7 * 86_400_000, now);
    expect(first.text).toBe(new Date(now - 7 * 86_400_000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }));
  });
});

describe('withLivePoint windows', () => {
  it('replaces the last point when the live value is in the same window, and adds it in a new window', () => {
    const points = [point(0, 100), point(10_000, 200)];
    expect(withLivePoint(points, point(12_000, 300), 5_000)).toEqual([point(0, 100), point(12_000, 300)]);
    expect(withLivePoint(points, point(16_000, 300), 5_000)).toEqual([...points, point(16_000, 300)]);
  });

  it('starts a list with the live value', () => {
    expect(withLivePoint([], point(1, 5), 5_000)).toEqual([point(1, 5)]);
  });

  it('keeps the newest value of each window when the machine is read more often than the window', () => {
    // Chatter reads a machine every 2 s, and the 10 minute chart keeps one point every 5 s
    let points = [point(0, 100)];
    for (let time = 2_000; time <= 20_000; time += 2_000) points = withLivePoint(points, point(time, time), 5_000);

    expect(points.map(kept => kept.time)).toEqual([4_000, 8_000, 14_000, 18_000, 20_000]);
    // The line has no gap: all the points are in one part
    expect(lineParts(points, 20_000, true, gapFor(5_000))).toHaveLength(1);
  });

  it('keeps every value when the window is 0', () => {
    expect(withLivePoint([point(0, 1)], point(1, 2), 0)).toEqual([point(0, 1), point(1, 2)]);
  });
});
