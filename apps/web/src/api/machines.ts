import type { Machine, MachineUpdate } from '../types';
import { api } from './client';
import { errorOf, jsonOrThrow } from './replies';

/**
 * Save a change to the settings of a machine. Throws an error with the server's reason,
 * for example when a new IP address needs the saved password again.
 */
export async function saveMachineUpdate(id: string, updates: MachineUpdate): Promise<void> {
  const error = await errorOf(await api.machine[':id'].$put({ param: { id }, json: updates }), 'Could not save the machine settings');
  if (error) throw new Error(error);
}

/** The status of one machine now */
export async function fetchMachine(id: string): Promise<Machine> {
  return jsonOrThrow<Machine>(await api.machine[':id'].$get({ param: { id } }), 'Could not load the machine');
}

/**
 * An Admin trusts the new OPC UA certificate of a Siemens control. Send the SHA-256 thumbprint that the Admin saw.
 * Throws an error with the server's reason, for example when the certificate changed again.
 */
export async function trustOpcuaCertificate(id: string, thumbprint: string): Promise<Machine> {
  const response = await api.machine[':id'].opcua['trust-certificate'].$post({ param: { id }, json: { thumbprint } });
  return jsonOrThrow<Machine>(response, 'Could not trust the certificate');
}

/** An Admin forgets the trusted OPC UA certificate of a Siemens control. The next connect trusts the certificate that it gets. */
export async function forgetOpcuaCertificate(id: string): Promise<Machine> {
  const response = await api.machine[':id'].opcua['forget-certificate'].$post({ param: { id } });
  return jsonOrThrow<Machine>(response, 'Could not forget the certificate');
}
