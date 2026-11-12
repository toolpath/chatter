import { Hono } from 'hono';
import type { HardwarePoller } from '../polling/poller.js';
import type { HistorySource } from '../recording/MetricsReader.js';
import { historyMetricName } from '../recording/metricLines.js';
import type { StatePeriod, StatePeriodStore } from '../recording/StatePeriodStore.js';
import { checkedParam, checkedQuery } from './checks.js';
import { durationMs } from './duration.js';
import { historyUnavailable, notFound } from './responses.js';
import { historyParams, historyQuery, periodQuery } from './schemas.js';

const DEFAULT_PERIOD_RANGE = '-1d';
const DEFAULT_HISTORY_RANGE = '-1h';
/** One reply has at most this many points, so a big range cannot make a huge reply */
const MAX_POINTS = 5000;
/** One reply has at most this many state periods. `more` tells that older ones were left out. */
const MAX_PERIODS = 1000;

/** Without a window, use the smallest of these that keeps the reply within the point limit below */
const AUTO_WINDOWS = ['10s', '30s', '1m', '5m', '15m', '1h', '6h', '1d'];
const AUTO_WINDOW_MAX_POINTS = 1000;

function autoWindow(rangeMs: number): string {
  const fits = (window: string) => rangeMs / durationMs(window) <= AUTO_WINDOW_MAX_POINTS;
  return AUTO_WINDOWS.find(fits) ?? AUTO_WINDOWS[AUTO_WINDOWS.length - 1];
}

/** Windows start at whole multiples of the window, so the points stay the same when the chart reloads */
function alignedWindowStart(time: number, windowMs: number): number {
  return Math.floor(time / windowMs) * windowMs;
}

function periodReply(period: StatePeriod) {
  return {
    kind: period.kind,
    value: period.value,
    start: new Date(period.start).toISOString(),
    end: period.end === undefined ? null : new Date(period.end).toISOString(),
  };
}

/** Machine values over time: numbers from VictoriaMetrics, and state periods from SQLite */
export function historyRoutes(poller: HardwarePoller, history: HistorySource, periods: StatePeriodStore) {
  return new Hono()
    .get('/machine/:id/periods', checkedQuery(periodQuery), c => {
      const machineId = c.req.param('id');
      if (!poller.getMachine(machineId)) return notFound(c);

      const { range = DEFAULT_PERIOD_RANGE, kind } = c.req.valid('query');
      const to = Date.now();
      const found = periods.read({ machineId, from: to - durationMs(range), to, kind, limit: MAX_PERIODS + 1 });
      return c.json({
        machineId,
        range,
        data: found.slice(0, MAX_PERIODS).map(periodReply),
        more: found.length > MAX_PERIODS,
      });
    })
    .get('/machine/:id/history/:value', checkedParam(historyParams), checkedQuery(historyQuery), async c => {
      const { id: machineId, value } = c.req.valid('param');
      if (!poller.getMachine(machineId)) return notFound(c);

      const query = c.req.valid('query');
      const range = query.range ?? DEFAULT_HISTORY_RANGE;
      const rangeMs = durationMs(range);
      const window = query.window ?? autoWindow(rangeMs);
      const windowMs = durationMs(window);
      // The first window starts before the range (at a whole multiple of the window), so a reply can have one more point
      if (rangeMs / windowMs + 1 > MAX_POINTS) {
        const problem = query.window ? 'The window is too small for this range' : 'The range is too long';
        return c.json({ error: `${problem}. One reply can have at most ${MAX_POINTS} points.` }, 400);
      }

      const to = Date.now();
      const from = alignedWindowStart(to - rangeMs, windowMs);
      let points;
      try {
        points = await history.windowAverages({ metric: historyMetricName(value), machineId, from, to, windowMs });
      } catch (error) {
        return historyUnavailable(c, '[History]', error);
      }
      const data = points.map(point => ({ time: new Date(point.time).toISOString(), value: point.value }));
      return c.json({ machineId, value, range, window, data });
    });
}
