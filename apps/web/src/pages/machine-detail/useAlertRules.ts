import type { AlertRule } from '@local-chatter/shared';
import { useCallback, useEffect, useState } from 'react';
import { fetchAlertRules, RuleSaveError, saveAlertRules } from '../../api/alertRules';
import {
  addRule,
  changedCount,
  changeRule,
  draftOf,
  firstProblem,
  removeRule,
  toCustomQuery,
  toSaveList,
  type DraftProblem,
  type DraftRule,
  type RulePatch,
} from './alertRulesDraft';

export type RulesProblem = Omit<DraftProblem, 'key'> & { key: string | null };

export type SaveNotice = 'saved' | 'saved-vmalert-late' | null;

export interface AlertRules {
  /** The rules on the server. Null until they load. */
  saved: AlertRule[] | null;
  draft: DraftRule[];
  failed: boolean;
  changes: number;
  isSaving: boolean;
  /** The rule to fix before a save, or the reason the server gave. The key is null when no one rule is wrong. */
  problem: RulesProblem | null;
  notice: SaveNotice;
  change: (key: string, patch: RulePatch) => void;
  add: (kind: 'simple' | 'query') => void;
  remove: (key: string) => void;
  makeCustomQuery: (key: string) => void;
  undo: () => void;
  save: () => Promise<void>;
  /** Load the rules again, for example after a copy */
  reload: () => void;
  clearNotice: () => void;
}

/** The alert rules of one machine: the saved list, the list that the user changes, and Save */
export function useAlertRules(machineId: string): AlertRules {
  const [saved, setSaved] = useState<AlertRule[] | null>(null);
  const [draft, setDraft] = useState<DraftRule[]>([]);
  const [failed, setFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [problem, setProblem] = useState<AlertRules['problem']>(null);
  const [notice, setNotice] = useState<SaveNotice>(null);
  const [loadCount, setLoadCount] = useState(0);

  useEffect(() => {
    let stopped = false;
    fetchAlertRules(machineId).then(
      rules => {
        if (stopped) return;
        setSaved(rules);
        setDraft(draftOf(rules));
        setFailed(false);
      },
      () => {
        if (!stopped) setFailed(true);
      },
    );
    return () => {
      stopped = true;
    };
  }, [machineId, loadCount]);

  const edit = useCallback((update: (rules: DraftRule[]) => DraftRule[]) => {
    setDraft(update);
    setProblem(null);
    setNotice(null);
  }, []);

  const save = async () => {
    const found = firstProblem(draft);
    if (found) {
      setProblem(found);
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveAlertRules(machineId, toSaveList(draft));
      setSaved(result.rules);
      setDraft(draftOf(result.rules));
      setNotice(result.vmalertReloaded ? 'saved' : 'saved-vmalert-late');
    } catch (error) {
      const ruleIndex = error instanceof RuleSaveError ? error.ruleIndex : undefined;
      setProblem({
        key: ruleIndex === undefined ? null : draft[ruleIndex]?.key ?? null,
        message: error instanceof Error ? error.message : 'Could not save the alert rules',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return {
    saved,
    draft,
    failed,
    changes: saved ? changedCount(saved, draft) : 0,
    isSaving,
    problem,
    notice,
    change: (key, patch) => edit(rules => changeRule(rules, key, patch)),
    add: kind => edit(rules => addRule(rules, kind)),
    remove: key => edit(rules => removeRule(rules, key)),
    makeCustomQuery: key => edit(rules => toCustomQuery(rules, key)),
    undo: () => edit(() => draftOf(saved ?? [])),
    save,
    reload: () => setLoadCount(count => count + 1),
    clearNotice: () => setNotice(null),
  };
}
