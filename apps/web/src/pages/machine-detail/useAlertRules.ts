import type { AlertRule } from '@local-chatter/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * The alert rules of one machine: the saved list, the list that the user changes, and Save.
 * Nothing loads until `isWanted` is true: only a role with manage-machines can read the rules.
 * When the machine changes, or the rules stop being wanted, the hook forgets the rules that it has.
 */
export function useAlertRules(machineId: string, isWanted: boolean): AlertRules {
  const [saved, setSaved] = useState<AlertRule[] | null>(null);
  const [draft, setDraft] = useState<DraftRule[]>([]);
  const [failed, setFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [problem, setProblem] = useState<AlertRules['problem']>(null);
  const [notice, setNotice] = useState<SaveNotice>(null);
  const [loadCount, setLoadCount] = useState(0);
  // The machine whose rules the state holds. Null when the rules are not wanted.
  const wantedId = isWanted ? machineId : null;
  const [stateFor, setStateFor] = useState(wantedId);
  if (stateFor !== wantedId) {
    setStateFor(wantedId);
    setSaved(null);
    setDraft([]);
    setFailed(false);
    setIsSaving(false);
    setProblem(null);
    setNotice(null);
  }
  // A save reads this when the server answers, to know if the user is still on the same machine
  const currentId = useRef(wantedId);
  useEffect(() => {
    currentId.current = wantedId;
  }, [wantedId]);

  useEffect(() => {
    if (!isWanted) return;
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
  }, [machineId, isWanted, loadCount]);

  const edit = useCallback((update: (rules: DraftRule[]) => DraftRule[]) => {
    setDraft(update);
    setProblem(null);
    setNotice(null);
  }, []);

  const save = async () => {
    // Before the rules load, the draft is empty. A save then would delete all the rules of the machine.
    if (!saved) return;
    const savedFor = machineId;
    const isStillShown = () => currentId.current === savedFor;
    const found = firstProblem(draft);
    if (found) {
      setProblem(found);
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveAlertRules(savedFor, toSaveList(draft));
      if (!isStillShown()) return;
      setSaved(result.rules);
      setDraft(draftOf(result.rules));
      setNotice(result.vmalertReloaded ? 'saved' : 'saved-vmalert-late');
    } catch (error) {
      if (isStillShown()) setProblem(saveProblemOf(error, draft));
    } finally {
      if (isStillShown()) setIsSaving(false);
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

/** The reason that the server gave for a failed save, on the rule that it names */
function saveProblemOf(error: unknown, draft: DraftRule[]): RulesProblem {
  const ruleIndex = error instanceof RuleSaveError ? error.ruleIndex : undefined;
  return {
    key: ruleIndex === undefined ? null : draft[ruleIndex]?.key ?? null,
    message: error instanceof Error ? error.message : 'Could not save the alert rules',
  };
}
