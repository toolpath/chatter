import { describe, expect, it } from 'vitest';
import {
  channelWantsAlert,
  isAtLeastLevel,
  isPhoneNumber,
  type ChannelRouting,
} from './notifications.js';

describe('isAtLeastLevel', () => {
  it('lets a "warning" channel get warning and critical alerts', () => {
    expect(isAtLeastLevel('warning', 'warning')).toBe(true);
    expect(isAtLeastLevel('critical', 'warning')).toBe(true);
  });

  it('lets a "critical" channel get only critical alerts', () => {
    expect(isAtLeastLevel('critical', 'critical')).toBe(true);
    expect(isAtLeastLevel('warning', 'critical')).toBe(false);
  });
});

describe('channelWantsAlert', () => {
  const allMachines: ChannelRouting = { minSeverity: 'warning', machineIds: null };

  it('takes an alert from each machine when the channel has no machine list', () => {
    expect(channelWantsAlert(allMachines, { machineId: 'haas_1', severity: 'warning' })).toBe(true);
    expect(channelWantsAlert(allMachines, { machineId: 'any_other', severity: 'critical' })).toBe(true);
  });

  it('takes an alert only from the machines in the list', () => {
    const someMachines: ChannelRouting = { minSeverity: 'warning', machineIds: ['haas_1', 'brother_2'] };
    expect(channelWantsAlert(someMachines, { machineId: 'brother_2', severity: 'warning' })).toBe(true);
    expect(channelWantsAlert(someMachines, { machineId: 'fanuc_3', severity: 'critical' })).toBe(false);
  });

  it('takes no alert when the machine list is empty', () => {
    expect(channelWantsAlert({ minSeverity: 'warning', machineIds: [] }, { machineId: 'haas_1', severity: 'critical' }))
      .toBe(false);
  });

  it('takes no alert below the level of the channel', () => {
    const criticalOnly: ChannelRouting = { minSeverity: 'critical', machineIds: null };
    expect(channelWantsAlert(criticalOnly, { machineId: 'haas_1', severity: 'warning' })).toBe(false);
  });
});

describe('isPhoneNumber', () => {
  it('accepts a number with + and the country code (E.164)', () => {
    expect(isPhoneNumber('+15559870001')).toBe(true);
    expect(isPhoneNumber('+447700900123')).toBe(true);
  });

  it('refuses a number without +, with spaces or dashes, or with a 0 country code', () => {
    expect(isPhoneNumber('15559870001')).toBe(false);
    expect(isPhoneNumber('+1 555 987 0001')).toBe(false);
    expect(isPhoneNumber('+1-555-987-0001')).toBe(false);
    expect(isPhoneNumber('+05559870001')).toBe(false);
  });

  it('refuses a number that is too short or too long', () => {
    expect(isPhoneNumber('+12345')).toBe(false);
    expect(isPhoneNumber('+1234567890123456')).toBe(false);
  });
});
