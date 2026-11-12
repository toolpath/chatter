import type { HistoryValue } from './history.js';

/**
 * Alert rules: checks that vmalert does every 15 seconds on one machine.
 * Each machine has its own list. GET and PUT /api/machine/:id/alert-rules read and change it.
 */

/** "critical" shows a red dot in Chatter. "warning" shows a yellow dot. */
export const ALERT_SEVERITIES = ['warning', 'critical'] as const;
export type AlertSeverity = typeof ALERT_SEVERITIES[number];

export const ALERT_CHECKS = ['above', 'below'] as const;
export type AlertCheck = typeof ALERT_CHECKS[number];

/** A number that the rule compares with a limit, such as the spindle load */
interface ValueSubject {
  kind: 'value';
  name: string;
  metric: HistoryValue;
  /** Put right after the limit, for example "%" or " RPM" */
  unitSuffix: string;
}

/** A 0 or 1 state, such as "in alarm". The rule fires while the state has `firesAt`. */
interface StateSubject {
  kind: 'state';
  name: string;
  metric: HistoryValue;
  firesAt: 0 | 1;
}

export const ALERT_SUBJECTS = {
  'spindle-speed': { kind: 'value', name: 'Spindle speed', metric: 'spindle-speed', unitSuffix: ' RPM' },
  'spindle-load': { kind: 'value', name: 'Spindle load', metric: 'spindle-load', unitSuffix: '%' },
  'part-count': { kind: 'value', name: 'Part count', metric: 'part-count', unitSuffix: ' parts' },
  'not-connected': { kind: 'state', name: 'Not connected', metric: 'connected', firesAt: 0 },
  'in-alarm': { kind: 'state', name: 'In alarm', metric: 'alarm', firesAt: 1 },
  'emergency-stop': { kind: 'state', name: 'Emergency stop', metric: 'emergency', firesAt: 1 },
} as const satisfies Record<string, ValueSubject | StateSubject>;

export type AlertSubject = keyof typeof ALERT_SUBJECTS;
export const ALERT_SUBJECT_IDS = Object.keys(ALERT_SUBJECTS) as AlertSubject[];

interface AlertRuleBase {
  id: string;
  enabled: boolean;
  /** The check must be true this long before the alert fires. 0 fires at the first true check. */
  forMinutes: number;
  severity: AlertSeverity;
}

/** A rule made from the sentence words. A state subject does not use `check` and `limit`. */
export interface SimpleAlertRule extends AlertRuleBase {
  kind: 'simple';
  subject: AlertSubject;
  check: AlertCheck;
  limit: number;
}

/** A rule with a MetricsQL query that the user wrote. `$machine` in it stands for the machine id. */
export interface QueryAlertRule extends AlertRuleBase {
  kind: 'query';
  name: string;
  query: string;
}

export type AlertRule = SimpleAlertRule | QueryAlertRule;

/** What VictoriaMetrics said about a custom query when Chatter ran it one time */
export type QueryCheck =
  | { ok: true; resultCount: number; firstValue: number | null }
  | { ok: false; error: string };

/** A rule before the server gives it an id */
export type NewAlertRule = Omit<SimpleAlertRule, 'id'> | Omit<QueryAlertRule, 'id'>;

export const MACHINE_PLACEHOLDER = '$machine';
export const MAX_ALERT_RULES_PER_MACHINE = 50;
export const MAX_ALERT_QUERY_LENGTH = 1000;
export const MAX_ALERT_NAME_LENGTH = 100;
/** One day */
export const MAX_ALERT_FOR_MINUTES = 1440;

/** The rules that each new machine gets */
export const STARTER_RULES: readonly NewAlertRule[] = [
  { kind: 'simple', enabled: true, subject: 'not-connected', check: 'above', limit: 0, forMinutes: 10, severity: 'warning' },
  { kind: 'simple', enabled: true, subject: 'in-alarm', check: 'above', limit: 0, forMinutes: 5, severity: 'critical' },
  { kind: 'simple', enabled: true, subject: 'spindle-load', check: 'above', limit: 90, forMinutes: 1, severity: 'warning' },
];

/** The MetricsQL query that vmalert runs for the rule on one machine */
export function ruleQuery(rule: AlertRule, machineId: string): string {
  const machineLabel = escapeLabelValue(machineId);
  if (rule.kind === 'query') return rule.query.replaceAll(MACHINE_PLACEHOLDER, () => machineLabel);
  const subject: ValueSubject | StateSubject = ALERT_SUBJECTS[rule.subject];
  const series = `${metricName(subject.metric)}{machine="${machineLabel}"}`;
  if (subject.kind === 'state') return `${series} == ${subject.firesAt}`;
  return `${series} ${rule.check === 'above' ? '>' : '<'} ${rule.limit}`;
}

/** A query without $machine would check every machine, so Chatter does not save it */
export function hasMachinePlaceholder(query: string): boolean {
  return query.includes(MACHINE_PLACEHOLDER);
}

/** The alert name, for example "Spindle load above 90%" */
export function ruleName(rule: AlertRule | NewAlertRule): string {
  if (rule.kind === 'query') return rule.name.trim() || 'Custom query';
  const subject: ValueSubject | StateSubject = ALERT_SUBJECTS[rule.subject];
  if (subject.kind === 'state') return subject.name;
  return `${subject.name} ${rule.check} ${rule.limit}${subject.unitSuffix}`;
}

/** True when the rules do the same check. The id does not count. */
export function isSameRule(first: AlertRule | NewAlertRule, second: AlertRule | NewAlertRule): boolean {
  return JSON.stringify(withoutId(first)) === JSON.stringify(withoutId(second));
}

function withoutId(rule: AlertRule | NewAlertRule): NewAlertRule {
  if (rule.kind === 'query') {
    const { kind, enabled, name, query, forMinutes, severity } = rule;
    return { kind, enabled, name, query, forMinutes, severity };
  }
  const { kind, enabled, subject, check, limit, forMinutes, severity } = rule;
  return { kind, enabled, subject, check, limit, forMinutes, severity };
}

/** The same name rule as apps/server/src/recording/metricLines.ts: spindle-speed → chatter_spindle_speed */
function metricName(value: HistoryValue): string {
  return `chatter_${value.replace(/-/g, '_')}`;
}

/** A label value goes in double quotes, so a quote or a backslash in it must be escaped */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
