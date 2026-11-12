import type { InferResponseType } from 'hono/client';
import { api } from './client';
import { jsonOrThrow } from './replies';

const report = api.machine[':id'].report;

/** The time a machine was watched, online, and running, its parts made, and its alarms, over a range */
export type MachineReport = InferResponseType<typeof report.$get, 200>;

/** `range` is how far back, for example "-1d" */
export async function fetchMachineReport(machineId: string, range: string): Promise<MachineReport> {
  const response = await report.$get({ param: { id: machineId }, query: { range } });
  return jsonOrThrow<MachineReport>(response, 'Could not load the report');
}
