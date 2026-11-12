import { Hono } from 'hono';
import type { AlertRuleService } from '../alert-rules/AlertRuleService.js';
import { requirePermission } from '../auth/authRoutes.js';
import type { HardwarePoller } from '../polling/poller.js';
import { checkedJson } from './checks.js';
import { notFound } from './responses.js';
import { alertRulesSchema, copyAlertRulesSchema, testAlertQuerySchema } from './schemas.js';

/** Read, change and copy the alert rules of a machine. Only a role with manage-machines can change them. */
export function alertRuleRoutes(poller: HardwarePoller, alertRules: AlertRuleService) {
  const canManageMachines = requirePermission('manage-machines');
  const isKnownMachine = (machineId: string) => poller.getMachine(machineId) !== null;

  return new Hono()
    .get('/machine/:id/alert-rules', c => {
      const machineId = c.req.param('id');
      if (!isKnownMachine(machineId)) return notFound(c);
      return c.json({ rules: alertRules.rulesOf(machineId) });
    })

    .put('/machine/:id/alert-rules', canManageMachines, checkedJson(alertRulesSchema), async c => {
      const machineId = c.req.param('id');
      if (!isKnownMachine(machineId)) return notFound(c);
      const result = await alertRules.saveRules(machineId, c.req.valid('json').rules);
      if (!result.ok) return c.json({ error: result.error, ruleIndex: result.ruleIndex }, 400);
      return c.json({ rules: result.rules, vmalertReloaded: result.vmalertReloaded });
    })

    .post('/machine/:id/alert-rules/copy', canManageMachines, checkedJson(copyAlertRulesSchema), async c => {
      const machineId = c.req.param('id');
      if (!isKnownMachine(machineId)) return notFound(c);
      const { machineIds } = c.req.valid('json');
      const unknown = machineIds.find(id => !isKnownMachine(id));
      if (unknown) return c.json({ error: `Machine ${unknown} not found` }, 400);
      return c.json(await alertRules.copyRules(machineId, machineIds));
    })

    .post('/alert-rules/test', canManageMachines, checkedJson(testAlertQuerySchema), async c => {
      const { machineId, query } = c.req.valid('json');
      if (!isKnownMachine(machineId)) return notFound(c);
      return c.json(await alertRules.testQuery(machineId, query));
    });
}
