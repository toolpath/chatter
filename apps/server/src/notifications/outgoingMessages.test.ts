import { describe, expect, it } from 'vitest';
import type { Alert } from '../alerts/AlertStore.js';
import type { TextOptions } from './messageText.js';
import { alertOutgoingMessage, moreAlertsMessage, testMessage } from './outgoingMessages.js';

const STARTED = Date.UTC(2026, 10, 13, 15, 2);
const ENDED = Date.UTC(2026, 10, 13, 15, 40);
const OPTIONS: TextOptions = { timeZone: 'America/Chicago', linkBaseUrl: 'http://chatter.local:3001' };

const alert: Alert = {
  name: 'Spindle load above 80%',
  machineId: 'haas-vf2',
  labels: { alertname: 'Spindle load above 80%', machine: 'haas-vf2', severity: 'critical' },
  annotations: { summary: 'Spindle load is 92%' },
  startsAt: STARTED,
  endsAt: ENDED,
};

describe('alertOutgoingMessage', () => {
  it('gives a start message with the text, the machine and a link', () => {
    expect(alertOutgoingMessage({ kind: 'started', alert, machineName: 'Haas VF-2' }, OPTIONS)).toEqual({
      kind: 'started',
      text: 'CRITICAL - Haas VF-2: Spindle load above 80%. Spindle load is 92%. Started 9:02 AM. http://chatter.local:3001/machine/haas-vf2',
      severity: 'critical',
      machine: { id: 'haas-vf2', name: 'Haas VF-2' },
      alertName: 'Spindle load above 80%',
      summary: 'Spindle load is 92%',
      startedAt: '2026-11-13T15:02:00.000Z',
      endedAt: null,
      link: 'http://chatter.local:3001/machine/haas-vf2',
    });
  });

  it('gives the end time in an end message and a combined message', () => {
    expect(alertOutgoingMessage({ kind: 'ended', alert, machineName: 'Haas VF-2' }, OPTIONS).endedAt).toBe('2026-11-13T15:40:00.000Z');
    expect(alertOutgoingMessage({ kind: 'combined', alert, machineName: 'Haas VF-2' }, OPTIONS).endedAt).toBe('2026-11-13T15:40:00.000Z');
  });

  it('uses the machine id when the machine has no name', () => {
    expect(alertOutgoingMessage({ kind: 'started', alert, machineName: null }, OPTIONS).machine).toEqual({ id: 'haas-vf2', name: 'haas-vf2' });
  });

  it('has no machine and no level for an alert that is not about a machine and has an unknown severity', () => {
    const other: Alert = { ...alert, machineId: undefined, labels: { alertname: 'Disk full', severity: 'info' }, annotations: {} };

    expect(alertOutgoingMessage({ kind: 'started', alert: other, machineName: null }, OPTIONS)).toMatchObject({
      machine: null, severity: null, summary: null, link: 'http://chatter.local:3001',
    });
  });
});

describe('moreAlertsMessage', () => {
  it('tells how many alerts it stands for, with a link to Chatter', () => {
    expect(moreAlertsMessage(7, OPTIONS)).toEqual({
      kind: 'more', text: 'And 7 more alerts. Open Chatter to see them. http://chatter.local:3001', severity: null, machine: null,
      alertName: null, summary: null, startedAt: null, endedAt: null, link: 'http://chatter.local:3001',
    });
  });
});

describe('testMessage', () => {
  it('is a test message with no link when the shop gave no address', () => {
    expect(testMessage({ ...OPTIONS, linkBaseUrl: null })).toMatchObject({
      kind: 'test', text: 'Test from Chatter. Messages to this channel work.', link: null,
    });
  });
});
