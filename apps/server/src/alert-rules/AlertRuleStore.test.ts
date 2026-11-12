import Database from 'better-sqlite3';
import { STARTER_RULES, type NewAlertRule, type SimpleAlertRule } from '@local-chatter/shared';
import { describe, expect, it } from 'vitest';
import { AlertRuleStore } from './AlertRuleStore.js';

const highLoad: Omit<SimpleAlertRule, 'id'> = {
  kind: 'simple', enabled: true, subject: 'spindle-load', check: 'above', limit: 90, forMinutes: 1, severity: 'warning',
};
const slowSpindle: NewAlertRule = {
  kind: 'query', enabled: false, name: 'Slow spindle', query: 'chatter_spindle_speed{machine="$machine"} < 500', forMinutes: 5, severity: 'critical',
};

describe('AlertRuleStore', () => {
  it('keeps the rules of each machine in the order they were given', () => {
    const store = AlertRuleStore.inMemory();
    store.replaceRules('m1', [highLoad, slowSpindle]);
    store.replaceRules('m2', [slowSpindle]);

    expect(store.rulesOf('m1')).toEqual([
      { ...highLoad, id: expect.any(String) },
      { ...slowSpindle, id: expect.any(String) },
    ]);
    expect(store.rulesOf('m2')).toHaveLength(1);
    expect([...store.rulesByMachine().keys()]).toEqual(['m1', 'm2']);
  });

  it('keeps the id of a saved rule, so its alert goes on firing after a save', () => {
    const store = AlertRuleStore.inMemory();
    const [saved] = store.replaceRules('m1', [highLoad]);

    const [again] = store.replaceRules('m1', [{ ...highLoad, id: saved.id, limit: 80 }]);

    expect(again).toEqual({ ...highLoad, limit: 80, id: saved.id });
  });

  it('gives a new id to a rule id of another machine', () => {
    const store = AlertRuleStore.inMemory();
    const [other] = store.replaceRules('m2', [highLoad]);

    const [mine] = store.replaceRules('m1', [{ ...highLoad, id: other.id }]);

    expect(mine.id).not.toBe(other.id);
    expect(store.rulesOf('m2')).toEqual([other]);
  });

  it('adds rules after the others', () => {
    const store = AlertRuleStore.inMemory();
    store.replaceRules('m1', [slowSpindle]);

    store.addRules('m1', STARTER_RULES);

    expect(store.rulesOf('m1').map(rule => rule.kind === 'simple' ? rule.subject : rule.name))
      .toEqual(['Slow spindle', 'not-connected', 'in-alarm', 'spindle-load']);
  });

  it('removes the rules of a removed machine only', () => {
    const store = AlertRuleStore.inMemory();
    store.replaceRules('m1', [highLoad]);
    store.replaceRules('m2', [highLoad]);

    store.removeMachine('m1');

    expect(store.rulesOf('m1')).toEqual([]);
    expect(store.rulesOf('m2')).toHaveLength(1);
  });

  it('tells when it made the table, so the machines that are already there get the starter rules one time', () => {
    const db = new Database(':memory:');
    expect(new AlertRuleStore(db).isNew).toBe(true);
    expect(new AlertRuleStore(db).isNew).toBe(false);
  });
});
