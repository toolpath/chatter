import Database from 'better-sqlite3';
import { parse } from 'yaml';
import { MAX_ALERT_RULES_PER_MACHINE, type NewAlertRule } from '@local-chatter/shared';
import { describe, expect, it, vi } from 'vitest';
import { captureLog } from '../logging/testSupport.js';
import { AlertRuleService } from './AlertRuleService.js';
import { AlertRuleStore, type RuleToSave } from './AlertRuleStore.js';
import type { QueryCheck } from './QueryChecker.js';

const highLoad: NewAlertRule = {
  kind: 'simple', enabled: true, subject: 'spindle-load', check: 'above', limit: 90, forMinutes: 1, severity: 'warning',
};
const slowSpindle: NewAlertRule = {
  kind: 'query', enabled: true, name: 'Slow spindle', query: 'chatter_spindle_speed{machine="$machine"} < 500', forMinutes: 5, severity: 'warning',
};

/** The service with a file in memory, a vmalert that reads, and a query check that gives `check` */
function serviceWith({ check = { ok: true, resultCount: 0, firstValue: null } as QueryCheck, store = AlertRuleStore.inMemory() } = {}) {
  const files: string[] = [];
  const reload = vi.fn().mockResolvedValue(true);
  const checkQuery = vi.fn().mockResolvedValue(check);
  const service = new AlertRuleService({
    store,
    rulesFile: { write: async text => { files.push(text); } },
    vmalert: { reload },
    queries: { check: checkQuery },
  });
  const lastFile = () => parse(files.at(-1) ?? 'groups: []');
  return { service, files, lastFile, reload, checkQuery };
}

describe('AlertRuleService', () => {
  it('saves the rules, writes the file and asks vmalert to read it', async () => {
    const { service, lastFile, reload } = serviceWith();

    const result = await service.saveRules('haas_1', [highLoad]);

    expect(result).toEqual({ ok: true, rules: [{ ...highLoad, id: expect.any(String) }], vmalertReloaded: true });
    expect(lastFile().groups[0].rules[0].expr).toBe('chatter_spindle_load{machine="haas_1"} > 90');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('checks a custom query on this machine before it saves', async () => {
    const { service, checkQuery } = serviceWith();

    await service.saveRules('haas_1', [slowSpindle]);

    expect(checkQuery).toHaveBeenCalledWith('chatter_spindle_speed{machine="haas_1"} < 500');
  });

  it('saves nothing when VictoriaMetrics refuses a custom query, and tells which rule', async () => {
    const { service, files } = serviceWith({ check: { ok: false, error: 'cannot parse' } });

    const result = await service.saveRules('haas_1', [highLoad, slowSpindle]);

    expect(result).toEqual({ ok: false, error: 'cannot parse', ruleIndex: 1 });
    expect(service.rulesOf('haas_1')).toEqual([]);
    expect(files).toEqual([]);
  });

  it('saves nothing when a custom query does not name the machine with $machine', async () => {
    const { service, checkQuery } = serviceWith();

    const result = await service.saveRules('haas_1', [{ ...slowSpindle, query: 'chatter_spindle_speed < 500' }]);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/\$machine/);
    expect(checkQuery).not.toHaveBeenCalled();
  });

  it('does not ask VictoriaMetrics again about a saved query that did not change', async () => {
    const { service, checkQuery } = serviceWith();
    const [saved] = (await service.saveRules('haas_1', [slowSpindle]) as { rules: RuleToSave[] }).rules;
    checkQuery.mockClear().mockResolvedValue({ ok: false, error: 'VictoriaMetrics did not answer' });

    const result = await service.saveRules('haas_1', [saved, highLoad]);

    expect(result.ok).toBe(true);
    expect(checkQuery).not.toHaveBeenCalled();
  });

  it('saves a custom query that is turned off without asking VictoriaMetrics, and asks when it is turned on', async () => {
    const { service, checkQuery } = serviceWith({ check: { ok: false, error: 'VictoriaMetrics did not answer' } });

    const off = await service.saveRules('haas_1', [{ ...slowSpindle, enabled: false }]);
    expect(off.ok).toBe(true);
    expect(checkQuery).not.toHaveBeenCalled();

    const [saved] = service.rulesOf('haas_1');
    const on = await service.saveRules('haas_1', [{ ...saved, enabled: true }]);
    expect(on).toEqual({ ok: false, error: 'VictoriaMetrics did not answer', ruleIndex: 0 });
  });

  it('checks the custom queries at the same time', async () => {
    const { service, checkQuery } = serviceWith();
    let running = 0;
    let mostAtOnce = 0;
    checkQuery.mockImplementation(async () => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running -= 1;
      return { ok: true, resultCount: 0, firstValue: null };
    });

    await service.saveRules('haas_1', [slowSpindle, { ...slowSpindle, name: 'Other' }]);

    expect(mostAtOnce).toBe(2);
  });

  it('copies no more rules than a machine can have', async () => {
    const { service } = serviceWith();
    const many = Array.from({ length: MAX_ALERT_RULES_PER_MACHINE }, (_, limit) => ({ ...highLoad, limit }) as NewAlertRule);
    await service.saveRules('brother_2', many.slice(0, MAX_ALERT_RULES_PER_MACHINE - 1));
    await service.saveRules('haas_1', [{ ...highLoad, limit: 500 }, { ...highLoad, limit: 600 }]);

    const result = await service.copyRules('haas_1', ['brother_2']);

    expect(result).toEqual({ copied: 1, notCopied: 1, vmalertReloaded: true });
    expect(service.rulesOf('brother_2')).toHaveLength(MAX_ALERT_RULES_PER_MACHINE);
  });

  it('copies rules to other machines, but not a rule that a machine already has', async () => {
    const { service } = serviceWith();
    await service.saveRules('haas_1', [highLoad, slowSpindle]);
    await service.saveRules('brother_2', [highLoad]);

    const result = await service.copyRules('haas_1', ['brother_2', 'haas_1']);

    expect(result).toEqual({ copied: 1, notCopied: 0, vmalertReloaded: true });
    expect(service.rulesOf('brother_2').map(rule => rule.kind)).toEqual(['simple', 'query']);
    expect(service.rulesOf('haas_1')).toHaveLength(2);
  });

  it('gives a new machine the starter rules, and removes the rules of a removed machine', async () => {
    const { service, lastFile } = serviceWith();

    service.machineAdded('haas_1');
    await service.publish();
    expect(service.rulesOf('haas_1')).toHaveLength(3);
    expect(lastFile().groups[0].rules.map((rule: { alert: string }) => rule.alert))
      .toEqual(['Not connected', 'In alarm', 'Spindle load above 90%']);

    service.removeMachine('haas_1');
    await service.publish();
    expect(service.rulesOf('haas_1')).toEqual([]);
    expect(lastFile().groups).toEqual([]);
  });

  it('gives the machines that are already there the starter rules on the first start only', async () => {
    const db = new Database(':memory:');
    const first = serviceWith({ store: new AlertRuleStore(db) }).service;
    await first.addStarterRulesOnFirstStart(['haas_1']);
    await first.saveRules('haas_1', []);

    const second = serviceWith({ store: new AlertRuleStore(db) }).service;
    await second.addStarterRulesOnFirstStart(['haas_1']);

    expect(second.rulesOf('haas_1')).toEqual([]);
  });

  it('tests a query on one machine', async () => {
    const { service, checkQuery } = serviceWith({ check: { ok: true, resultCount: 1, firstValue: 812 } });

    expect(await service.testQuery('haas_1', 'chatter_spindle_speed{machine="$machine"}'))
      .toEqual({ ok: true, resultCount: 1, firstValue: 812 });
    expect(checkQuery).toHaveBeenCalledWith('chatter_spindle_speed{machine="haas_1"}');
  });

  it('says false when the file cannot be written, logs why, and does not ask vmalert', async () => {
    const reload = vi.fn();
    const log = captureLog();
    const service = new AlertRuleService({
      store: AlertRuleStore.inMemory(),
      rulesFile: { write: async () => { throw new Error('read-only folder'); } },
      vmalert: { reload },
      queries: { check: vi.fn() },
    });

    expect(await service.publish()).toBe(false);
    log.restore();
    expect(log.text('error')).toContain('read-only folder');
    expect(reload).not.toHaveBeenCalled();
  });
});
