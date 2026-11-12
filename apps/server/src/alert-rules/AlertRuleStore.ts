import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { AlertRule, NewAlertRule } from '@local-chatter/shared';

/** A rule from the web app. A rule that is already saved keeps its id, so a firing alert goes on firing. */
export type RuleToSave = NewAlertRule & { id?: string };

interface RuleRow {
  id: string;
  machine_id: string;
  rule: string;
}

/**
 * The alert rules of each machine, in the "alert_rules" table of the SQLite database.
 * Each row keeps the rule as JSON. The routes check the shape before a rule gets here.
 */
export class AlertRuleStore {
  /** True when this start made the table, so the machines that are already there have no rules yet */
  readonly isNew: boolean;

  constructor(private readonly db: Database.Database) {
    this.isNew = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'alert_rules'").get();
    db.exec(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        rule TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS alert_rules_machine ON alert_rules (machine_id, position);
    `);
  }

  /** For tests: the rules are kept in memory only */
  static inMemory(): AlertRuleStore {
    return new AlertRuleStore(new Database(':memory:'));
  }

  /** In the order that the user put them */
  rulesOf(machineId: string): AlertRule[] {
    const rows = this.db.prepare('SELECT id, machine_id, rule FROM alert_rules WHERE machine_id = ? ORDER BY position')
      .all(machineId) as RuleRow[];
    return rows.map(toRule);
  }

  /** The rules of every machine that has rules */
  rulesByMachine(): Map<string, AlertRule[]> {
    const rows = this.db.prepare('SELECT id, machine_id, rule FROM alert_rules ORDER BY machine_id, position').all() as RuleRow[];
    const byMachine = new Map<string, AlertRule[]>();
    for (const row of rows) {
      byMachine.set(row.machine_id, [...(byMachine.get(row.machine_id) ?? []), toRule(row)]);
    }
    return byMachine;
  }

  /**
   * Put this list in place of the machine's rules.
   * A given id that is not a rule of this machine gets a new id, so one machine cannot take the rule of another.
   */
  replaceRules(machineId: string, rules: RuleToSave[]): AlertRule[] {
    const knownIds = new Set(this.rulesOf(machineId).map(rule => rule.id));
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM alert_rules WHERE machine_id = ?').run(machineId);
      rules.forEach((rule, position) => {
        const id = rule.id && knownIds.has(rule.id) ? rule.id : randomUUID();
        this.insert(machineId, position, { ...rule, id });
      });
    })();
    return this.rulesOf(machineId);
  }

  /** Put the rules after the machine's other rules */
  addRules(machineId: string, rules: readonly NewAlertRule[]): void {
    const start = this.rulesOf(machineId).length;
    this.db.transaction(() => {
      rules.forEach((rule, index) => this.insert(machineId, start + index, { ...rule, id: randomUUID() }));
    })();
  }

  removeMachine(machineId: string): void {
    this.db.prepare('DELETE FROM alert_rules WHERE machine_id = ?').run(machineId);
  }

  private insert(machineId: string, position: number, rule: AlertRule): void {
    const { id, ...ruleWithoutId } = rule;
    this.db.prepare('INSERT INTO alert_rules (id, machine_id, position, rule) VALUES (?, ?, ?, ?)')
      .run(id, machineId, position, JSON.stringify(ruleWithoutId));
  }
}

function toRule(row: RuleRow): AlertRule {
  return { ...(JSON.parse(row.rule) as NewAlertRule), id: row.id } as AlertRule;
}
