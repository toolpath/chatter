import type { AlertRule, NewAlertRule, QueryCheck } from '@local-chatter/shared';
import { api } from './client';
import { jsonOrThrow } from './replies';

/** A rule to save. A rule that is already saved has its id, so its alert goes on firing. */
export type RuleToSave = NewAlertRule & { id?: string };

export type { QueryCheck };

export interface SavedRules {
  rules: AlertRule[];
  /** False when vmalert did not answer. It reads the rules again within 30 seconds. */
  vmalertReloaded: boolean;
}

/** The server refused one rule, for example a custom query that VictoriaMetrics refused */
export class RuleSaveError extends Error {
  constructor(message: string, readonly ruleIndex?: number) {
    super(message);
  }
}

const machineRules = (machineId: string) => ({ param: { id: machineId } });

export async function fetchAlertRules(machineId: string): Promise<AlertRule[]> {
  const reply = await jsonOrThrow<{ rules: AlertRule[] }>(
    await api.machine[':id']['alert-rules'].$get(machineRules(machineId)),
    'Could not load the alert rules',
  );
  return reply.rules;
}

/** Put this list in place of the machine's rules. Throws a RuleSaveError that tells which rule, when it can. */
export async function saveAlertRules(machineId: string, rules: RuleToSave[]): Promise<SavedRules> {
  const response = await api.machine[':id']['alert-rules'].$put({ ...machineRules(machineId), json: { rules } });
  if (response.ok) return (await response.json()) as SavedRules;
  // A proxy can send a page that is not JSON. Then the general text is used.
  const body = (await response.json().catch(() => ({}))) as { error?: string; ruleIndex?: number };
  throw new RuleSaveError(body.error || 'Could not save the alert rules', body.ruleIndex);
}

export interface CopiedRules {
  copied: number;
  /** Rules left out, because a machine already had the most rules that it can have */
  notCopied: number;
}

/** Copy the machine's rules to other machines. A rule that a machine already has is not copied again. */
export async function copyAlertRules(machineId: string, machineIds: string[]): Promise<CopiedRules> {
  return jsonOrThrow(
    await api.machine[':id']['alert-rules'].copy.$post({ ...machineRules(machineId), json: { machineIds } }),
    'Could not copy the alert rules',
  );
}

/** Run a custom query on one machine now */
export async function testAlertQuery(machineId: string, query: string): Promise<QueryCheck> {
  return jsonOrThrow(await api['alert-rules'].test.$post({ json: { machineId, query } }), 'Could not test the query');
}
