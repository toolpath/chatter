import { machineSelector } from './metricLines.js';

const QUERY_RANGE_PATH = '/api/v1/query_range';
const QUERY_PATH = '/api/v1/query';
const REQUEST_TIMEOUT_MS = 10_000;
const MS_PER_SECOND = 1000;
/** vmalert saves one average for each minute (see vmalert/rules.yml). Windows of whole minutes read those. */
const MINUTE_MS = 60_000;

/** The series of minute averages that vmalert saves for a metric */
export function minuteAverageName(metric: string): string {
  return `${metric}:avg1m`;
}

/** One average. `time` is the start of its window, in milliseconds since 1970 (Date.now()). */
export interface HistoryPoint {
  time: number;
  value: number;
}

export interface WindowQuery {
  /** A metric name from metricLines, for example chatter_spindle_speed */
  metric: string;
  machineId: string;
  /** The start of the first window, in milliseconds since 1970 */
  from: number;
  to: number;
  windowMs: number;
}

export interface StateTime {
  onMs: number;
  /** The minutes that have data. Chatter was not running, or the machine was not connected, in the other minutes. */
  knownMs: number;
}

export interface RangeQuery {
  metric: string;
  machineId: string;
  from: number;
  to: number;
}

/** Where the machine history is read from. Tests can give their own. */
export interface HistorySource {
  windowAverages(query: WindowQuery): Promise<HistoryPoint[]>;
  /**
   * For a state that is 1 or 0 (for example running): the time that it was on, and the time that it was known.
   * Null when the machine has no data in the range. The range must be a whole number of minutes.
   */
  stateTime(query: RangeQuery): Promise<StateTime | null>;
  /** How much a counter (for example the part count) went up in the range. A counter that starts again at 0 is counted on. */
  rangeIncrease(query: RangeQuery): Promise<number | null>;
}

interface QueryReply<Result> {
  status: 'success' | 'error';
  error?: string;
  data?: { result: Result[] };
}

/**
 * Reads the machine history from VictoriaMetrics.
 * The outer avg() or sum() of each query makes the series of a machine one series,
 * also if the machine has more than one (for example with another type label).
 */
export class MetricsReader implements HistorySource {
  private readonly queryRangeUrl: string;
  private readonly queryUrl: string;

  constructor({ url }: { url: string }) {
    this.queryRangeUrl = new URL(QUERY_RANGE_PATH, url).href;
    this.queryUrl = new URL(QUERY_PATH, url).href;
  }

  /**
   * The average value in each window from `from` to `to`. A window with no data is left out.
   * A VictoriaMetrics point at time t covers the window that ends at t, so the query asks for
   * the window ends and each answer moves back by one window.
   * A window of whole minutes reads the minute averages, which is much faster for a long range.
   * The newest minute average comes about 1 minute late, so the live values from the web app fill that gap.
   */
  async windowAverages({ metric, machineId, from, to, windowMs }: WindowQuery): Promise<HistoryPoint[]> {
    const windowCount = Math.max(1, Math.ceil((to - from) / windowMs));
    const params = new URLSearchParams({
      query: `avg(avg_over_time(${averageSeries(metric, windowMs)}${machineSelector(machineId)}[${windowMs}ms]))`,
      start: toSeconds(from + windowMs),
      end: toSeconds(from + windowCount * windowMs),
      step: toSeconds(windowMs),
    });
    const values = await this.queryRange(params);
    return values
      .map(([seconds, value]) => ({ time: seconds * MS_PER_SECOND - windowMs, value: Number(value) }))
      .filter(point => Number.isFinite(point.value));
  }

  /**
   * Each minute average of a 1-or-0 state is the part of that minute that it was on, so their sum is minutes on.
   * The window is (from, to]: VictoriaMetrics v1.155 leaves out a point at `from`, so a range of N minutes counts N minutes.
   */
  async stateTime({ metric, machineId, from, to }: RangeQuery): Promise<StateTime | null> {
    const rangeMs = to - from;
    if (rangeMs % MINUTE_MS !== 0) throw new Error('The range must be a whole number of minutes');
    const series = `${minuteAverageName(metric)}${machineSelector(machineId)}[${rangeMs}ms]`;
    const [onMinutes, knownMinutes] = await Promise.all([
      this.queryOne(`sum(sum_over_time(${series}))`, to),
      this.queryOne(`sum(count_over_time(${series}))`, to),
    ]);
    if (onMinutes === null || knownMinutes === null) return null;
    return { onMs: onMinutes * MINUTE_MS, knownMs: knownMinutes * MINUTE_MS };
  }

  /*
   * increase() guesses where a counter that starts in the range began, and it guessed 77 for 1 day but 97 for 1 hour
   * on the same data. increase_prometheus() counts from the first saved value. Both count on after a reset to 0.
   * The raw values are used, because an average hides a reset.
   */
  async rangeIncrease({ metric, machineId, from, to }: RangeQuery): Promise<number | null> {
    return this.queryOne(`sum(increase_prometheus(${metric}${machineSelector(machineId)}[${to - from}ms]))`, to);
  }

  /** The values of the series. The query makes at most one. */
  private async queryRange(params: URLSearchParams): Promise<[number, string][]> {
    const result = await this.fetchResult<{ values: [number, string][] }>(this.queryRangeUrl, params);
    return result[0]?.values ?? [];
  }

  /** The one value of the query at the time, or null when there is none */
  private async queryOne(query: string, time: number): Promise<number | null> {
    const params = new URLSearchParams({ query, time: toSeconds(time) });
    const result = await this.fetchResult<{ value: [number, string] }>(this.queryUrl, params);
    const value = Number(result[0]?.value[1]);
    return result.length > 0 && Number.isFinite(value) ? value : null;
  }

  /** The result list of a query. It throws when VictoriaMetrics refuses the query. */
  private async fetchResult<Result>(url: string, params: URLSearchParams): Promise<Result[]> {
    const response = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const reply = await response.json() as QueryReply<Result>;
    if (!response.ok || reply.status !== 'success') {
      throw new Error(`VictoriaMetrics answered ${response.status}: ${reply.error ?? 'no reason given'}`);
    }
    return reply.data?.result ?? [];
  }
}

/**
 * The series to average over windows. Windows of whole minutes read the minute averages, which is much faster.
 * A window such as 90s would get 1 or 2 minute averages, so only whole minutes use them.
 */
function averageSeries(metric: string, windowMs: number): string {
  return windowMs % MINUTE_MS === 0 ? minuteAverageName(metric) : metric;
}

/** VictoriaMetrics takes times and steps in seconds */
function toSeconds(ms: number): string {
  return String(ms / MS_PER_SECOND);
}
