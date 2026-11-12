import { Hono } from 'hono';
import type { Alert, AlertStore } from '../alerts/AlertStore.js';
import { checkedQuery } from './checks.js';
import { durationMs } from './duration.js';
import { alertQuery } from './schemas.js';

const DEFAULT_ALERT_RANGE = '-7d';
/** One reply has at most this many alerts. `more` tells that older ones were left out. */
const MAX_ALERTS = 500;

function alertReply(alert: Alert, now: number) {
  const firing = alert.endsAt > now;
  return {
    name: alert.name,
    machineId: alert.machineId ?? null,
    labels: alert.labels,
    annotations: alert.annotations,
    start: new Date(alert.startsAt).toISOString(),
    // While an alert fires, its end time is only the time until vmalert sends it again
    end: firing ? null : new Date(alert.endsAt).toISOString(),
    firing,
  };
}

/** The alerts that vmalert sent */
export function alertRoutes(alerts: AlertStore) {
  return new Hono()
    .get('/alerts', checkedQuery(alertQuery), c => {
      const { range = DEFAULT_ALERT_RANGE, state = 'all', machine } = c.req.valid('query');
      const now = Date.now();
      const found = alerts.read({
        now, machineId: machine, firingOnly: state === 'firing', endedAfter: now - durationMs(range), limit: MAX_ALERTS + 1,
      });
      return c.json({
        range,
        data: found.slice(0, MAX_ALERTS).map(alert => alertReply(alert, now)),
        more: found.length > MAX_ALERTS,
      });
    });
}
