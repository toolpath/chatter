import { describe, expect, it } from 'vitest';
import {
  hasMachinePlaceholder,
  isSameRule,
  ruleName,
  ruleQuery,
  STARTER_RULES,
  type AlertRule,
} from './alertRules.js';

const spindleLoadRule: AlertRule = {
  id: 'r1',
  kind: 'simple',
  enabled: true,
  subject: 'spindle-load',
  check: 'above',
  limit: 90,
  forMinutes: 1,
  severity: 'warning',
};

describe('ruleQuery', () => {
  it('compares a value of one machine with the limit', () => {
    expect(ruleQuery(spindleLoadRule, 'haas_1')).toBe('chatter_spindle_load{machine="haas_1"} > 90');
    expect(ruleQuery({ ...spindleLoadRule, subject: 'spindle-speed', check: 'below', limit: 500 }, 'haas_1'))
      .toBe('chatter_spindle_speed{machine="haas_1"} < 500');
  });

  it('checks a state of one machine, with no limit', () => {
    const offline: AlertRule = { ...spindleLoadRule, subject: 'not-connected' };
    expect(ruleQuery(offline, 'haas_1')).toBe('chatter_connected{machine="haas_1"} == 0');
    expect(ruleQuery({ ...offline, subject: 'in-alarm' }, 'haas_1')).toBe('chatter_alarm{machine="haas_1"} == 1');
    expect(ruleQuery({ ...offline, subject: 'emergency-stop' }, 'haas_1')).toBe('chatter_emergency{machine="haas_1"} == 1');
  });

  it('puts the machine id in place of each $machine in a custom query', () => {
    const custom: AlertRule = {
      id: 'r2', kind: 'query', enabled: true, name: 'Slow spindle', forMinutes: 5, severity: 'warning',
      query: 'avg_over_time(chatter_spindle_speed{machine="$machine"}[5m]) < 500 and chatter_running{machine="$machine"} == 1',
    };
    expect(ruleQuery(custom, 'haas_1')).toBe(
      'avg_over_time(chatter_spindle_speed{machine="haas_1"}[5m]) < 500 and chatter_running{machine="haas_1"} == 1',
    );
  });

  it('puts a machine id with $ signs in a custom query as it is', () => {
    const custom: AlertRule = {
      id: 'r3', kind: 'query', enabled: true, name: '', forMinutes: 0, severity: 'warning', query: 'chatter_alarm{machine="$machine"} == 1',
    };
    expect(ruleQuery(custom, "m$&$'1")).toBe('chatter_alarm{machine="m$&$\'1"} == 1');
  });

  it('escapes a machine id with a quote, so the id cannot change the query', () => {
    expect(ruleQuery(spindleLoadRule, 'a"b\\c')).toBe('chatter_spindle_load{machine="a\\"b\\\\c"} > 90');
  });
});

describe('hasMachinePlaceholder', () => {
  it('is true only when the query names the machine with $machine', () => {
    expect(hasMachinePlaceholder('chatter_alarm{machine="$machine"} == 1')).toBe(true);
    expect(hasMachinePlaceholder('chatter_alarm == 1')).toBe(false);
  });
});

describe('ruleName', () => {
  it('says the value, the check and the limit with its unit', () => {
    expect(ruleName(spindleLoadRule)).toBe('Spindle load above 90%');
    expect(ruleName({ ...spindleLoadRule, subject: 'spindle-speed', check: 'below', limit: 500 })).toBe('Spindle speed below 500 RPM');
    expect(ruleName({ ...spindleLoadRule, subject: 'part-count', limit: 100 })).toBe('Part count above 100 parts');
  });

  it('says only the state for a state rule', () => {
    expect(ruleName({ ...spindleLoadRule, subject: 'not-connected' })).toBe('Not connected');
  });

  it('uses the name of a custom query, or "Custom query" when it has none', () => {
    const custom: AlertRule = { id: 'r2', kind: 'query', enabled: true, name: '  Slow spindle ', query: 'x', forMinutes: 1, severity: 'warning' };
    expect(ruleName(custom)).toBe('Slow spindle');
    expect(ruleName({ ...custom, name: ' ' })).toBe('Custom query');
  });
});

describe('STARTER_RULES', () => {
  it('are offline 10 min, alarm 5 min (critical) and spindle load above 90% for 1 min, all on', () => {
    expect(STARTER_RULES.map(rule => [ruleName({ ...rule, id: '' }), rule.forMinutes, rule.severity, rule.enabled])).toEqual([
      ['Not connected', 10, 'warning', true],
      ['In alarm', 5, 'critical', true],
      ['Spindle load above 90%', 1, 'warning', true],
    ]);
  });
});

describe('isSameRule', () => {
  it('compares everything but the id', () => {
    expect(isSameRule(spindleLoadRule, { ...spindleLoadRule, id: 'other' })).toBe(true);
    expect(isSameRule(spindleLoadRule, { ...spindleLoadRule, limit: 80 })).toBe(false);
  });
});
