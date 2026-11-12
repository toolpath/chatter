import type { SimpleAlertRule } from '@local-chatter/shared';
import { describe, expect, it } from 'vitest';
import {
  addRule,
  changedCount,
  changeRule,
  draftOf,
  firstProblem,
  removeRule,
  subjectPatch,
  toCustomQuery,
  toSaveList,
} from './alertRulesDraft';

const highLoad: SimpleAlertRule = {
  id: 'r1', kind: 'simple', enabled: true, subject: 'spindle-load', check: 'above', limit: 90, forMinutes: 1, severity: 'warning',
};
const offline: SimpleAlertRule = {
  id: 'r2', kind: 'simple', enabled: true, subject: 'not-connected', check: 'above', limit: 0, forMinutes: 10, severity: 'warning',
};

describe('alert rules draft', () => {
  it('starts with no change', () => {
    const saved = [highLoad, offline];
    expect(changedCount(saved, draftOf(saved))).toBe(0);
  });

  it('counts each changed, added and removed rule', () => {
    const saved = [highLoad, offline];
    let draft = draftOf(saved);
    draft = changeRule(draft, 'r1', { limit: 80 });
    expect(changedCount(saved, draft)).toBe(1);

    draft = removeRule(draft, 'r2');
    draft = addRule(draft, 'query');
    expect(changedCount(saved, draft)).toBe(3);
  });

  it('counts a rule that is changed back as not changed', () => {
    const saved = [highLoad];
    const draft = changeRule(changeRule(draftOf(saved), 'r1', { limit: 80 }), 'r1', { limit: 90 });
    expect(changedCount(saved, draft)).toBe(0);
  });

  it('adds a simple rule and a custom query with sensible words, each with its own key', () => {
    const draft = addRule(addRule([], 'simple'), 'query');

    expect(draft[0]).toMatchObject({ kind: 'simple', enabled: true, subject: 'spindle-speed', check: 'above' });
    expect(draft[1]).toMatchObject({ kind: 'query', enabled: true, name: '', query: expect.stringContaining('$machine') });
    expect(draft[0].key).not.toBe(draft[1].key);
  });

  it('makes a custom query from a simple rule, with $machine in the query', () => {
    const [rule] = toCustomQuery(draftOf([highLoad]), 'r1');

    expect(rule).toMatchObject({
      key: 'r1', id: 'r1', kind: 'query', name: 'Spindle load above 90%',
      query: 'chatter_spindle_load{machine="$machine"} > 90', forMinutes: 1, severity: 'warning', enabled: true,
    });
  });

  it('gives the save list without the keys', () => {
    const list = toSaveList(addRule(draftOf([highLoad]), 'simple'));

    expect(list[0]).toEqual(highLoad);
    expect(list[1]).not.toHaveProperty('key');
    expect(list[1]).not.toHaveProperty('id');
  });

  it('gives a sensible limit when a state rule changes to a value', () => {
    expect(subjectPatch(offline, 'spindle-load')).toEqual({ subject: 'spindle-load', limit: 90 });
    expect(subjectPatch(highLoad, 'part-count')).toEqual({ subject: 'part-count' });
    expect(subjectPatch(highLoad, 'in-alarm')).toEqual({ subject: 'in-alarm' });
  });

  describe('firstProblem', () => {
    it('is null when every rule can be saved', () => {
      expect(firstProblem(draftOf([highLoad, offline]))).toBeNull();
    });

    it('finds an empty number', () => {
      const draft = changeRule(draftOf([highLoad]), 'r1', { limit: Number.NaN });
      expect(firstProblem(draft)).toEqual({ key: 'r1', message: 'Fill in the limit.' });
    });

    it('does not ask for the limit of a state rule', () => {
      expect(firstProblem(changeRule(draftOf([offline]), 'r2', { limit: Number.NaN }))).toBeNull();
    });

    it('finds minutes out of range', () => {
      const draft = changeRule(draftOf([highLoad]), 'r1', { forMinutes: 2000 });
      expect(firstProblem(draft)?.message).toBe('The minutes must be a whole number from 0 to 1440.');
    });

    it('finds a custom query with no $machine', () => {
      const draft = addRule([], 'query');
      const key = draft[0].key;
      expect(firstProblem(changeRule(draft, key, { query: 'chatter_alarm == 1' }))?.message).toMatch(/\$machine/);
      expect(firstProblem(changeRule(draft, key, { query: ' ' }))?.message).toBe('Write a query.');
    });
  });
});
