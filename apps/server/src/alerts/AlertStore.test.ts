import { beforeEach, describe, expect, it } from 'vitest';
import { type Alert, AlertStore, KEEP_ALERTS_MS } from './AlertStore.js';

const NOW = Date.UTC(2026, 10, 9, 9, 0);
const MINUTE_MS = 60_000;

function anAlert(values: Partial<Alert> = {}): Alert {
  return {
    name: 'SpindleTooFast',
    machineId: 'm1',
    labels: { alertname: 'SpindleTooFast', machine: 'm1' },
    annotations: { summary: 'Spindle speed is 9000' },
    startsAt: NOW - MINUTE_MS,
    endsAt: NOW + MINUTE_MS,
    ...values,
  };
}

const firingAlertsQuery = { now: NOW, firingOnly: true, endedAfter: 0, limit: 100 };
const allAlertsQuery = { now: NOW, firingOnly: false, endedAfter: 0, limit: 100 };

describe('AlertStore', () => {
  let store: AlertStore;

  beforeEach(() => {
    store = AlertStore.inMemory();
  });

  it('keeps an alert that vmalert sends again as one alert, with the newest end time and text', () => {
    store.save([anAlert()], NOW);
    const newerValues = { endsAt: NOW + 2 * MINUTE_MS, annotations: { summary: 'Spindle speed is 9500' } };
    store.save([anAlert({ ...newerValues, labels: { machine: 'm1', alertname: 'SpindleTooFast' } })], NOW);

    expect(store.read(allAlertsQuery)).toEqual([anAlert(newerValues)]);
  });

  it('keeps a new start of the same alert as a second alert', () => {
    store.save([anAlert({ startsAt: NOW - 10 * MINUTE_MS, endsAt: NOW - 5 * MINUTE_MS })], NOW);
    store.save([anAlert()], NOW);

    expect(store.read(allAlertsQuery)).toHaveLength(2);
  });

  it('gives only the alerts that fire now, when asked', () => {
    store.save([anAlert({ name: 'Ended', endsAt: NOW - 1 }), anAlert({ name: 'Firing', labels: { alertname: 'Firing' } })], NOW);

    expect(store.read(firingAlertsQuery).map(found => found.name)).toEqual(['Firing']);
  });

  it('gives the alerts of one machine, when asked', () => {
    store.save([anAlert(), anAlert({ machineId: 'm2', labels: { machine: 'm2' } }), anAlert({ machineId: undefined, labels: {} })], NOW);

    expect(store.read({ ...allAlertsQuery, machineId: 'm2' }).map(found => found.machineId)).toEqual(['m2']);
  });

  it('leaves out alerts that ended before the asked time', () => {
    store.save([anAlert({ endsAt: NOW - 60 * MINUTE_MS })], NOW);

    expect(store.read({ ...allAlertsQuery, endedAfter: NOW - MINUTE_MS })).toEqual([]);
  });

  it('removes alerts that ended more than a year ago', () => {
    store.save([anAlert({ startsAt: NOW - KEEP_ALERTS_MS - 2000, endsAt: NOW - KEEP_ALERTS_MS - 1000 })], NOW);

    store.save([], NOW);

    expect(store.read(allAlertsQuery)).toEqual([]);
  });

  it('removes the alerts of a removed machine', () => {
    store.save([anAlert()], NOW);

    store.removeMachine('m1');

    expect(store.read(allAlertsQuery)).toEqual([]);
  });
});
