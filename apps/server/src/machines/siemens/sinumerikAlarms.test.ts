import { describe, expect, it } from 'vitest';
import { ActiveAlarms } from './sinumerikAlarms.js';

const doorAlarm = {
  conditionId: 'ns=2;s=Alarm/700209',
  conditionName: 'SystemCondition',
  sourceName: 'NCK',
  message: '700209 | [M,Door] Door request',
  active: true,
  retain: true,
};

describe('ActiveAlarms', () => {
  it('keeps an alarm that comes, with the number from its message', () => {
    const alarms = new ActiveAlarms();
    alarms.apply(doorAlarm);
    expect(alarms.list()).toEqual([{ code: '700209', text: '[M,Door] Door request' }]);
  });

  it('removes the alarm when it goes', () => {
    const alarms = new ActiveAlarms();
    alarms.apply(doorAlarm);
    alarms.apply({ ...doorAlarm, active: false });
    expect(alarms.list()).toEqual([]);
  });

  it('removes the alarm when the server no longer retains it', () => {
    const alarms = new ActiveAlarms();
    alarms.apply(doorAlarm);
    alarms.apply({ ...doorAlarm, retain: false });
    expect(alarms.list()).toEqual([]);
  });

  it('keeps each condition once, in the order the alarms came', () => {
    const alarms = new ActiveAlarms();
    alarms.apply(doorAlarm);
    alarms.apply({ ...doorAlarm, conditionId: 'ns=2;s=Alarm/10208', message: '10208 Continue program with NC start' });
    alarms.apply(doorAlarm);
    expect(alarms.list().map(alarm => alarm.code)).toEqual(['700209', '10208']);
  });

  it('ignores events that are not alarms, such as the start and end of a refresh', () => {
    const alarms = new ActiveAlarms();
    alarms.apply({ sourceName: 'Server', active: undefined });
    expect(alarms.list()).toEqual([]);
  });

  it('uses the condition name as the code when the message has no number', () => {
    const alarms = new ActiveAlarms();
    alarms.apply({ conditionName: 'LowCoolant', message: 'Coolant low', active: true });
    expect(alarms.list()).toEqual([{ code: 'LowCoolant', text: 'Coolant low' }]);
  });

  it('uses the source, not the generic SystemCondition name, when the message has no number', () => {
    const alarms = new ActiveAlarms();
    alarms.apply({ conditionName: 'SystemCondition', sourceName: 'PLC', message: 'Door open', active: true });
    expect(alarms.list()).toEqual([{ code: 'PLC', text: 'Door open' }]);
  });

  it('tells apart alarms without a condition id by their text', () => {
    const alarms = new ActiveAlarms();
    alarms.apply({ conditionName: 'SystemCondition', message: '101 | A', active: true });
    alarms.apply({ conditionName: 'SystemCondition', message: '102 | B', active: true });
    alarms.apply({ conditionName: 'SystemCondition', message: '101 | A', active: false });
    expect(alarms.list()).toEqual([{ code: '102', text: 'B' }]);
  });
});
