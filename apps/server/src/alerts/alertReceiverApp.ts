import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { checkedJson } from '../routes/checks.js';
import type { Alert, AlertStore } from './AlertStore.js';

/** vmalert sends the alerts of one rule group in one request. More than this is not from vmalert. */
export const MAX_ALERTS_PER_REQUEST = 1000;
const MAX_BODY_BYTES = 1024 * 1024;
/**
 * vmalert sets the end time of a firing alert a few evaluations ahead (about 1 minute), and sends the alert again before it.
 * A later end time is kept at this much ahead, so an alert that vmalert stops sending does not fire forever.
 */
export const MAX_FIRING_AHEAD_MS = 60 * 60_000;

const timeText = z.string().refine(text => !Number.isNaN(Date.parse(text)), 'startsAt and endsAt must be times');

/** One alert as vmalert sends it (the Alertmanager API v2 format) */
const sentAlert = z.object({
  labels: z.record(z.string(), z.string()).refine(labels => labels.alertname, 'Each alert needs an alertname label'),
  annotations: z.record(z.string(), z.string()).optional(),
  startsAt: timeText,
  endsAt: timeText,
});

const sentAlerts = z.array(sentAlert, { error: 'The body must be a list of alerts' })
  .max(MAX_ALERTS_PER_REQUEST, `Send ${MAX_ALERTS_PER_REQUEST} alerts or fewer`);

export interface ReceiverOptions {
  /** vmalert can send the alerts of a removed machine for a short time. They are left out. */
  isKnownMachine: (machineId: string) => boolean;
  /** Runs after each save, for example to send the notifications of the new alerts */
  afterSave?: () => void;
  now?: () => number;
}

/**
 * The receiver for the alerts of vmalert. It has no login, so it must listen on a separate port that only vmalert can reach.
 * vmalert thinks that it talks to an Alertmanager: it sends POST /api/v2/alerts.
 */
export function alertReceiverApp(store: AlertStore, { isKnownMachine, afterSave = () => {}, now = Date.now }: ReceiverOptions) {
  return new Hono().post(
    '/api/v2/alerts',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: c => c.json({ error: 'The body is too large' }, 413) }),
    checkedJson(sentAlerts),
    c => {
      const receivedAt = now();
      const isAboutKnownMachineOrNone = (alert: Alert) => alert.machineId === undefined || isKnownMachine(alert.machineId);
      const alerts = c.req.valid('json')
        .map(sent => toAlert(sent, receivedAt))
        .filter(isAboutKnownMachineOrNone);
      store.save(alerts, receivedAt);
      afterSave();
      return c.json({});
    },
  );
}

function toAlert({ labels, annotations, startsAt, endsAt }: z.output<typeof sentAlert>, receivedAt: number): Alert {
  return {
    name: labels.alertname,
    machineId: labels.machine,
    labels,
    annotations: annotations ?? {},
    startsAt: Date.parse(startsAt),
    endsAt: Math.min(Date.parse(endsAt), receivedAt + MAX_FIRING_AHEAD_MS),
  };
}
