import type { ChannelField, ChannelFieldValue, ChannelValues } from './notifications.js';

/**
 * A saved password or secret goes only to the address where the user saved it, so a typing error cannot send it
 * to a different server. The server refuses a change that moves a saved secret, and the web app shows the same
 * rule as a hint before the save. Both call these functions, so the hint and the refusal cannot drift apart.
 */

/** An address that is not there, or not text, is the default address of the type, for example ntfy.sh */
function addressOf(value: ChannelFieldValue | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** An empty secret, or one with only spaces, keeps the saved secret */
export function isEmptySecret(field: ChannelField, value: ChannelFieldValue | undefined): boolean {
  return field.kind === 'secret' && (value === undefined || (typeof value === 'string' && value.trim() === ''));
}

/** The labels for a text, for example "Server address and the Token". "(optional)" is removed. */
export function channelFieldLabels(fields: ChannelField[]): string {
  return fields.map(field => field.label.replace(/ \(optional\)$/, '')).join(' and the ');
}

/** The `url` fields that a form changes, and the saved secrets that it keeps */
export interface MovedChannelSecrets {
  changed: ChannelField[];
  kept: ChannelField[];
}

/**
 * Each `url` field of a channel type tells where the secrets go. When the values change one of them,
 * each saved secret that the values keep (an empty box) must be typed again, or deleted.
 * The same address with spaces around it is no change.
 * `isSavedSecret` is true for each secret that is saved and that the form does not delete.
 * Gives null when no saved secret moves.
 */
export function movedChannelSecrets(
  fields: ChannelField[], values: ChannelValues, savedSettings: ChannelValues, isSavedSecret: (key: string) => boolean,
): MovedChannelSecrets | null {
  const changed = fields.filter(field => field.kind === 'url' && addressOf(values[field.key]) !== addressOf(savedSettings[field.key]));
  const kept = fields.filter(field => isEmptySecret(field, values[field.key]) && isSavedSecret(field.key));
  if (changed.length === 0 || kept.length === 0) return null;
  return { changed, kept };
}

/** The text that tells the admin to type the kept secrets again */
export function movedChannelSecretsText({ changed, kept }: MovedChannelSecrets): string {
  const problem = `Type the ${channelFieldLabels(kept)} again. You changed the ${channelFieldLabels(changed)}. `
    + 'Chatter does not send a saved secret to a new address.';
  // The form can delete only a secret that is not necessary
  return kept.some(field => !field.required) ? `${problem} To use no secret, select Delete the saved secret.` : problem;
}

/** Where a saved machine password goes: the IP address and the port of the password (FTP port or OPC UA port) */
export interface PasswordAddress {
  host: string;
  port: number;
}

/**
 * True when a change moves a saved machine password and does not send it again.
 * A new IP address, or a new port of the password, moves the password. A value that is not in the change stays.
 * `isPasswordSent`: the change has a new password, or an empty one that removes it.
 */
export function mustTypePasswordAgain({ hasSavedPassword, isPasswordSent, saved, change }: {
  hasSavedPassword: boolean;
  isPasswordSent: boolean;
  saved: PasswordAddress;
  change: Partial<PasswordAddress>;
}): boolean {
  if (!hasSavedPassword || isPasswordSent) return false;
  const isNew = <Value>(newValue: Value | undefined, savedValue: Value) => newValue !== undefined && newValue !== savedValue;
  return isNew(change.host, saved.host) || isNew(change.port, saved.port);
}
