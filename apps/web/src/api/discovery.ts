import type { FoundMachine } from '../types';
import { api } from './client';

/** The address ranges where the machines probably are, best guess first, such as "192.168.1" */
export async function fetchRangeGuesses(): Promise<string[]> {
  const response = await api.discovery.ranges.$get();
  if (!response.ok) throw new Error('Could not load the address ranges');
  return (await response.json()).ranges;
}

/** The machines in `range` that are not added yet. Takes up to 30 seconds. */
export async function scanRange(range: string): Promise<FoundMachine[]> {
  const response = await api.discovery.scan.$post({ json: { range } });
  const body = await response.json();
  if ('error' in body) throw new Error(body.error);
  return body.found;
}
