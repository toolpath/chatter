import type { InferResponseType } from 'hono/client';
import { api } from './client';
import { jsonOrThrow } from './replies';

type AlertsReply = InferResponseType<typeof api.alerts.$get, 200>;

/** One alert that vmalert sent. `end` is null while the alert fires. */
export type MachineAlert = AlertsReply['data'][number];

/** The alerts of one machine in the last week, newest first */
export async function fetchMachineAlerts(machineId: string): Promise<MachineAlert[]> {
  const response = await api.alerts.$get({ query: { machine: machineId } });
  const body = await jsonOrThrow<AlertsReply>(response, 'Could not load the alerts');
  return body.data;
}
