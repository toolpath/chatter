import {
  hasMachinePlaceholder,
  isSameRule,
  MACHINE_PLACEHOLDER,
  MAX_ALERT_RULES_PER_MACHINE,
  ruleQuery,
  STARTER_RULES,
  type AlertRule,
} from '@local-chatter/shared';
import { createLogger } from '../logging/logger.js';
import type { MachineAddListener, MachineRemovalListener } from '../polling/poller.js';
import { AlertRuleStore, type RuleToSave } from './AlertRuleStore.js';
import type { QueryCheck, QueryChecker } from './QueryChecker.js';
import { rulesFileText } from './rulesFile.js';
import type { RuleReloader } from './VmalertClient.js';

const log = createLogger('alert-rules');

/** Where the rules file goes. RulesFileWriter writes it to the folder that vmalert reads. */
export interface RulesFileTarget {
  write(text: string): Promise<void>;
}

export interface AlertRuleServiceParts {
  store: AlertRuleStore;
  rulesFile: RulesFileTarget;
  vmalert: RuleReloader;
  queries: QueryChecker;
}

export interface CopyRulesResult {
  copied: number;
  /** Rules left out, because a machine already had the most rules that it can have */
  notCopied: number;
  vmalertReloaded: boolean;
}

export type SaveRulesResult =
  | { ok: true; rules: AlertRule[]; vmalertReloaded: boolean }
  | { ok: false; error: string; ruleIndex: number };

/**
 * The alert rules of the machines, and the vmalert file made from them.
 * Each change writes the whole file again and asks vmalert to read it.
 */
export class AlertRuleService implements MachineAddListener, MachineRemovalListener {
  private readonly store: AlertRuleStore;
  private readonly rulesFile: RulesFileTarget;
  private readonly vmalert: RuleReloader;
  private readonly queries: QueryChecker;
  /** One write at a time, so two saves cannot mix their files */
  private publishing: Promise<boolean> = Promise.resolve(true);

  constructor({ store, rulesFile, vmalert, queries }: AlertRuleServiceParts) {
    this.store = store;
    this.rulesFile = rulesFile;
    this.vmalert = vmalert;
    this.queries = queries;
  }

  /** For tests: rules in memory, no file, a vmalert that always reads, and a check that takes every query */
  static inMemory(): AlertRuleService {
    return new AlertRuleService({
      store: AlertRuleStore.inMemory(),
      rulesFile: { write: async () => {} },
      vmalert: { reload: async () => true },
      queries: { check: async () => ({ ok: true, resultCount: 0, firstValue: null }) },
    });
  }

  rulesOf(machineId: string): AlertRule[] {
    return this.store.rulesOf(machineId);
  }

  /**
   * Put the list in place of the machine's rules.
   * A custom query must name the machine with $machine, and VictoriaMetrics must take it.
   * Else nothing is saved, because one bad query would stop vmalert from reading the whole file.
   */
  async saveRules(machineId: string, rules: RuleToSave[]): Promise<SaveRulesResult> {
    const problem = await this.firstQueryProblem(machineId, rules);
    if (problem) return { ok: false, ...problem };
    const saved = this.store.replaceRules(machineId, rules);
    return { ok: true, rules: saved, vmalertReloaded: await this.publish() };
  }

  /**
   * Copy the machine's rules to other machines. A rule that a machine already has is not copied again.
   * A machine gets no more rules than MAX_ALERT_RULES_PER_MACHINE, so its tab can still save.
   */
  async copyRules(fromMachineId: string, toMachineIds: string[]): Promise<CopyRulesResult> {
    const rules = this.store.rulesOf(fromMachineId);
    let copied = 0;
    let notCopied = 0;
    for (const machineId of toMachineIds.filter(id => id !== fromMachineId)) {
      const existing = this.store.rulesOf(machineId);
      const missing = rules.filter(rule => !existing.some(other => isSameRule(rule, other)));
      const room = Math.max(0, MAX_ALERT_RULES_PER_MACHINE - existing.length);
      this.store.addRules(machineId, missing.slice(0, room));
      copied += Math.min(missing.length, room);
      notCopied += Math.max(0, missing.length - room);
    }
    return { copied, notCopied, vmalertReloaded: await this.publish() };
  }

  /** Run a custom query on one machine now, for the Test button */
  async testQuery(machineId: string, query: string): Promise<QueryCheck> {
    if (!hasMachinePlaceholder(query)) return { ok: false, error: missingPlaceholderError() };
    return this.queries.check(ruleQuery(queryRule(query), machineId));
  }

  /** On the first start with alert rules, the machines that are already there get the starter rules too */
  async addStarterRulesOnFirstStart(machineIds: string[]): Promise<void> {
    if (!this.store.isNew) return;
    for (const machineId of machineIds) this.store.addRules(machineId, STARTER_RULES);
  }

  machineAdded(machineId: string): void {
    this.store.addRules(machineId, STARTER_RULES);
    void this.publish();
  }

  removeMachine(machineId: string): void {
    this.store.removeMachine(machineId);
    void this.publish();
  }

  /** Write the rules file and ask vmalert to read it. True when vmalert read it. */
  publish(): Promise<boolean> {
    this.publishing = this.publishing.then(() => this.publishNow());
    return this.publishing;
  }

  private async publishNow(): Promise<boolean> {
    try {
      await this.rulesFile.write(rulesFileText(this.store.rulesByMachine()));
    } catch (error) {
      log.error('Could not write the vmalert rules file', { error });
      return false;
    }
    return this.vmalert.reload();
  }

  /**
   * The first custom query that cannot be saved. Each query must have $machine.
   * VictoriaMetrics checks only the queries that are on and new or changed, all at the same time.
   * So a user can still turn off a rule, or change another rule, while VictoriaMetrics does not answer.
   */
  private async firstQueryProblem(machineId: string, rules: RuleToSave[]): Promise<{ error: string; ruleIndex: number } | null> {
    const missingIndex = rules.findIndex(rule => rule.kind === 'query' && !hasMachinePlaceholder(rule.query));
    if (missingIndex >= 0) return { error: missingPlaceholderError(), ruleIndex: missingIndex };

    const savedById = new Map(this.store.rulesOf(machineId).map(rule => [rule.id, rule]));
    const errors = await Promise.all(rules.map(async rule => {
      if (rule.kind !== 'query' || !rule.enabled || isCheckedAlready(rule, savedById)) return null;
      const check = await this.queries.check(ruleQuery(queryRule(rule.query), machineId));
      return check.ok ? null : check.error;
    }));
    const ruleIndex = errors.findIndex(error => error !== null);
    return ruleIndex < 0 ? null : { error: errors[ruleIndex] as string, ruleIndex };
  }
}

/** VictoriaMetrics took this query when it was saved and on, and the query did not change since */
function isCheckedAlready(rule: RuleToSave & { kind: 'query' }, savedById: Map<string, AlertRule>): boolean {
  const saved = rule.id === undefined ? undefined : savedById.get(rule.id);
  return saved?.kind === 'query' && saved.enabled && saved.query === rule.query;
}

function missingPlaceholderError(): string {
  return `The query must have ${MACHINE_PLACEHOLDER} in it, for example {machine="${MACHINE_PLACEHOLDER}"}, so that it checks only this machine.`;
}

/** A rule around a query, to put the machine id in it */
function queryRule(query: string): AlertRule {
  return { id: '', kind: 'query', enabled: true, name: '', query, forMinutes: 0, severity: 'warning' };
}
