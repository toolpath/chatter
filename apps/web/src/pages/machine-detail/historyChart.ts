import type { HistoryPoint } from '../../api/history';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UNIT_MS: Record<string, number> = { s: 1000, m: MINUTE, h: HOUR, d: DAY, w: 7 * DAY };

/** "5m" or "-1h" in milliseconds */
export function durationMs(text: string): number {
  const match = /^-?(\d+)([smhdw])$/.exec(text);
  if (!match) throw new Error(`Not a duration: ${text}`);
  return Number(match[1]) * UNIT_MS[match[2]];
}

export interface ChartRange {
  id: '10m' | '1h' | '24h' | '7d';
  /** The words after "in the last" */
  words: string;
  ms: number;
  /** The range the server wants, such as "-1h" */
  query: string;
  /** The time each average covers. Without one, the server picks it, at most 1000 points. */
  window?: string;
}

/** The time ranges the chart offers. The server keeps every value 30 days, and minute averages 1 year. */
export const CHART_RANGES: ChartRange[] = [
  { id: '10m', words: '10 minutes', ms: 10 * MINUTE, query: '-10m', window: '5s' },
  { id: '1h', words: 'hour', ms: HOUR, query: '-1h' },
  { id: '24h', words: '24 hours', ms: DAY, query: '-24h' },
  { id: '7d', words: '7 days', ms: 7 * DAY, query: '-7d' },
];

/** The chart shows the last 10 minutes at first */
export const CHART_RANGE_MS = CHART_RANGES[0].ms;
/** Points that are further apart than this have no data between them, so the line has a gap there */
export const GAP_MS = 15_000;

/** The gap for averages of `windowMs`: three missing averages in a row */
export function gapFor(windowMs: number): number {
  return Math.max(GAP_MS, 3 * windowMs);
}

/**
 * Add the newest live value, when it is newer than the last point.
 * The chart keeps one point for each window of `windowMs`, so a page that stays open does not collect
 * more points than the chart can show. A value in the same window as the last point takes its place.
 * A `windowMs` of 0 keeps every value.
 * The windows are fixed, so the last point cannot slide forward with each value and leave a gap behind it.
 */
export function withLivePoint(points: HistoryPoint[], live: HistoryPoint, windowMs = 0): HistoryPoint[] {
  const last = points[points.length - 1];
  if (!last) return [live];
  if (live.time <= last.time) return points;
  if (windowMs > 0 && windowOf(live.time, windowMs) === windowOf(last.time, windowMs)) {
    return [...points.slice(0, -1), live];
  }
  return [...points, live];
}

function windowOf(time: number, windowMs: number): number {
  return Math.floor(time / windowMs);
}

/** The loaded history, then the live values that came after it (they can arrive while it loads) */
export function mergeHistory(history: HistoryPoint[], live: HistoryPoint[]): HistoryPoint[] {
  const historyEnd = history[history.length - 1]?.time ?? -Infinity;
  return [...history, ...live.filter(point => point.time > historyEnd)];
}

export function recentPoints(points: HistoryPoint[], now: number, rangeMs = CHART_RANGE_MS): HistoryPoint[] {
  return points.filter(point => point.time >= now - rangeMs);
}

/**
 * The parts of the line: a new part starts after each gap.
 * When the machine is connected, the last value holds until now, so the line reaches the right edge.
 */
export function lineParts(points: HistoryPoint[], now: number, connected: boolean, gapMs = GAP_MS): HistoryPoint[][] {
  const parts: HistoryPoint[][] = [];
  points.forEach((point, index) => {
    const startsNewPart = index === 0 || point.time - points[index - 1].time > gapMs;
    if (startsNewPart) parts.push([point]);
    else parts[parts.length - 1].push(point);
  });

  const last = points[points.length - 1];
  if (connected && last && now - last.time <= gapMs && now > last.time) {
    parts[parts.length - 1].push({ time: now, value: last.value });
  }
  return parts;
}

/**
 * Round numbers for the value axis, from 0 to just above the biggest value.
 * The axis goes at least to `smallestTop`. A `smallestTop` of 20 or more keeps the steps whole numbers.
 */
export function axisTicks(maxValue: number, smallestTop = 100, stepCount = 4): number[] {
  const top = Math.max(maxValue, smallestTop);
  const roughStep = top / stepCount;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= roughStep)!;
  const tickCount = Math.ceil(top / step);
  return Array.from({ length: tickCount + 1 }, (_, index) => index * step);
}

/** The point nearest to `time`, for the hover readout */
export function nearestPoint(points: HistoryPoint[], time: number): HistoryPoint | undefined {
  let nearest: HistoryPoint | undefined;
  for (const point of points) {
    if (!nearest || Math.abs(point.time - time) < Math.abs(nearest.time - time)) nearest = point;
  }
  return nearest;
}

/** 8000 → "8,000". Axis labels from 10,000 up are short: 12500 → "12.5K". */
export function formatChartNumber(value: number, short = false): string {
  if (short && value >= 10_000) return `${Number((value / 1000).toFixed(1))}K`;
  return Math.round(value).toLocaleString('en-US');
}

export interface TimeLabel {
  time: number;
  text: string;
}

function clockText(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function dayText(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

/** Five labels under the chart, from the start of the range to "Now" */
export function timeLabels(rangeMs: number, now: number): TimeLabel[] {
  const format = rangeMs > DAY ? dayText : clockText;
  return [4, 3, 2, 1, 0].map(quarter => {
    const time = now - (rangeMs * quarter) / 4;
    return { time, text: quarter === 0 ? 'Now' : format(time) };
  });
}
