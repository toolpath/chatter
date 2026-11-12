import type { HistoryValue } from '@local-chatter/shared';
import { Hono } from 'hono';
import type { HardwarePoller } from '../polling/poller.js';
import type { HistorySource } from '../recording/MetricsReader.js';
import { historyMetricName } from '../recording/metricLines.js';
import type { StatePeriodStore } from '../recording/StatePeriodStore.js';
import { summarizePeriods } from '../reports/periodSummary.js';
import { checkedQuery } from './checks.js';
import { durationMs, MINUTE_MS } from './duration.js';
import { historyUnavailable, notFound } from './responses.js';
import { reportQuery } from './schemas.js';

const DEFAULT_REPORT_RANGE = '-1d';
/** More alarms than this in one range is a broken machine. The summary then counts only the newest ones. */
const MAX_ALARM_PERIODS = 10_000;

interface ReportSpan {
  machineId: string;
  from: number;
  to: number;
}

/** vmalert saves the average of a minute up to 1 minute after that minute ends, so the range ends one whole minute ago */
function endOfLastSavedMinute(now: number): number {
  return Math.floor(now / MINUTE_MS) * MINUTE_MS - MINUTE_MS;
}

/** The numbers from VictoriaMetrics: the time connected, the time running, and the parts made */
async function readMachineNumbers(history: HistorySource, span: ReportSpan) {
  const queryFor = (value: HistoryValue) => ({ metric: historyMetricName(value), ...span });
  const [connected, running, partsMade] = await Promise.all([
    history.stateTime(queryFor('connected')),
    history.stateTime(queryFor('running')),
    history.rangeIncrease(queryFor('part-count')),
  ]);
  return { connected, running, partsMade };
}

/** A summary of one machine over a range: the time it was online and running, the parts it made, and its alarms */
export function reportRoutes(poller: HardwarePoller, history: HistorySource, periods: StatePeriodStore) {
  return new Hono()
    .get('/machine/:id/report', checkedQuery(reportQuery), async c => {
      const machineId = c.req.param('id');
      if (!poller.getMachine(machineId)) return notFound(c);

      const { range = DEFAULT_REPORT_RANGE } = c.req.valid('query');
      const to = endOfLastSavedMinute(Date.now());
      const from = to - durationMs(range);
      let numbers;
      try {
        numbers = await readMachineNumbers(history, { machineId, from, to });
      } catch (error) {
        return historyUnavailable(c, '[Reports]', error);
      }
      const { connected, running, partsMade } = numbers;
      const alarmPeriods = periods.read({ machineId, from, to, kind: 'alarm', limit: MAX_ALARM_PERIODS });
      return c.json({
        machineId,
        range,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        // The time that Chatter watched the machine. Chatter was not running in the rest of the range.
        watchedMs: connected?.knownMs ?? null,
        onlineMs: connected?.onMs ?? null,
        // Only FANUC and MTConnect machines tell if a program runs
        runningMs: running?.onMs ?? null,
        partsMade,
        alarms: summarizePeriods(alarmPeriods, from, to),
      });
    });
}
