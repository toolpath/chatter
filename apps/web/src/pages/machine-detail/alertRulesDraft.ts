import {
  ALERT_SUBJECTS,
  hasMachinePlaceholder,
  isSameRule,
  MACHINE_PLACEHOLDER,
  MAX_ALERT_FOR_MINUTES,
  ruleName,
  ruleQuery,
  type AlertRule,
  type AlertSubject,
  type QueryAlertRule,
  type SimpleAlertRule,
} from '@local-chatter/shared';
import type { RuleToSave } from '../../api/alertRules';

/**
 * The alert rules while the user changes them, before Save.
 * Each rule has a `key` for React. A saved rule uses its id as its key.
 */
export type DraftRule = RuleToSave & { key: string };

/** The words of a rule that the user can change */
export type RulePatch =
  | Partial<Omit<SimpleAlertRule, 'id' | 'kind'>>
  | Partial<Omit<QueryAlertRule, 'id' | 'kind'>>;

export interface DraftProblem {
  key: string;
  message: string;
}

const NEW_SIMPLE_RULE: Omit<SimpleAlertRule, 'id'> = {
  kind: 'simple', enabled: true, subject: 'spindle-speed', check: 'above', limit: 10000, forMinutes: 1, severity: 'warning',
};
const NEW_QUERY_RULE: Omit<QueryAlertRule, 'id'> = {
  kind: 'query', enabled: true, name: '', query: `chatter_spindle_speed{machine="${MACHINE_PLACEHOLDER}"} > 10000`, forMinutes: 1, severity: 'warning',
};

/** A limit to start from, when a rule changes to a value with a limit */
const STARTING_LIMITS: Record<AlertSubject, number> = {
  'spindle-speed': 10000, 'spindle-load': 90, 'part-count': 100, 'not-connected': 0, 'in-alarm': 0, 'emergency-stop': 0,
};

let newRuleCount = 0;

export function draftOf(rules: AlertRule[]): DraftRule[] {
  return rules.map(rule => ({ ...rule, key: rule.id }));
}

export function changeRule(draft: DraftRule[], key: string, patch: RulePatch): DraftRule[] {
  return draft.map(rule => (rule.key === key ? ({ ...rule, ...patch } as DraftRule) : rule));
}

export function addRule(draft: DraftRule[], kind: 'simple' | 'query'): DraftRule[] {
  newRuleCount += 1;
  const rule = kind === 'simple' ? NEW_SIMPLE_RULE : NEW_QUERY_RULE;
  return [...draft, { ...rule, key: `new-${newRuleCount}` }];
}

/** The change for a new subject. A state rule has no real limit, so a rule that gets a limit starts from a sensible one. */
export function subjectPatch(rule: SimpleAlertRule | Omit<SimpleAlertRule, 'id'>, subject: AlertSubject): RulePatch {
  const hadLimit = ALERT_SUBJECTS[rule.subject].kind === 'value';
  const needsLimit = ALERT_SUBJECTS[subject].kind === 'value';
  return needsLimit && !hadLimit ? { subject, limit: STARTING_LIMITS[subject] } : { subject };
}

export function removeRule(draft: DraftRule[], key: string): DraftRule[] {
  return draft.filter(rule => rule.key !== key);
}

/** Turn a simple rule into a custom query that does the same check, so an expert can start from it */
export function toCustomQuery(draft: DraftRule[], key: string): DraftRule[] {
  return draft.map(rule => {
    if (rule.key !== key || rule.kind !== 'simple') return rule;
    const { key: ruleKey, id, enabled, forMinutes, severity } = rule;
    const query = ruleQuery({ ...rule, id: id ?? '' }, MACHINE_PLACEHOLDER);
    return { key: ruleKey, id, kind: 'query', enabled, name: ruleName(rule), query, forMinutes, severity };
  });
}

/** How many rules are new, changed or removed since the last save */
export function changedCount(saved: AlertRule[], draft: DraftRule[]): number {
  const savedById = new Map(saved.map(rule => [rule.id, rule]));
  const draftIds = new Set(draft.map(rule => rule.id));
  const newOrChanged = draft.filter(rule => {
    const before = rule.id === undefined ? undefined : savedById.get(rule.id);
    return !before || !isSameRule(before, rule);
  }).length;
  const removed = saved.filter(rule => !draftIds.has(rule.id)).length;
  return newOrChanged + removed;
}

/** The rules as the server takes them */
export function toSaveList(draft: DraftRule[]): RuleToSave[] {
  return draft.map(({ key: _key, ...rule }) => rule);
}

/** The first rule that the server would refuse, so the user sees it before Save */
export function firstProblem(draft: DraftRule[]): DraftProblem | null {
  for (const rule of draft) {
    const message = problemOf(rule);
    if (message) return { key: rule.key, message };
  }
  return null;
}

function problemOf(rule: DraftRule): string | null {
  if (!Number.isInteger(rule.forMinutes) || rule.forMinutes < 0 || rule.forMinutes > MAX_ALERT_FOR_MINUTES) {
    return `The minutes must be a whole number from 0 to ${MAX_ALERT_FOR_MINUTES}.`;
  }
  if (rule.kind === 'simple') {
    const needsLimit = ALERT_SUBJECTS[rule.subject].kind === 'value';
    return needsLimit && !Number.isFinite(rule.limit) ? 'Fill in the limit.' : null;
  }
  if (!rule.query.trim()) return 'Write a query.';
  if (!hasMachinePlaceholder(rule.query)) {
    return `The query must have ${MACHINE_PLACEHOLDER} in it, for example {machine="${MACHINE_PLACEHOLDER}"}, so that it checks only this machine.`;
  }
  return null;
}
