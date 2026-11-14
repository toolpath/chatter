import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Alert, AlertStore } from '../alerts/AlertStore.js';
import { type AlertChange, AlertChangeFinder, SILENT_AFTER_MS } from './AlertChangeFinder.js';

const NOW = Date.UTC(2026, 10, 13, 9, 0);
const MINUTE_MS = 60_000;

function anAlert(values: Partial<Alert> = {}): Alert {
  return {
    name: 'SpindleLoadHigh',
    machineId: 'm1',
    labels: { alertname: 'SpindleLoadHigh', machine: 'm1', severity: 'warning' },
    annotations: { summary: 'Spindle load is 92%' },
    startsAt: NOW - MINUTE_MS,
    endsAt: NOW + MINUTE_MS,
    ...values,
  };
}

/** Keeps each change that the finder reports */
class ChangeList {
  readonly changes: AlertChange[] = [];

  alertChanged(change: AlertChange): void {
    this.changes.push(change);
  }

  kinds(): string[] {
    return this.changes.map(change => `${change.kind} ${change.alert.name}`);
  }
}

describe('AlertChangeFinder', () => {
  let db: Database.Database;
  let alerts: AlertStore;
  let found: ChangeList;
  let finder: AlertChangeFinder;

  beforeEach(() => {
    db = new Database(':memory:');
    alerts = new AlertStore(db);
    found = new ChangeList();
    finder = new AlertChangeFinder(db, found, NOW);
  });

  it('reports a new alert one time as started, also when vmalert sends it again', () => {
    alerts.save([anAlert()], NOW);
    finder.findChanges(NOW);
    alerts.save([anAlert({ endsAt: NOW + 2 * MINUTE_MS })], NOW + MINUTE_MS);
    finder.findChanges(NOW + MINUTE_MS);

    expect(found.kinds()).toEqual(['started SpindleLoadHigh']);
    expect(found.changes[0]).toMatchObject({ at: NOW - MINUTE_MS, alert: anAlert() });
    expect(found.changes[0].alertId).toEqual(expect.any(Number));
  });

  it('reports an alert one time as ended when its end time is in the past', () => {
    alerts.save([anAlert()], NOW);
    finder.findChanges(NOW);
    finder.findChanges(NOW + MINUTE_MS);
    finder.findChanges(NOW + 2 * MINUTE_MS);

    expect(found.kinds()).toEqual(['started SpindleLoadHigh', 'ended SpindleLoadHigh']);
    expect(found.changes[1]).toMatchObject({ kind: 'ended', at: NOW + MINUTE_MS, alertId: found.changes[0].alertId });
  });

  it('reports a start and an end again when vmalert sends an alert after its end time passed', () => {
    alerts.save([anAlert()], NOW);
    finder.findChanges(NOW);
    finder.findChanges(NOW + MINUTE_MS);
    alerts.save([anAlert({ endsAt: NOW + 3 * MINUTE_MS })], NOW + 2 * MINUTE_MS);
    finder.findChanges(NOW + 2 * MINUTE_MS);
    finder.findChanges(NOW + 3 * MINUTE_MS);

    expect(found.kinds()).toEqual([
      'started SpindleLoadHigh', 'ended SpindleLoadHigh', 'started SpindleLoadHigh', 'ended SpindleLoadHigh',
    ]);
    expect(found.changes.map(change => change.at)).toEqual([NOW - MINUTE_MS, NOW + MINUTE_MS, NOW - MINUTE_MS, NOW + 3 * MINUTE_MS]);
    expect(new Set(found.changes.map(change => change.alertId)).size).toBe(1);
  });

  it('does not report a firing alert as ended', () => {
    alerts.save([anAlert()], NOW);
    finder.findChanges(NOW + MINUTE_MS - 1);

    expect(found.kinds()).toEqual(['started SpindleLoadHigh']);
  });

  it('reports the start before the end of an alert that started and ended between two looks', () => {
    alerts.save([anAlert({ startsAt: NOW - 5 * MINUTE_MS, endsAt: NOW - 2 * MINUTE_MS })], NOW);
    finder.findChanges(NOW);

    expect(found.kinds()).toEqual(['started SpindleLoadHigh', 'ended SpindleLoadHigh']);
  });

  it('reports the changes of different alerts in time order', () => {
    alerts.save([
      anAlert({ name: 'Late', labels: { alertname: 'Late' }, startsAt: NOW - MINUTE_MS }),
      anAlert({ name: 'Early', labels: { alertname: 'Early' }, startsAt: NOW - 9 * MINUTE_MS, endsAt: NOW - 3 * MINUTE_MS }),
    ], NOW);
    finder.findChanges(NOW);

    expect(found.kinds()).toEqual(['started Early', 'ended Early', 'started Late']);
  });

  it('reports nothing for a change that is older than the silent limit, for example after Chatter was off', () => {
    const longAgo = NOW - SILENT_AFTER_MS - MINUTE_MS;
    alerts.save([anAlert({ startsAt: longAgo - MINUTE_MS, endsAt: longAgo })], NOW);
    finder.findChanges(NOW);
    finder.findChanges(NOW + MINUTE_MS);

    expect(found.changes).toEqual([]);
  });

  it('reports the end of a long alert, also when its start is older than the silent limit', () => {
    alerts.save([anAlert({ startsAt: NOW - 2 * SILENT_AFTER_MS, endsAt: NOW - MINUTE_MS })], NOW);
    finder.findChanges(NOW);

    expect(found.kinds()).toEqual(['ended SpindleLoadHigh']);
  });

  it('reports only the later end of the alerts that were saved before the first start of the finder', () => {
    const olderDb = new Database(':memory:');
    const olderAlerts = new AlertStore(olderDb);
    olderAlerts.save([anAlert(), anAlert({ name: 'Ended', labels: { alertname: 'Ended' }, endsAt: NOW - MINUTE_MS })], NOW);
    const afterUpdate = new ChangeList();
    const updatedFinder = new AlertChangeFinder(olderDb, afterUpdate, NOW);

    updatedFinder.findChanges(NOW);
    updatedFinder.findChanges(NOW + 2 * MINUTE_MS);

    expect(afterUpdate.kinds()).toEqual(['ended SpindleLoadHigh']);
  });

  it('marks the old alerts only at the first start, so a restart reports the new alerts', () => {
    alerts.save([anAlert()], NOW);
    const afterRestart = new ChangeList();
    new AlertChangeFinder(db, afterRestart, NOW).findChanges(NOW);

    expect(afterRestart.kinds()).toEqual(['started SpindleLoadHigh']);
  });

  it('reports the change again at the next look when the listener fails', () => {
    alerts.save([anAlert()], NOW);
    const failing = new AlertChangeFinder(db, { alertChanged: () => { throw new Error('outbox is full'); } }, NOW);
    expect(() => failing.findChanges(NOW)).toThrow('outbox is full');

    finder.findChanges(NOW);

    expect(found.kinds()).toEqual(['started SpindleLoadHigh']);
  });

  it('forgets the notes of alerts that the alert store deleted', () => {
    alerts.save([anAlert()], NOW);
    finder.findChanges(NOW);
    alerts.removeMachine('m1');
    finder.findChanges(NOW);

    expect(db.prepare('SELECT COUNT(*) AS count FROM alert_notices').get()).toEqual({ count: 0 });
  });
});
