import type { NotificationChannel } from '@local-chatter/shared';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Alert } from '../alerts/AlertStore.js';
import type { AlertChange } from './AlertChangeFinder.js';
import { AlertNotifier } from './AlertNotifier.js';
import { Outbox } from './Outbox.js';
import { moreAlertsMessage } from './outgoingMessages.js';

const NOW = Date.UTC(2026, 10, 13, 15, 2);
const OPTIONS = { timeZone: 'America/Chicago', linkBaseUrl: null };

function anAlert(values: Partial<Alert> = {}): Alert {
  return {
    name: 'In alarm', machineId: 'haas-vf2', labels: { alertname: 'In alarm', machine: 'haas-vf2', severity: 'critical' },
    annotations: {}, startsAt: NOW, endsAt: NOW + 60_000, ...values,
  };
}

function channel(id: string, values: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id, type: 'webhook', name: id, settings: {}, hasSecret: {}, minSeverity: 'warning', machineIds: null, enabled: true,
    createdAt: '2026-11-13T09:00:00.000Z', ...values,
  };
}

function change(kind: 'started' | 'ended', alert = anAlert(), alertId = 1): AlertChange {
  return { kind, alertId, alert, at: kind === 'started' ? alert.startsAt : alert.endsAt };
}

describe('AlertNotifier', () => {
  let outbox: Outbox;
  let channels: NotificationChannel[];
  let notifier: AlertNotifier;

  beforeEach(() => {
    outbox = new Outbox(new Database(':memory:'), count => moreAlertsMessage(count, OPTIONS));
    channels = [];
    notifier = new AlertNotifier({
      channels: { list: () => channels },
      outbox,
      machineName: id => (id === 'haas-vf2' ? 'Haas VF-2' : null),
      textOptions: () => OPTIONS,
      now: () => NOW,
    });
  });

  function queued(): string[] {
    return outbox.list({}).reverse().map(message => `${message.channelId} ${message.kind}: ${message.text}`);
  }

  it('queues a start message for each channel that wants the alert', () => {
    channels = [channel('phones'), channel('slack')];

    notifier.alertChanged(change('started'));

    expect(queued()).toEqual([
      'phones started: CRITICAL - Haas VF-2: In alarm. Started 9:02 AM.',
      'slack started: CRITICAL - Haas VF-2: In alarm. Started 9:02 AM.',
    ]);
    expect(outbox.list({})[0]).toMatchObject({ alertId: 1, machineId: 'haas-vf2', severity: 'critical' });
  });

  it('sends nothing to a channel that is off, that wants a higher level, or that wants other machines', () => {
    channels = [
      channel('off', { enabled: false }),
      channel('critical-only', { minSeverity: 'critical' }),
      channel('other-machine', { machineIds: ['haas-st10'] }),
    ];

    notifier.alertChanged(change('started', anAlert({ labels: { alertname: 'In alarm', severity: 'warning' } })));

    expect(queued()).toEqual([]);
  });

  it('turns a start message that still waits into one combined message when the alert ends', () => {
    channels = [channel('phones')];

    notifier.alertChanged(change('started'));
    notifier.alertChanged(change('ended'));

    expect(queued()).toEqual(['phones combined: CRITICAL - Haas VF-2: In alarm started 9:02 AM and ended 9:03 AM.']);
  });

  it('queues an end message when the start message already went', () => {
    channels = [channel('phones')];
    notifier.alertChanged(change('started'));
    const [start] = outbox.takeDue(NOW);
    outbox.markSent(start.id, 'Sent', NOW);

    notifier.alertChanged(change('ended'));

    expect(queued()).toEqual([
      'phones started: CRITICAL - Haas VF-2: In alarm. Started 9:02 AM.',
      'phones ended: OK - Haas VF-2: In alarm ended at 9:03 AM.',
    ]);
  });

  it('sends no end message to a channel that did not get the start message, for example a channel added during the alert', () => {
    channels = [channel('phones')];
    notifier.alertChanged(change('started'));
    channels = [channel('phones'), channel('added-later')];
    const [start] = outbox.takeDue(NOW);
    outbox.markSent(start.id, 'Sent', NOW);

    notifier.alertChanged(change('ended'));

    expect(queued()).toEqual([
      'phones started: CRITICAL - Haas VF-2: In alarm. Started 9:02 AM.',
      'phones ended: OK - Haas VF-2: In alarm ended at 9:03 AM.',
    ]);
  });

  it('sends no end message when no channel got the start message, for example an alert that was on before the update', () => {
    channels = [channel('phones')];

    notifier.alertChanged(change('ended'));

    expect(queued()).toEqual([]);
  });

  it('sends an alert that is not about one machine only to the channels for all machines', () => {
    channels = [channel('all'), channel('one-machine', { machineIds: ['haas-vf2'] })];

    notifier.alertChanged(change('started', anAlert({ machineId: undefined, labels: { alertname: 'In alarm', severity: 'critical' } })));

    expect(queued()).toEqual(['all started: CRITICAL - Chatter: In alarm. Started 9:02 AM.']);
  });

  it('logs an error and goes on when the messages of a change cannot be queued, so later alerts still get theirs', () => {
    channels = [channel('phones')];
    const failing = new AlertNotifier({
      channels: { list: () => channels }, outbox, textOptions: () => OPTIONS, now: () => NOW,
      machineName: id => { if (id === 'broken') throw new Error('no name'); return 'Haas VF-2'; },
    });

    expect(() => failing.alertChanged(change('started', anAlert({ machineId: 'broken' }), 1))).not.toThrow();
    failing.alertChanged(change('started', anAlert(), 2));

    expect(queued()).toEqual(['phones started: CRITICAL - Haas VF-2: In alarm. Started 9:02 AM.']);
  });

  it('treats an alert with an unknown severity as a warning, so a warning channel still gets it', () => {
    channels = [channel('warning'), channel('critical', { minSeverity: 'critical' })];

    notifier.alertChanged(change('started', anAlert({ labels: { alertname: 'In alarm', machine: 'haas-vf2' } })));

    expect(queued()).toEqual(['warning started: ALERT - Haas VF-2: In alarm. Started 9:02 AM.']);
  });
});
