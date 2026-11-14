import { beforeEach, describe, expect, it } from 'vitest';
import { AlertStore } from './AlertStore.js';
import { alertReceiverApp, MAX_ALERTS_PER_REQUEST, MAX_FIRING_AHEAD_MS } from './alertReceiverApp.js';

const NOW = Date.UTC(2026, 10, 9, 17, 51);

/** The body that vmalert sends, as captured from vmalert v1.155.0 */
const vmalertBody = [{
  startsAt: '2026-11-09T17:50:20Z',
  endsAt: '2026-11-09T17:51:11.65Z',
  generatorURL: 'http://vmalert:8880/vmalert/alert?group_id=1&alert_id=2',
  labels: { alertgroup: 'capture', alertname: 'SpindleTooFast', machine: 'brother_1', severity: 'warning', type: 'brother' },
  annotations: { summary: 'Spindle speed is 14998' },
}];
const vmalertAlert = vmalertBody[0];

/** More than the 1 MB body limit of the receiver */
const TOO_LARGE_TEXT_LENGTH = 2_000_000;

const allAlertsQuery = { now: NOW, firingOnly: false, endedAfter: 0, limit: 100 };

describe('alertReceiverApp', () => {
  let store: AlertStore;
  let app: ReturnType<typeof alertReceiverApp>;

  const send = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/api/v2/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  beforeEach(() => {
    store = AlertStore.inMemory();
    app = alertReceiverApp(store, { isKnownMachine: id => id !== 'removed', now: () => NOW });
  });

  it('saves the alerts that vmalert sends', async () => {
    const response = await send(vmalertBody);

    expect(response.status).toBe(200);
    expect(store.read(allAlertsQuery)).toEqual([{
      name: 'SpindleTooFast',
      machineId: 'brother_1',
      labels: vmalertAlert.labels,
      annotations: { summary: 'Spindle speed is 14998' },
      startsAt: Date.parse('2026-11-09T17:50:20Z'),
      endsAt: Date.parse('2026-11-09T17:51:11.65Z'),
    }]);
  });

  it('tells the listener after it saved the alerts, so the notifications can find the changes', async () => {
    let savedCount = -1;
    app = alertReceiverApp(store, {
      isKnownMachine: () => true, now: () => NOW, afterSave: () => { savedCount = store.read(allAlertsQuery).length; },
    });

    await send(vmalertBody);

    expect(savedCount).toBe(1);
  });

  it('accepts an alert with no annotations and no machine', async () => {
    await send([{ startsAt: '2026-11-09T17:50:20Z', endsAt: '2026-11-09T17:51:00Z', labels: { alertname: 'NoMachine' } }]);

    expect(store.read(allAlertsQuery)).toMatchObject([{ name: 'NoMachine', machineId: undefined, annotations: {} }]);
  });

  it.each([
    ['not a list', { alerts: [] }],
    ['no alert name', [{ ...vmalertAlert, labels: { machine: 'm1' } }]],
    ['a start time that is not a time', [{ ...vmalertAlert, startsAt: 'yesterday' }]],
    ['a label that is not text', [{ ...vmalertAlert, labels: { alertname: 'A', level: 3 } }]],
  ])('refuses a body with %s, and saves nothing', async (_name, body) => {
    const response = await send(body);

    expect(response.status).toBe(400);
    expect(store.read(allAlertsQuery)).toEqual([]);
  });

  it('leaves out the alerts of a removed machine, because vmalert can still send them for a short time', async () => {
    const response = await send([{ ...vmalertAlert, labels: { alertname: 'A', machine: 'removed' } }, vmalertAlert]);

    expect(response.status).toBe(200);
    expect(store.read(allAlertsQuery).map(found => found.machineId)).toEqual(['brother_1']);
  });

  it('keeps an end time far in the future at most a short time ahead, so the alert cannot stay forever', async () => {
    await send([{ ...vmalertAlert, endsAt: '2099-01-01T00:00:00Z' }]);

    expect(store.read(allAlertsQuery)[0].endsAt).toBe(NOW + MAX_FIRING_AHEAD_MS);
  });

  it('refuses a body that is not JSON', async () => {
    expect((await send('{not json')).status).toBe(400);
  });

  it('refuses too many alerts in one request', async () => {
    const response = await send(Array.from({ length: MAX_ALERTS_PER_REQUEST + 1 }, () => vmalertAlert));

    expect(response.status).toBe(400);
  });

  it('refuses a body that is too large', async () => {
    const response = await send([{ ...vmalertAlert, annotations: { summary: 'x'.repeat(TOO_LARGE_TEXT_LENGTH) } }]);

    expect(response.status).toBe(413);
    expect(store.read(allAlertsQuery)).toEqual([]);
  });

  it('has no other routes', async () => {
    expect((await app.request('/api/machines')).status).toBe(404);
  });
});
