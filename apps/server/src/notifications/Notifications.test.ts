import type { ChannelInput } from '@local-chatter/shared';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Alert, AlertStore } from '../alerts/AlertStore.js';
import { SettingsTable } from '../storage/settingsTable.js';
import { Notifications } from './Notifications.js';

const NOW = Date.UTC(2026, 10, 13, 15, 2);

const slack: ChannelInput = {
  type: 'webhook', name: 'Slack', values: { url: 'https://hooks.slack.com/services/T0/B0/x' },
  minSeverity: 'warning', machineIds: null, enabled: true,
};

const alert: Alert = {
  name: 'In alarm', machineId: 'haas-vf2', labels: { alertname: 'In alarm', machine: 'haas-vf2', severity: 'critical' },
  annotations: {}, startsAt: NOW, endsAt: NOW + 60_000,
};

describe('Notifications', () => {
  let db: Database.Database;
  let alerts: AlertStore;
  let notifications: Notifications;
  let requests: { url: string; body: { text: string } }[];

  beforeEach(() => {
    db = new Database(':memory:');
    alerts = new AlertStore(db);
    requests = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as { text: string } });
      return new Response(null, { status: 200 });
    };
    notifications = new Notifications({
      db, settingsTable: new SettingsTable(db), machineName: () => 'Haas VF-2', now: () => NOW, fetch: fetch as typeof globalThis.fetch,
    });
    notifications.settings.save({ linkBaseUrl: null, timeZone: 'America/Chicago' });
  });

  function addChannel(input: ChannelInput): string {
    const result = notifications.channels.add(input, NOW);
    if (!result.ok) throw new Error(result.error);
    return result.channel.id;
  }

  it('sends a message to the webhook when an alert starts', async () => {
    addChannel(slack);
    alerts.save([alert], NOW);

    notifications.findAlertChanges();
    await notifications.sendDue();

    expect(requests).toEqual([{
      url: 'https://hooks.slack.com/services/T0/B0/x',
      body: expect.objectContaining({ text: 'CRITICAL - Haas VF-2: In alarm. Started 9:02 AM.' }),
    }]);
    expect(notifications.outbox.list({})[0]).toMatchObject({ status: 'sent' });
  });

  it('deletes the waiting messages of a removed channel', () => {
    const id = addChannel(slack);
    alerts.save([alert], NOW);
    notifications.findAlertChanges();

    expect(notifications.removeChannel(id)).toBe(true);

    expect(notifications.outbox.list({})).toEqual([]);
    expect(notifications.channels.get(id)).toBeNull();
  });

  it('takes a removed machine out of the channels and deletes its waiting messages', () => {
    const id = addChannel({ ...slack, machineIds: ['haas-vf2', 'haas-st10'] });
    alerts.save([alert], NOW);
    notifications.findAlertChanges();

    notifications.removeMachine('haas-vf2');

    expect(notifications.outbox.list({})).toEqual([]);
    expect(notifications.channels.get(id)?.machineIds).toEqual(['haas-st10']);
  });

  it('stops all its timers', async () => {
    vi.useFakeTimers();
    try {
      notifications.start();
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await notifications.stop();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
