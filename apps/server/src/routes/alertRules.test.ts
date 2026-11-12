import Database from 'better-sqlite3';
import type { AlertRule, NewAlertRule } from '@local-chatter/shared';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AlertRuleService } from '../alert-rules/AlertRuleService.js';
import { AlertRuleStore } from '../alert-rules/AlertRuleStore.js';
import type { QueryCheck } from '../alert-rules/QueryChecker.js';
import { loggedInAuth } from '../auth/testSupport.js';
import type { UserAccounts } from '../auth/userAccounts.js';
import { HardwarePoller } from '../polling/poller.js';
import { applySchema } from '../storage/schema.js';
import { errorOf, testApp, type TestApp } from './testSupport.js';

const PASSWORD = 'a-good-password';
const highLoad: NewAlertRule = {
  kind: 'simple', enabled: true, subject: 'spindle-load', check: 'above', limit: 90, forMinutes: 1, severity: 'warning',
};
const SLOW_SPINDLE_QUERY = 'chatter_spindle_speed{machine="$machine"} < 500';
const slowSpindle: NewAlertRule = {
  kind: 'query', enabled: true, name: 'Slow spindle', query: SLOW_SPINDLE_QUERY, forMinutes: 5, severity: 'warning',
};

describe('alert rule routes', () => {
  let app: TestApp;
  let accounts: UserAccounts;
  let adminCookie: string;
  let haasId: string;
  let brotherId: string;
  let checkQuery: Mock<[string], Promise<QueryCheck>>;

  beforeEach(async () => {
    const parts = await loggedInAuth();
    accounts = parts.accounts;
    adminCookie = parts.cookie;
    const db = new Database(':memory:');
    applySchema(db);
    const poller = new HardwarePoller(db);
    checkQuery = vi.fn<[string], Promise<QueryCheck>>().mockResolvedValue({ ok: true, resultCount: 1, firstValue: 812 });
    const alertRules = new AlertRuleService({
      store: new AlertRuleStore(db),
      rulesFile: { write: async () => {} },
      vmalert: { reload: async () => true },
      queries: { check: checkQuery },
    });
    poller.addAddListener(alertRules);
    haasId = (await poller.addMachine({ type: 'haas', name: 'Haas', host: '127.0.0.1' })).id;
    brotherId = (await poller.addMachine({ type: 'brother', name: 'Brother', host: '127.0.0.2' })).id;
    app = testApp({ auth: parts.auth, accounts, poller, alertRules });
  });

  function send(cookie: string, method: string, path: string, body?: object) {
    return app.request(`/api${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
  }

  const asAdmin = (method: string, path: string, body?: object) => send(adminCookie, method, path, body);

  async function viewerCookie() {
    await accounts.add({ username: 'jo', password: PASSWORD, role: 'viewer' });
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jo', password: PASSWORD }),
    });
    return (res.headers.get('Set-Cookie') ?? '').split(';')[0];
  }

  async function rulesOf(machineId: string): Promise<AlertRule[]> {
    return ((await (await asAdmin('GET', `/machine/${machineId}/alert-rules`)).json()) as { rules: AlertRule[] }).rules;
  }

  it('needs a login', async () => {
    expect((await app.request(`/api/machine/${haasId}/alert-rules`)).status).toBe(401);
  });

  it('shows the starter rules of a new machine to every logged-in user', async () => {
    const res = await send(await viewerCookie(), 'GET', `/machine/${haasId}/alert-rules`);

    expect(res.status).toBe(200);
    const { rules } = (await res.json()) as { rules: AlertRule[] };
    expect(rules.map(rule => rule.kind === 'simple' && rule.subject)).toEqual(['not-connected', 'in-alarm', 'spindle-load']);
  });

  it('saves a new list for an admin', async () => {
    const res = await asAdmin('PUT', `/machine/${haasId}/alert-rules`, { rules: [highLoad, slowSpindle] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rules: [{ ...highLoad, id: expect.any(String) }, { ...slowSpindle, id: expect.any(String) }],
      vmalertReloaded: true,
    });
    expect(await rulesOf(haasId)).toHaveLength(2);
  });

  it('does not let a viewer change the rules', async () => {
    const res = await send(await viewerCookie(), 'PUT', `/machine/${haasId}/alert-rules`, { rules: [] });

    expect(res.status).toBe(403);
    expect(await rulesOf(haasId)).toHaveLength(3);
  });

  it('refuses a rule with a bad shape', async () => {
    const res = await asAdmin('PUT', `/machine/${haasId}/alert-rules`, { rules: [{ ...highLoad, forMinutes: -1 }] });

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('The minutes cannot be less than 0');
  });

  it('refuses a custom query that VictoriaMetrics refuses, and tells which rule', async () => {
    checkQuery.mockResolvedValue({ ok: false, error: 'cannot parse' });

    const res = await asAdmin('PUT', `/machine/${haasId}/alert-rules`, { rules: [highLoad, slowSpindle] });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'cannot parse', ruleIndex: 1 });
    expect(await rulesOf(haasId)).toHaveLength(3);
  });

  it('copies the rules to another machine', async () => {
    await asAdmin('PUT', `/machine/${haasId}/alert-rules`, { rules: [highLoad, slowSpindle] });

    const res = await asAdmin('POST', `/machine/${haasId}/alert-rules/copy`, { machineIds: [brotherId] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ copied: 1, notCopied: 0, vmalertReloaded: true });
    expect(await rulesOf(brotherId)).toHaveLength(4);
  });

  it('does not copy to a machine that is not there', async () => {
    const res = await asAdmin('POST', `/machine/${haasId}/alert-rules/copy`, { machineIds: ['nope'] });

    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Machine nope not found');
  });

  it('tests a custom query on one machine', async () => {
    const res = await asAdmin('POST', '/alert-rules/test', { machineId: haasId, query: SLOW_SPINDLE_QUERY });

    expect(await res.json()).toEqual({ ok: true, resultCount: 1, firstValue: 812 });
    expect(checkQuery).toHaveBeenCalledWith(`chatter_spindle_speed{machine="${haasId}"} < 500`);
  });

  it('says not found for an unknown machine', async () => {
    expect((await asAdmin('GET', '/machine/nope/alert-rules')).status).toBe(404);
    expect((await asAdmin('PUT', '/machine/nope/alert-rules', { rules: [] })).status).toBe(404);
  });
});
